#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { runStudioBrowserBenchmark } from "./studio-browser-benchmark.mjs";
import { compareScaleBenchmarkBaseline } from "./scale-benchmark-baseline.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generator = path.join(root, "scripts/generate-scale-project.mjs");
const args = process.argv.slice(2);
const baselineArgIndex = args.indexOf("--baseline");
const baselinePath = baselineArgIndex >= 0
  ? args[baselineArgIndex + 1]
  : process.env.VIBEGAL_BENCHMARK_BASELINE;
if (baselineArgIndex >= 0 && (!baselinePath || baselinePath.startsWith("--"))) {
  throw new Error("--baseline requires a report path");
}
const baselineValueIndex = baselineArgIndex >= 0 ? baselineArgIndex + 1 : -1;
const outputArg = args.find((argument, index) => !argument.startsWith("--") && index !== baselineValueIndex);
const output = path.resolve(outputArg || "benchmark-results/scale-latest.json");
const runBrowser = args.includes("--browser") || process.env.VIBEGAL_BENCHMARK_BROWSER === "1";
const requireBrowser = args.includes("--require-browser");
const BROWSER_SCENARIOS = [
  "workspace-interactive",
  "assets-first-render",
  "asset-search-input",
  "node-list-scroll",
  "graph-interactive",
  "single-node-edit-save",
  "peak-js-heap",
];
const temporary = await mkdtemp(path.join(os.tmpdir(), "vibegal-scale-benchmark-"));
const project = path.join(temporary, "project");

try {
  const started = performance.now();
  const generated = spawnSync(process.execPath, [generator, project], { encoding: "utf8" });
  if (generated.status !== 0) throw new Error(generated.stderr || generated.stdout);
  const generatedMs = performance.now() - started;

  const parseStarted = performance.now();
  const [dataset, graph, manifest, locale] = await Promise.all([
    readFile(path.join(project, "benchmark.dataset.json"), "utf8").then(JSON.parse),
    readFile(path.join(project, "content/graph.json"), "utf8").then(JSON.parse),
    readFile(path.join(project, "content/manifest.json"), "utf8").then(JSON.parse),
    readFile(path.join(project, "content/locales/zh-CN.json"), "utf8").then(JSON.parse),
  ]);
  const coreDocumentsMs = performance.now() - parseStarted;

  const browser = runBrowser
    ? await runBrowserHarness({ project, requireBrowser })
    : notRunBrowser("Pass --browser (or VIBEGAL_BENCHMARK_BROWSER=1) to run the controlled Chrome harness.");

  const report = {
    schemaVersion: 1,
    benchmark: "scale-v1",
    dataset,
    environment: {
      ...(process.env.VIBEGAL_BENCHMARK_RUNNER_CLASS
        ? { runnerClass: process.env.VIBEGAL_BENCHMARK_RUNNER_CLASS }
        : {}),
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      cpuModel: os.cpus()[0]?.model || "unknown",
      cpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      commit: process.env.GITHUB_SHA || null,
    },
    measurements: {
      generatedMs: Number(generatedMs.toFixed(3)),
      coreDocumentsMs: Number(coreDocumentsMs.toFixed(3)),
      graphNodes: graph.nodes.length,
      graphEdges: graph.edges.length,
      localeMessages: Object.keys(locale).length,
      manifestCharacters: Object.keys(manifest.characters).length,
    },
    browser,
  };
  if (baselinePath) {
    const baseline = JSON.parse(await readFile(path.resolve(baselinePath), "utf8"));
    report.baseline = {
      path: path.resolve(baselinePath),
      peakJsHeap: compareScaleBenchmarkBaseline(report, baseline),
    };
  }
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.baseline && !report.baseline.peakJsHeap.passed) {
    process.exitCode = 1;
  }
  if (browser.status === "completed" && Object.values(browser.assertions).some((passed) => !passed)) {
    process.exitCode = 1;
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}

function notRunBrowser(reason) {
  return { status: "not-run", reason, scenarios: BROWSER_SCENARIOS };
}

async function runBrowserHarness({ project, requireBrowser }) {
  const chromePath = process.env.VIBEGAL_CHROME_PATH || (
    process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : process.platform === "win32"
        ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
        : "google-chrome"
  );
  if (path.isAbsolute(chromePath)) {
    try {
      await access(chromePath);
    } catch {
      if (requireBrowser) throw new Error(`Chrome executable not found: ${chromePath}`);
      return notRunBrowser(`Chrome executable not found: ${chromePath}`);
    }
  }

  const studioDir = path.join(root, "packages/studio");
  // Windows 上 pnpm 是 .cmd 批处理：spawnSync 直接执行会 EINVAL，
  // 用显式 cmd.exe /d /s /c 解释。
  const build = process.platform === "win32"
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", "pnpm", "--filter", "@vibegal/studio", "build"], { cwd: root, encoding: "utf8" })
    : spawnSync("pnpm", ["--filter", "@vibegal/studio", "build"], { cwd: root, encoding: "utf8" });
  if (build.status !== 0) throw new Error(build.stderr || build.stdout);

  const port = await availablePort();
  const preview = spawn("pnpm", ["--filter", "@vibegal/studio", "exec", "vite", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  preview.stdout.setEncoding("utf8");
  preview.stderr.setEncoding("utf8");
  preview.stdout.on("data", (chunk) => { output += chunk; });
  preview.stderr.on("data", (chunk) => { output += chunk; });
  try {
    const studioUrl = `http://127.0.0.1:${port}/`;
    await waitForServer(studioUrl, preview, () => output);
    return await runStudioBrowserBenchmark({ chromePath, studioUrl, projectPath: project, studioDir });
  } catch (error) {
    if (requireBrowser) throw error;
    return notRunBrowser(`Controlled Chrome harness failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    preview.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => preview.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
    if (preview.exitCode == null) preview.kill("SIGKILL");
  }
}

async function availablePort() {
  const { createServer } = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForServer(url, child, output) {
  const deadline = performance.now() + 15_000;
  while (performance.now() < deadline) {
    if (child.exitCode != null) throw new Error(`Vite preview exited (${child.exitCode}): ${output()}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Preview starts accepting connections after the process is spawned.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out starting Vite preview: ${output()}`);
}
