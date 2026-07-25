/**
 * 渲染层 worker 共享模块 —— build-web-export 与 renderer-snapshot 共用的基础设施。
 *
 * 两个 worker 复用同一套能力：
 *   - 渲染层 import 白名单（allowedRendererBareImports / allowedBareImportPaths）
 *   - 渲染层静态诊断（unsupported import / manifest / typecheck 三件套）
 *   - esbuild import 守卫插件与结构化 JSON 失败输出
 *
 * 注意：本模块会被 prepare-web-exporter 拷进独立分发的 exporter 目录，
 * studioRoot / repoRoot 都从本文件位置推导，不能依赖仓库外的固定路径。
 */
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const studioRoot = path.resolve(scriptDir, "..");
export const repoRoot = path.resolve(studioRoot, "../..");
const requireFromStudio = createRequire(path.join(studioRoot, "package.json"));

export const allowedRendererBareImports = new Set([
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-dom",
  "react-dom/client",
  "@vibegal/engine",
]);

export const allowedBareImportPaths = new Map([
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

export function parseArgs(argv) {
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

export function jsonExit(payload, code) {
  const text = JSON.stringify(payload, null, 2);
  if (payload.ok) {
    console.log(text);
  } else {
    console.error(text);
  }
  process.exit(code);
}

// Windows 上 canonicalize 过的 \\?\ UNC 前缀会让 realpathSync 崩溃，先剥掉。
export function stripUncPrefix(value) {
  return value.startsWith("\\\\?\\") ? value.slice(4) : value;
}

/** 把 --project 参数解析成真实项目目录；失败时抛带中文说明的 Error（由 main 的 catch 统一转成 JSON）。 */
export function resolveProjectDir(rawPath) {
  try {
    return realpathSync(path.resolve(stripUncPrefix(rawPath ?? "")));
  } catch (error) {
    throw new Error(`无法解析项目目录 ${JSON.stringify(rawPath)}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function lineColumnAt(source, index) {
  const before = source.slice(0, Math.max(0, index));
  const lines = before.split(/\r\n|\n|\r/);
  const line = lines.length;
  const column = lines.at(-1).length + 1;
  const snippet = source.split(/\r\n|\n|\r/)[line - 1] ?? "";
  return { line, column, snippet };
}

export function rendererDiagnostic({ code, rendererId, step, message, file, source = "", index = 0 }) {
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

export function isBareImport(specifier) {
  return !specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.startsWith("file:");
}

export function isRendererFile(filePath, rendererDir) {
  let realFilePath = filePath;
  try {
    realFilePath = realpathSync(filePath);
  } catch {
    // Keep esbuild's path when the file cannot be canonicalized.
  }
  const rel = path.relative(rendererDir, realFilePath);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function rendererImportLocation(importer, specifier) {
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

export function rendererSourceFiles(dir) {
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

export function relativeProjectFile(projectDir, filePath) {
  return path.relative(projectDir, filePath).replaceAll(path.sep, "/");
}

export function specifierOffset(matchText, specifier) {
  const doubleQuoted = matchText.indexOf(`"${specifier}"`);
  if (doubleQuoted >= 0) return doubleQuoted;
  const singleQuoted = matchText.indexOf(`'${specifier}'`);
  return singleQuoted >= 0 ? singleQuoted : 0;
}

export function unsupportedImportDiagnostics({ projectDir, rendererDir, rendererId }) {
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

function isIdentifierStart(char) {
  return char != null && /[A-Za-z_$]/.test(char);
}

function isIdentifierPart(char) {
  return char != null && /[A-Za-z0-9_$]/.test(char);
}

function skipQuoted(source, start, quote) {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2;
      continue;
    }
    if (source[index] === quote) return index + 1;
    index += 1;
  }
  return source.length;
}

function findMatchingObjectEnd(source, start) {
  let depth = 0;
  let index = start;
  while (index < source.length) {
    const char = source[index];
    if (char === "'" || char === '"' || char === "`") {
      index = skipQuoted(source, index, char);
      continue;
    }
    if (char === "/" && source[index + 1] === "/") {
      const newline = source.indexOf("\n", index + 2);
      index = newline < 0 ? source.length : newline + 1;
      continue;
    }
    if (char === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end < 0 ? source.length : end + 2;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
    index += 1;
  }
  return null;
}

function manifestObjectRange(source) {
  const exportIndex = source.indexOf("export default");
  if (exportIndex < 0) return null;
  let index = exportIndex + "export default".length;
  while (/\s/.test(source[index] ?? "")) index += 1;
  if (source[index] === "{") {
    const end = findMatchingObjectEnd(source, index);
    return end == null ? null : { start: index, end };
  }
  const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(source.slice(index));
  if (!match) return null;
  const identifier = match[0];
  const declarationPattern = new RegExp(
    `\\b(?:const|let|var)\\s+${identifier}\\s*(?:\\:\\s*[^=;]+)?=\\s*\\{`,
    "g",
  );
  let declaration;
  for (const candidate of source.matchAll(declarationPattern)) {
    if ((candidate.index ?? -1) >= exportIndex) break;
    declaration = candidate;
  }
  if (!declaration) return null;
  const start = (declaration.index ?? 0) + declaration[0].lastIndexOf("{");
  const end = findMatchingObjectEnd(source, start);
  return end == null ? null : { start, end };
}

function topLevelPropertyIndex(source, range, propertyName) {
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let index = range.start + 1;
  while (index < range.end - 1) {
    const char = source[index];
    if (char === "'" || char === '"' || char === "`") {
      index = skipQuoted(source, index, char);
      continue;
    }
    if (char === "/" && source[index + 1] === "/") {
      const newline = source.indexOf("\n", index + 2);
      index = newline < 0 ? range.end : newline + 1;
      continue;
    }
    if (char === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end < 0 ? range.end : end + 2;
      continue;
    }
    if (braceDepth === 0 && bracketDepth === 0 && parenDepth === 0 && source.startsWith(propertyName, index)) {
      const before = source[index - 1];
      const after = source[index + propertyName.length];
      if (!isIdentifierPart(before) && !isIdentifierPart(after)) {
        let cursor = index + propertyName.length;
        while (/\s/.test(source[cursor] ?? "")) cursor += 1;
        if (source[cursor] === ":") return index;
      }
    }
    if (char === "{") braceDepth += 1;
    else if (char === "}") braceDepth -= 1;
    else if (char === "[") bracketDepth += 1;
    else if (char === "]") bracketDepth -= 1;
    else if (char === "(") parenDepth += 1;
    else if (char === ")") parenDepth -= 1;
    index += 1;
  }
  return null;
}

function propertyValueStart(source, propertyIndex, propertyName) {
  let index = propertyIndex + propertyName.length;
  while (/\s/.test(source[index] ?? "")) index += 1;
  if (source[index] !== ":") return null;
  index += 1;
  while (/\s/.test(source[index] ?? "")) index += 1;
  return index;
}

function manifestPropertyIndex(source, propertyName) {
  const range = manifestObjectRange(source);
  return range == null ? null : topLevelPropertyIndex(source, range, propertyName);
}

function propertyIndex(source, propertyName) {
  return manifestPropertyIndex(source, propertyName) ?? 0;
}

function firstStringProperty(source, propertyName) {
  const index = manifestPropertyIndex(source, propertyName);
  if (index == null) return undefined;
  const valueStart = propertyValueStart(source, index, propertyName);
  if (valueStart == null || !["'", '"'].includes(source[valueStart])) return undefined;
  const end = skipQuoted(source, valueStart, source[valueStart]);
  return source.slice(valueStart + 1, end - 1);
}

function firstNumberProperty(source, propertyName) {
  const index = manifestPropertyIndex(source, propertyName);
  if (index == null) return undefined;
  const valueStart = propertyValueStart(source, index, propertyName);
  if (valueStart == null) return undefined;
  const match = /^\d+/.exec(source.slice(valueStart));
  return match ? Number(match[0]) : undefined;
}

export function rendererManifestDiagnostics({ projectDir, rendererDir, rendererId }) {
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

export function rendererDiagnostics({ projectDir, rendererDir, rendererId }) {
  return [
    ...unsupportedImportDiagnostics({ projectDir, rendererDir, rendererId }),
    ...rendererManifestDiagnostics({ projectDir, rendererDir, rendererId }),
    ...rendererTypecheckDiagnostics({ projectDir, rendererDir, rendererId }),
  ];
}

export function rendererTypecheckDiagnostics({ projectDir, rendererDir, rendererId }) {
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

export function diagnosticFailure(diagnostics, fallbackRendererId) {
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

export function rendererImportGuardPlugin({ projectDir, rendererDir, rendererId }) {
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

export function firstEsbuildError(error) {
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

/** esbuild 打包渲染层失败时的结构化 JSON payload；对白名单违规做特判。 */
export function rendererCompileFailure(error, rendererId) {
  const first = firstEsbuildError(error);
  const unsupported = first?.text?.startsWith("VIBEGAL_UNSUPPORTED_RENDERER_IMPORT:");
  const code = unsupported ? "renderer_unsupported_import" : "renderer_compile_failed";
  const message = unsupported
    ? "Renderer imports an unsupported bare module. V1 allows only React, React DOM, @vibegal/engine and relative imports."
    : (first?.text ?? (error instanceof Error ? error.message : String(error)));
  return {
    ok: false,
    code,
    message,
    step: "renderer",
    rendererId,
    file: first?.file,
    line: first?.line,
    column: first?.column,
    snippet: first?.snippet,
    diagnostics: [{
      severity: "error",
      code,
      rendererId,
      step: "compile",
      message,
      file: first?.file,
      line: first?.line,
      column: first?.column,
      snippet: first?.snippet,
    }],
  };
}
