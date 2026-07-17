#!/usr/bin/env node
/**
 * renderer-snapshot worker —— 无头截图的构建侧。
 *
 * 由 CLI（Rust）以 `node renderer-snapshot.mjs --project <根> --renderer <id> --out <目录>`
 * 调用。流程：渲染层静态诊断 → 读 content 的 meta/manifest → probe 出内置快照
 * 场景 → 生成 snapshot-entry.tsx 并用 esbuild 打成浏览器 bundle → 落盘
 * snapshot.html / scenes.json。Rust 侧随后用本地 HTTP 服务 + Chrome 打开
 * snapshot.html?scene=<id> 截图，浏览器宿主通过 /__vibegal_snapshot_result__ 回报。
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import {
  diagnosticFailure,
  jsonExit,
  parseArgs,
  rendererCompileFailure,
  rendererDiagnostics,
  rendererImportGuardPlugin,
  repoRoot,
  resolveProjectDir,
  studioRoot,
} from "./renderer-worker-shared.mjs";

const DEFAULT_STAGE = { width: 1280, height: 720 };

/** esbuild 的 import  specifier 统一用正斜杠（Windows 的 path.join 产物的反斜杠也行，但正斜杠更稳妥）。 */
function toPosixPath(value) {
  return value.replaceAll(path.sep, "/");
}

/** 读项目 content 下的 JSON；缺失或解析失败一律报结构化错误后退出。 */
function readProjectJson(projectDir, relativePath, rendererId) {
  const filePath = path.join(projectDir, relativePath);
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    jsonExit({
      ok: false,
      code: "snapshot_content_invalid",
      message: `无法解析 ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
      step: "content",
      rendererId,
      file: relativePath,
    }, 1);
  }
  return undefined;
}

/** 从 meta.json 取舞台尺寸；缺省或非法时回落到 1280x720。 */
function snapshotStage(meta) {
  const width = Number(meta?.stage?.width);
  const height = Number(meta?.stage?.height);
  return {
    width: Number.isFinite(width) && width > 0 ? width : DEFAULT_STAGE.width,
    height: Number.isFinite(height) && height > 0 ? height : DEFAULT_STAGE.height,
  };
}

/**
 * 复用 TS 里的场景生成逻辑：snapshotScenes.ts 只有 type import，单文件
 * transform 产物自足，可以直接 dynamic import，无需解析任何依赖。
 */
async function probeSnapshotScenes(snapshotDir, manifest) {
  const scenesSourcePath = path.join(studioRoot, "src/export/snapshotScenes.ts");
  const scenesSource = await readFile(scenesSourcePath, "utf8");
  const transformed = await esbuild.transform(scenesSource, {
    loader: "ts",
    format: "esm",
    platform: "node",
    target: "es2022",
  });
  const probePath = path.join(snapshotDir, ".scenes-probe.mjs");
  await writeFile(probePath, transformed.code, "utf8");
  try {
    const probeUrl = pathToFileURL(probePath);
    probeUrl.searchParams.set("t", String(Date.now()));
    const probeModule = await import(probeUrl.href);
    return probeModule.buildSnapshotScenes(manifest);
  } finally {
    await rm(probePath, { force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rendererId = args.renderer;
  const outDir = args.out ? path.resolve(args.out) : "";
  if (!args.project || !outDir || !rendererId) {
    jsonExit({
      ok: false,
      code: "build_worker_invalid_args",
      message: "renderer-snapshot requires --project, --renderer and --out.",
      step: "worker",
      rendererId,
    }, 1);
  }
  const projectDir = resolveProjectDir(args.project);

  const rendererDir = realpathSync(path.join(projectDir, "renderers", rendererId));
  const diagnostics = rendererDiagnostics({ projectDir, rendererDir, rendererId });
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    jsonExit(diagnosticFailure(diagnostics, rendererId), 1);
  }

  const meta = readProjectJson(projectDir, "content/meta.json", rendererId);
  const manifest = readProjectJson(projectDir, "content/manifest.json", rendererId);
  const stage = snapshotStage(meta);

  const snapshotDir = path.join(outDir, ".vibegal-snapshot");
  await mkdir(snapshotDir, { recursive: true });

  const scenes = await probeSnapshotScenes(snapshotDir, manifest);

  const rendererEntry = path.join(rendererDir, "index.tsx");
  const snapshotHostEntry = path.join(studioRoot, "src/export/snapshotHost.ts");
  const generatedEntry = path.join(snapshotDir, "snapshot-entry.tsx");
  await writeFile(generatedEntry, [
    `import rendererManifest from ${JSON.stringify(toPosixPath(rendererEntry))};`,
    `import { startVibeGalSnapshotHost } from ${JSON.stringify(toPosixPath(snapshotHostEntry))};`,
    "startVibeGalSnapshotHost(rendererManifest, {",
    `  manifest: ${JSON.stringify(manifest)},`,
    `  stage: ${JSON.stringify(stage)},`,
    `  contentBase: "/content/",`,
    "});",
    "",
  ].join("\n"), "utf8");

  try {
    await esbuild.build({
      entryPoints: [generatedEntry],
      outfile: path.join(snapshotDir, "bundle.js"),
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      jsx: "automatic",
      sourcemap: false,
      logLevel: "silent",
      absWorkingDir: repoRoot,
      define: {
        "process.env.NODE_ENV": JSON.stringify("production"),
      },
      plugins: [rendererImportGuardPlugin({ projectDir, rendererDir, rendererId })],
    });
  } catch (error) {
    jsonExit(rendererCompileFailure(error, rendererId), 1);
  }

  const sceneSummaries = scenes.map(({ id, title }) => ({ id, title }));
  await writeFile(path.join(snapshotDir, "snapshot.html"), [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    "  <title>VibeGal Renderer Snapshot</title>",
    "  <style>",
    "    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }",
    "  </style>",
    "</head>",
    "<body>",
    '  <div id="root"></div>',
    '  <script type="module" src="./bundle.js"></script>',
    "</body>",
    "</html>",
    "",
  ].join("\n"), "utf8");
  await writeFile(
    path.join(snapshotDir, "scenes.json"),
    `${JSON.stringify({ scenes: sceneSummaries, stage }, null, 2)}\n`,
    "utf8",
  );

  jsonExit({
    ok: true,
    rendererId,
    scenes: sceneSummaries,
    stage,
    snapshotDir,
  }, 0);
}

main().catch((error) => {
  jsonExit({
    ok: false,
    code: "build_worker_failed",
    message: error instanceof Error ? (process.env.VIBEGAL_WORKER_DEBUG ? (error.stack ?? error.message) : error.message) : String(error),
    step: "worker",
  }, 1);
});
