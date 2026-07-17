#!/usr/bin/env node
import { mkdir, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import path from "node:path";
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectDir = resolveProjectDir(args.project);
  const outDir = args.out ? path.resolve(args.out) : "";
  const rendererId = args.renderer;
  const checkOnly = args["check-only"] === "true";
  if (!projectDir || (!outDir && !checkOnly) || !rendererId) {
    jsonExit({
      ok: false,
      code: "build_worker_invalid_args",
      message: "build-web-export requires --project, --renderer and --out unless --check-only is set.",
      step: "worker",
      rendererId,
    }, 1);
  }

  const rendererDir = realpathSync(path.join(projectDir, "renderers", rendererId));
  const diagnostics = rendererDiagnostics({ projectDir, rendererDir, rendererId });
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    jsonExit(diagnosticFailure(diagnostics, rendererId), 1);
  }
  if (checkOnly) {
    jsonExit({ ok: true, rendererId, diagnostics: [] }, 0);
  }

  const rendererEntry = path.join(rendererDir, "index.tsx");
  const runtimeEntry = path.join(studioRoot, "src/export/webRuntimeHost.ts");
  const tempDir = path.join(outDir, ".vibegal-build");
  const generatedEntry = path.join(tempDir, "web-export-entry.tsx");

  await Promise.all([
    mkdir(tempDir, { recursive: true }),
    mkdir(path.join(outDir, "runtime"), { recursive: true }),
    mkdir(path.join(outDir, "renderer"), { recursive: true }),
  ]);
  await writeFile(generatedEntry, [
    `import rendererManifest from ${JSON.stringify(rendererEntry)};`,
    `import { startVibeGalWebRuntime } from ${JSON.stringify(runtimeEntry)};`,
    `globalThis.__VIBEGAL_SELECTED_RENDERER_ID__ = ${JSON.stringify(rendererId)};`,
    "startVibeGalWebRuntime(rendererManifest).catch((error) => {",
    "  console.error(error);",
    "  const root = document.getElementById('root');",
    "  if (root) root.textContent = error instanceof Error ? error.message : String(error);",
    "});",
    "",
  ].join("\n"));

  try {
    await esbuild.build({
      entryPoints: [generatedEntry],
      outfile: path.join(outDir, "runtime/bundle.js"),
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      jsx: "automatic",
      sourcemap: true,
      logLevel: "silent",
      absWorkingDir: repoRoot,
      define: {
        "process.env.NODE_ENV": JSON.stringify("production"),
      },
      plugins: [rendererImportGuardPlugin({ projectDir, rendererDir, rendererId })],
    });

    await writeFile(
      path.join(outDir, "renderer/bundle.js"),
      [
        `export const rendererId = ${JSON.stringify(rendererId)};`,
        "export const bundledInto = '../runtime/bundle.js';",
        "",
      ].join("\n"),
    );
    await rm(tempDir, { recursive: true, force: true });
    jsonExit({ ok: true, rendererId }, 0);
  } catch (error) {
    jsonExit(rendererCompileFailure(error, rendererId), 1);
  }
}

main().catch((error) => {
  jsonExit({
    ok: false,
    code: "build_worker_failed",
    message: error instanceof Error ? (process.env.VIBEGAL_WORKER_DEBUG ? (error.stack ?? error.message) : error.message) : String(error),
    step: "worker",
  }, 1);
});
