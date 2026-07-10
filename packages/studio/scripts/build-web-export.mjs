#!/usr/bin/env node
import { mkdir, rm, writeFile } from "node:fs/promises";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import ts from "typescript";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(studioRoot, "../..");
const requireFromStudio = createRequire(path.join(studioRoot, "package.json"));
const allowedRendererBareImports = new Set([
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-dom",
  "react-dom/client",
  "@vibegal/engine",
]);

const allowedBareImportPaths = new Map([
  ["react", requireFromStudio.resolve("react")],
  ["react/jsx-runtime", requireFromStudio.resolve("react/jsx-runtime")],
  ["react/jsx-dev-runtime", requireFromStudio.resolve("react/jsx-dev-runtime")],
  ["react-dom", requireFromStudio.resolve("react-dom")],
  ["react-dom/client", requireFromStudio.resolve("react-dom/client")],
  ["@vibegal/engine", path.join(repoRoot, "packages/engine/src/index.ts")],
  ["@vibegal/contracts", path.join(repoRoot, "packages/contracts/src/index.ts")],
  ["@vibegal/contracts/schema", path.join(repoRoot, "packages/contracts/src/schema.ts")],
  ["@vibegal/contracts/types", path.join(repoRoot, "packages/contracts/src/types.ts")],
  ["zod", requireFromStudio.resolve("zod")],
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

function lineColumnAt(source, index) {
  const before = source.slice(0, Math.max(0, index));
  const lines = before.split(/\r\n|\n|\r/);
  const line = lines.length;
  const column = lines.at(-1).length + 1;
  const snippet = source.split(/\r\n|\n|\r/)[line - 1] ?? "";
  return { line, column, snippet };
}

function rendererDiagnostic({ code, rendererId, step, message, file, source = "", index = 0 }) {
  return {
    severity: "error",
    code,
    rendererId,
    step,
    message,
    file,
    ...lineColumnAt(source, index),
  };
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

function rendererSourceFiles(dir) {
  const files = [];
  function visit(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(full);
      } else if (entry.isFile() && /\.(tsx?|jsx?)$/.test(entry.name)) {
        files.push(full);
      }
    }
  }
  visit(dir);
  files.sort();
  return files;
}

function relativeProjectFile(projectDir, filePath) {
  return path.relative(projectDir, filePath).replaceAll(path.sep, "/");
}

function specifierOffset(matchText, specifier) {
  const doubleQuoted = matchText.indexOf(`"${specifier}"`);
  if (doubleQuoted >= 0) return doubleQuoted;
  const singleQuoted = matchText.indexOf(`'${specifier}'`);
  return singleQuoted >= 0 ? singleQuoted : 0;
}

function unsupportedImportDiagnostics({ projectDir, rendererDir, rendererId }) {
  const diagnostics = [];
  const importPattern = /\b(?:import\s+(?:[^"'()]+?\s+from\s*)?|export\s+[^"']+?\s+from\s*|import\s*\(\s*)["']([^"']+)["']/g;
  for (const filePath of rendererSourceFiles(rendererDir)) {
    const source = readFileSync(filePath, "utf8");
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      if (!isBareImport(specifier) || allowedBareImportPaths.has(specifier)) continue;
      const quoteIndex = (match.index ?? 0) + specifierOffset(match[0], specifier);
      diagnostics.push(rendererDiagnostic({
        code: "renderer_unsupported_import",
        rendererId,
        step: "compile",
        message: `Unsupported renderer bare import: ${specifier}.`,
        file: relativeProjectFile(projectDir, filePath),
        source,
        index: quoteIndex,
      }));
    }
  }
  return diagnostics;
}

function propertyIndex(source, propertyName) {
  const match = new RegExp(`\\b${propertyName}\\s*:`).exec(source);
  return match?.index ?? 0;
}

function firstStringProperty(source, propertyName) {
  const match = new RegExp(`\\b${propertyName}\\s*:\\s*["']([^"']+)["']`).exec(source);
  return match?.[1];
}

function firstNumberProperty(source, propertyName) {
  const match = new RegExp(`\\b${propertyName}\\s*:\\s*(\\d+)`).exec(source);
  return match ? Number(match[1]) : undefined;
}

function rendererManifestDiagnostics({ projectDir, rendererDir, rendererId }) {
  const entry = path.join(rendererDir, "index.tsx");
  const file = relativeProjectFile(projectDir, entry);
  const source = readFileSync(entry, "utf8");
  const diagnostics = [];
  const exportIndex = source.indexOf("export default");
  if (exportIndex < 0) {
    diagnostics.push(rendererDiagnostic({
      code: "renderer_missing_default_export",
      rendererId,
      step: "manifest",
      message: `Renderer ${rendererId} must default-export a RendererManifest.`,
      file,
      source,
      index: 0,
    }));
  }

  const manifestId = firstStringProperty(source, "id");
  if (manifestId != null && manifestId !== rendererId) {
    diagnostics.push(rendererDiagnostic({
      code: "renderer_manifest_id_mismatch",
      rendererId,
      step: "manifest",
      message: `Renderer manifest id must match directory id "${rendererId}".`,
      file,
      source,
      index: propertyIndex(source, "id"),
    }));
  }

  const contractVersion = firstNumberProperty(source, "contractVersion");
  if (contractVersion == null) {
    diagnostics.push(rendererDiagnostic({
      code: "renderer_contract_missing",
      rendererId,
      step: "contract",
      message: `Renderer ${rendererId} is missing contractVersion.`,
      file,
      source,
      index: exportIndex >= 0 ? exportIndex : 0,
    }));
  } else if (contractVersion !== 1) {
    diagnostics.push(rendererDiagnostic({
      code: "renderer_contract_unsupported",
      rendererId,
      step: "contract",
      message: `Unsupported renderer contract version ${contractVersion}; expected 1.`,
      file,
      source,
      index: propertyIndex(source, "contractVersion"),
    }));
  }

  return diagnostics;
}

function rendererDiagnostics({ projectDir, rendererDir, rendererId }) {
  return [
    ...unsupportedImportDiagnostics({ projectDir, rendererDir, rendererId }),
    ...rendererManifestDiagnostics({ projectDir, rendererDir, rendererId }),
    ...rendererTypecheckDiagnostics({ projectDir, rendererDir, rendererId }),
  ];
}

function rendererTypecheckDiagnostics({ projectDir, rendererDir, rendererId }) {
  const compilerOptions = {
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    baseUrl: repoRoot,
    paths: {
      "@vibegal/engine": ["packages/engine/src/index.ts"],
      "@vibegal/contracts": ["packages/contracts/src/index.ts"],
      "@vibegal/contracts/*": ["packages/contracts/src/*"],
      react: ["packages/studio/node_modules/@types/react/index.d.ts"],
      "react/*": ["packages/studio/node_modules/@types/react/*"],
      "react-dom": ["packages/studio/node_modules/@types/react-dom/index.d.ts"],
      "react-dom/*": ["packages/studio/node_modules/@types/react-dom/*"],
    },
  };
  const sourceFiles = rendererSourceFiles(rendererDir).filter((file) => /\.tsx?$/.test(file));
  const program = ts.createProgram(sourceFiles, compilerOptions);
  return ts.getPreEmitDiagnostics(program)
    .filter((diagnostic) => {
      if (diagnostic.category !== ts.DiagnosticCategory.Error || !diagnostic.file) return false;
      return isRendererFile(diagnostic.file.fileName, rendererDir);
    })
    .map((diagnostic) => {
      const sourceFile = diagnostic.file;
      const start = diagnostic.start ?? 0;
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
      return rendererDiagnostic({
        code: "renderer_typecheck_failed",
        rendererId,
        step: "typecheck",
        message: `TS${diagnostic.code}: ${message}`,
        file: relativeProjectFile(projectDir, sourceFile.fileName),
        source: sourceFile.text,
        index: start,
      });
    });
}

function diagnosticFailure(diagnostics, fallbackRendererId) {
  const first = diagnostics[0];
  return {
    ok: false,
    code: first?.code ?? "renderer_check_failed",
    message: first?.message ?? "Renderer check failed.",
    step: first?.step ?? "renderer",
    rendererId: first?.rendererId ?? fallbackRendererId,
    file: first?.file,
    line: first?.line,
    column: first?.column,
    snippet: first?.snippet,
    diagnostics,
  };
}

function rendererImportGuardPlugin({ projectDir, rendererDir, rendererId }) {
  return {
    name: "vibegal-renderer-import-guard",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (!isBareImport(args.path) || !args.importer) {
          return null;
        }
        const rendererImport = isRendererFile(args.importer, rendererDir);
        if (!rendererImport && allowedBareImportPaths.has(args.path)) {
          return { path: allowedBareImportPaths.get(args.path) };
        }
        if (!rendererImport) return null;
        if (allowedRendererBareImports.has(args.path)) {
          return allowedBareImportPaths.has(args.path)
            ? { path: allowedBareImportPaths.get(args.path) }
            : null;
        }

        const importer = realpathSync(args.importer);
        const location = rendererImportLocation(importer, args.path);
        const file = path.relative(projectDir, importer).replaceAll(path.sep, "/");
        return {
          errors: [{
            text: `VIBEGAL_UNSUPPORTED_RENDERER_IMPORT:${args.path}`,
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
    snippet: first.location?.lineText,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectDir = realpathSync(path.resolve(args.project ?? ""));
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
    const first = firstEsbuildError(error);
    const unsupported = first?.text?.startsWith("VIBEGAL_UNSUPPORTED_RENDERER_IMPORT:");
    jsonExit({
      ok: false,
      code: unsupported ? "renderer_unsupported_import" : "renderer_compile_failed",
      message: unsupported
        ? "Renderer imports an unsupported bare module. V1 allows only React, React DOM, @vibegal/engine and relative imports."
        : (first?.text ?? (error instanceof Error ? error.message : String(error))),
      step: "renderer",
      rendererId,
      file: first?.file,
      line: first?.line,
      column: first?.column,
      snippet: first?.snippet,
      diagnostics: [{
        severity: "error",
        code: unsupported ? "renderer_unsupported_import" : "renderer_compile_failed",
        rendererId,
        step: "compile",
        message: unsupported
          ? "Renderer imports an unsupported bare module. V1 allows only React, React DOM, @vibegal/engine and relative imports."
          : (first?.text ?? (error instanceof Error ? error.message : String(error))),
        file: first?.file,
        line: first?.line,
        column: first?.column,
        snippet: first?.snippet,
      }],
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
