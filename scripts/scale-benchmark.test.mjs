import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { compareScaleBenchmarkBaseline } from "./scale-benchmark-baseline.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generator = path.join(root, "scripts/generate-scale-project.mjs");
const benchmark = path.join(root, "scripts/run-scale-benchmark.mjs");

function run(outDir) {
  return spawnSync(process.execPath, [generator, outDir], { encoding: "utf8" });
}

async function digestTree(rootDir) {
  const hash = createHash("sha256");
  async function visit(directory) {
    for (const name of (await readdir(directory)).sort()) {
      const file = path.join(directory, name);
      const info = await stat(file);
      const relative = path.relative(rootDir, file).replaceAll(path.sep, "/");
      if (info.isDirectory()) await visit(file);
      else {
        hash.update(relative);
        hash.update("\0");
        hash.update(await readFile(file));
        hash.update("\0");
      }
    }
  }
  await visit(rootDir);
  return hash.digest("hex");
}

function registryAssetCount(manifest) {
  return Object.keys(manifest.backgrounds).length
    + Object.keys(manifest.audio.bgm).length
    + Object.keys(manifest.audio.sfx).length
    + Object.keys(manifest.audio.voice).length
    + Object.keys(manifest.cg).length
    + Object.keys(manifest.videos).length
    + Object.keys(manifest.fonts).length;
}

test("scale benchmark reports raw data, environment, and opt-in browser scenarios", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "vibegal-scale-report-"));
  try {
    const reportPath = path.join(temp, "report.json");
    const result = spawnSync(process.execPath, [benchmark, reportPath], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.dataset.nodeCount, 1_000);
    assert.equal(report.dataset.assetCount, 500);
    assert.equal(report.measurements.graphNodes, 1_000);
    assert.equal(report.environment.platform, process.platform);
    assert.equal(report.browser.status, "not-run");
    assert.deepEqual(report.browser.scenarios, [
      "workspace-interactive",
      "assets-first-render",
      "asset-search-input",
      "node-list-scroll",
      "graph-interactive",
      "single-node-edit-save",
      "peak-js-heap",
    ]);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("scale benchmark reports missing Chrome without claiming a browser run", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "vibegal-scale-no-browser-"));
  try {
    const reportPath = path.join(temp, "report.json");
    const result = spawnSync(process.execPath, [benchmark, reportPath, "--browser"], {
      encoding: "utf8",
      env: { ...process.env, VIBEGAL_CHROME_PATH: path.join(temp, "missing-chrome") },
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.browser.status, "not-run");
    assert.match(report.browser.reason, /Chrome executable not found/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("scale benchmark requires Chrome when strict browser mode is requested", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "vibegal-scale-require-browser-"));
  try {
    const reportPath = path.join(temp, "report.json");
    const result = spawnSync(process.execPath, [benchmark, reportPath, "--browser", "--require-browser"], {
      encoding: "utf8",
      env: { ...process.env, VIBEGAL_CHROME_PATH: path.join(temp, "missing-chrome") },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Chrome executable not found/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("scale benchmark heap comparison enforces same-runner 20% regression threshold", () => {
  const report = (peakJsHeapBytes, cpuModel = "benchmark-cpu") => ({
    environment: {
      platform: "darwin",
      architecture: "arm64",
      cpuModel,
      cpuCount: 8,
    },
    browser: {
      status: "completed",
      browser: {
        name: "Google Chrome",
        viewport: { width: 1440, height: 1000, deviceScaleFactor: 1 },
      },
      measurements: { peakJsHeapBytes },
    },
  });

  assert.equal(compareScaleBenchmarkBaseline(report(120), report(100)).passed, true);
  assert.equal(compareScaleBenchmarkBaseline(report(121), report(100)).passed, false);
  assert.throws(
    () => compareScaleBenchmarkBaseline(report(100, "other-cpu"), report(100)),
    /baseline runner does not match: environment.cpuModel/,
  );
  assert.throws(
    () => compareScaleBenchmarkBaseline({ browser: { status: "not-run" } }, report(100)),
    /Current browser benchmark is not completed/,
  );
});

test("scale generator is byte-stable and covers the 1000/500 dataset", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "vibegal-scale-generator-"));
  const first = path.join(temp, "first");
  const second = path.join(temp, "second");
  try {
    const firstResult = run(first);
    assert.equal(firstResult.status, 0, firstResult.stderr);
    const secondResult = run(second);
    assert.equal(secondResult.status, 0, secondResult.stderr);
    assert.equal(await digestTree(first), await digestTree(second));

    const dataset = JSON.parse(await readFile(path.join(first, "benchmark.dataset.json"), "utf8"));
    const graph = JSON.parse(await readFile(path.join(first, "content/graph.json"), "utf8"));
    const manifest = JSON.parse(await readFile(path.join(first, "content/manifest.json"), "utf8"));
    const variables = JSON.parse(await readFile(path.join(first, "content/variables.json"), "utf8"));
    const locales = await readdir(path.join(first, "content/locales"));
    const nodes = await readdir(path.join(first, "content/nodes"));
    const renderer = await readFile(path.join(first, "renderers/default/index.tsx"), "utf8");

    assert.deepEqual(dataset.assetKinds, { background: 100, audio: 100, cg: 100, video: 100, font: 100 });
    assert.equal(graph.nodes.length, 1_000);
    assert.equal(nodes.length, 1_000);
    assert.equal(graph.chapters.length, 20);
    assert.equal(registryAssetCount(manifest), 500);
    assert.equal(locales.length, 1);
    assert.equal(Object.keys(variables.variables).length, 1);
    assert.equal(Object.keys(manifest.characters).length, 20);
    assert.match(renderer, /Scale Benchmark/);
    assert.ok(graph.edges.some((edge) => edge.mode === "linear"));
    assert.ok(graph.edges.some((edge) => edge.mode === "choice"));
    assert.ok(graph.edges.some((edge) => edge.mode === "auto" && edge.condition));
    assert.ok(graph.edges.some((edge) => edge.mode === "auto" && edge.condition === null));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
