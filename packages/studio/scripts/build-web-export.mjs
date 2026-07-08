#!/usr/bin/env node
import { mkdir, rm, writeFile } from "node:fs/promises";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(studioRoot, "../..");
const requireFromStudio = createRequire(path.join(studioRoot, "package.json"));
const allowedRendererBareImports = new Set([
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-dom",
  "react-dom/client",
  "@galstudio/engine",
]);

const allowedBareImportPaths = new Map([
  ["react", requireFromStudio.resolve("react")],
  ["react/jsx-runtime", requireFromStudio.resolve("react/jsx-runtime")],
  ["react/jsx-dev-runtime", requireFromStudio.resolve("react/jsx-dev-runtime")],
  ["react-dom", requireFromStudio.resolve("react-dom")],
  ["react-dom/client", requireFromStudio.resolve("react-dom/client")],
  ["@galstudio/engine", path.join(repoRoot, "packages/engine/src/index.ts")],
]);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const value = argv[i + 1];
    if (value == null || value.startsWith("--")) {
      args[key] = "true";
    } else {
      args[key] = value;
      i += 1;
    }
  }
  return args;
}

function jsonExit(payload, code) {
  const text = JSON.stringify(payload, null, 2);
  if (payload.ok) {
    console.log(text);
  } else {
    console.error(text);
  }
  process.exit(code);
}

function isBareImport(specifier) {
  return !specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.startsWith("file:");
}

function isRendererFile(filePath, rendererDir) {
  let realFilePath = filePath;
  try {
    realFilePath = realpathSync(filePath);
  } catch {
    // Keep esbuild's path when the file cannot be canonicalized.
  }
  const rel = path.relative(rendererDir, realFilePath);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function rendererImportLocation(importer, specifier) {
  try {
    const source = readFileSync(importer, "utf8");
    const quoted = [`"${specifier}"`, `'${specifier}'`]
      .map((needle) => ({ needle, index: source.indexOf(needle) }))
      .filter((item) => item.index >= 0)
      .sort((a, b) => a.index - b.index)[0];
    if (!quoted) return { line: 1, column: 1 };
    const before = source.slice(0, quoted.index);
    const lines = before.split(/\r\n|\n|\r/);
    return { line: lines.length, column: lines.at(-1).length + 1 };
  } catch {
    return { line: 1, column: 1 };
  }
}

function rendererImportGuardPlugin({ projectDir, rendererDir, rendererId }) {
  return {
    name: "galstudio-renderer-import-guard",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (!isBareImport(args.path) || !args.importer) {
          return null;
        }
        if (allowedBareImportPaths.has(args.path)) {
          return { path: allowedBareImportPaths.get(args.path) };
        }
        if (!isRendererFile(args.importer, rendererDir)) return null;
        if (allowedRendererBareImports.has(args.path)) return null;

        const importer = realpathSync(args.importer);
        const location = rendererImportLocation(importer, args.path);
        const file = path.relative(projectDir, importer).replaceAll(path.sep, "/");
        return {
          errors: [{
            text: `GALSTUDIO_UNSUPPORTED_RENDERER_IMPORT:${args.path}`,
            location: {
              file,
              line: location.line,
              column: location.column,
              length: args.path.length + 2,
              lineText: readFileSync(importer, "utf8").split(/\r\n|\n|\r/)[location.line - 1] ?? "",
            },
            detail: { rendererId, file, specifier: args.path },
          }],
        };
      });
    },
  };
}

function firstEsbuildError(error) {
  const first = error?.errors?.[0];
  if (!first) return null;
  return {
    text: first.text ?? String(error),
    file: first.location?.file,
    line: first.location?.line,
    column: first.location?.column,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectDir = realpathSync(path.resolve(args.project ?? ""));
  const outDir = path.resolve(args.out ?? "");
  const rendererId = args.renderer;
  if (!projectDir || !outDir || !rendererId) {
    jsonExit({
      ok: false,
      code: "build_worker_invalid_args",
      message: "build-web-export requires --project, --out and --renderer.",
      step: "worker",
      rendererId,
    }, 1);
  }

  const rendererDir = realpathSync(path.join(projectDir, "renderers", rendererId));
  const rendererEntry = path.join(rendererDir, "index.tsx");
  const runtimeEntry = path.join(studioRoot, "src/export/webRuntimeHost.ts");
  const tempDir = path.join(outDir, ".galstudio-build");
  const generatedEntry = path.join(tempDir, "web-export-entry.tsx");

  await mkdir(tempDir, { recursive: true });
  await writeFile(generatedEntry, [
    `import rendererManifest from ${JSON.stringify(rendererEntry)};`,
    `import { startGalStudioWebRuntime } from ${JSON.stringify(runtimeEntry)};`,
    `globalThis.__GALSTUDIO_SELECTED_RENDERER_ID__ = ${JSON.stringify(rendererId)};`,
    "startGalStudioWebRuntime(rendererManifest).catch((error) => {",
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
    const first = firstEsbuildError(error);
    const unsupported = first?.text?.startsWith("GALSTUDIO_UNSUPPORTED_RENDERER_IMPORT:");
    jsonExit({
      ok: false,
      code: unsupported ? "renderer_unsupported_import" : "renderer_compile_failed",
      message: unsupported
        ? "Renderer imports an unsupported bare module. V1 allows only React, React DOM, @galstudio/engine and relative imports."
        : (first?.text ?? (error instanceof Error ? error.message : String(error))),
      step: "renderer",
      rendererId,
      file: first?.file,
      line: first?.line,
      column: first?.column,
    }, 1);
  }
}

main().catch((error) => {
  jsonExit({
    ok: false,
    code: "build_worker_failed",
    message: error instanceof Error ? error.message : String(error),
    step: "worker",
  }, 1);
});
