#!/usr/bin/env node
/**
 * 生成随项目分发的渲染层契约类型声明（单文件 engine.d.ts）。
 *
 * 入口是 packages/engine/src/rendererPublic.ts（渲染层公共契约面）。
 * 用 TypeScript checker 把每个导出符号展开成自包含声明：
 * zod 推断类型（Manifest / SaveSlotRecord 等）被展开成结构字面量，
 * 因此产物不依赖 zod / @vibegal/contracts，项目目录里单独即可用。
 *
 * 输出：packages/studio/src-tauri/generated/engine-types/engine.d.ts
 * 该产物被 src-tauri/src/backend/project/templates.rs include_str! 嵌入，
 * 项目初始化时写入 .galstudio/types/engine.d.ts。
 *
 * 用法：
 *   node packages/studio/scripts/generate-engine-types.mjs [--out <file>]
 * 漂移检查：scripts/check-engine-types-drift.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(studioRoot, "../..");
const ENTRY = path.join(repoRoot, "packages/engine/src/rendererPublic.ts");
const DEFAULT_OUT = path.join(studioRoot, "src-tauri/generated/engine-types/engine.d.ts");

function parseOutArg(argv) {
  const index = argv.indexOf("--out");
  return index >= 0 && argv[index + 1]
    ? path.resolve(argv[index + 1])
    : DEFAULT_OUT;
}

const TYPE_FORMAT_FLAGS = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias;

// 这些模块是「类型侧」模块：只取它们的类型导出。
// 其中的 zod schema 常量 / 持久化 helper 是宿主侧实现，不进渲染层契约面；
// 新增面向渲染层的运行时 API 应走 renderer.ts / state.ts 导出。
const TYPE_ONLY_MODULES = new Set(["runtimeContract.ts", "types.ts"]);

function isValueDeclaration(declaration) {
  return ts.isClassDeclaration(declaration)
    || ts.isFunctionDeclaration(declaration)
    || ts.isVariableDeclaration(declaration);
}

function createContractProgram() {
  return ts.createProgram([ENTRY], {
    strict: true,
    skipLibCheck: true,
    ignoreDeprecations: "6.0",
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    esModuleInterop: true,
    baseUrl: repoRoot,
    paths: {
      "@vibegal/contracts": ["packages/contracts/src/index.ts"],
      "@vibegal/contracts/*": ["packages/contracts/src/*"],
      react: ["packages/studio/node_modules/@types/react/index.d.ts"],
      "react/*": ["packages/studio/node_modules/@types/react/*"],
    },
  });
}

function formatJsdoc(parts) {
  const text = parts.trim();
  if (!text) return "";
  return `/** ${text.split("\n").map((line) => line.trimEnd()).join("\n * ")} */\n`;
}

const PARAMETER_PROPERTY_MODIFIERS = new Set([
  ts.SyntaxKind.ReadonlyKeyword,
  ts.SyntaxKind.PublicKeyword,
  ts.SyntaxKind.PrivateKeyword,
  ts.SyntaxKind.ProtectedKeyword,
]);

/** 把 ClassDeclaration 转成 ambient class（d.ts 不允许初始化器与参数属性）。 */
function renderClassDeclaration(checker, declaration, name) {
  const heritage = declaration.heritageClauses?.length
    ? ` ${declaration.heritageClauses.map((clause) => clause.getText()).join(" ")}`
    : "";
  const lines = [`export declare class ${name}${heritage} {`];
  const parameterFields = [];
  for (const member of declaration.members) {
    if (ts.isConstructorDeclaration(member)) {
      const params = member.parameters.map((param) => {
        const isParameterProperty = param.modifiers?.some((modifier) => PARAMETER_PROPERTY_MODIFIERS.has(modifier.kind));
        if (isParameterProperty) {
          parameterFields.push(`  readonly ${param.name.getText()}${param.type ? `: ${param.type.getText()}` : ""};`);
        }
        return `${param.name.getText()}${param.type ? `: ${param.type.getText()}` : ""}`;
      });
      lines.push(`  constructor(${params.join(", ")});`);
    } else if (ts.isPropertyDeclaration(member)) {
      const readonly = member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword) ? "readonly " : "";
      const typeText = member.type
        ? member.type.getText()
        : checker.typeToString(checker.getTypeOfSymbol(member.symbol), undefined, TYPE_FORMAT_FLAGS);
      lines.push(`  ${readonly}${member.name.getText()}: ${typeText};`);
    } else if (ts.isMethodDeclaration(member)) {
      lines.push(`  ${member.getText().replace(/\s*\{[\s\S]*\}\s*$/, ";")}`);
    }
  }
  lines.push(...parameterFields, "}");
  return lines.join("\n");
}

function renderExport(checker, exported) {
  const sym = (exported.flags & ts.SymbolFlags.Alias) !== 0
    ? checker.getAliasedSymbol(exported)
    : exported;
  const name = exported.name;
  const declaration = sym.declarations?.[0];
  if (!declaration) {
    throw new Error(`导出 ${name} 缺少声明，无法展开`);
  }
  if (ts.isClassDeclaration(declaration)) {
    return renderClassDeclaration(checker, declaration, name);
  }
  if (ts.isFunctionDeclaration(declaration) || ts.isVariableDeclaration(declaration)) {
    const typeText = checker.typeToString(checker.getTypeOfSymbol(sym), undefined, TYPE_FORMAT_FLAGS);
    return `export declare const ${name}: ${typeText};`;
  }
  if (ts.isInterfaceDeclaration(declaration)) {
    // 接口保留源码声明（名字互引保持可读）；import("./mod").X 形式的
    // 内联引用改写为同文件内的名字引用（闭包内符号都会随本文件发出）。
    return declaration
      .getText()
      .replace(/import\("\.\/[^"]+"\)\./g, "");
  }
  if (ts.isTypeAliasDeclaration(declaration) || ts.isEnumDeclaration(declaration)) {
    // 类型别名（含 z.infer 反推的结构类型）由 checker 展开成自包含结构，
    // 展开的引用里的接口名会保留（InTypeAlias），与上方接口声明呼应。
    const typeText = checker.typeToString(checker.getDeclaredTypeOfSymbol(sym), undefined, TYPE_FORMAT_FLAGS);
    return `export type ${name} = ${typeText};`;
  }
  throw new Error(`未处理的导出形式: ${name} (${ts.SyntaxKind[declaration.kind]})`);
}

export function generateEngineTypesSource() {
  const program = createContractProgram();
  const preEmit = ts.getPreEmitDiagnostics(program);
  if (preEmit.length > 0) {
    const text = preEmit
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " "))
      .join("\n");
    throw new Error(`engine 契约源码存在类型错误，先修复再生成：\n${text}`);
  }
  const checker = program.getTypeChecker();
  const entryFile = program.getSourceFile(ENTRY);
  if (!entryFile) throw new Error(`找不到生成入口: ${ENTRY}`);
  const moduleSymbol = checker.getSymbolAtLocation(entryFile);
  if (!moduleSymbol) throw new Error("无法解析生成入口的模块符号");

  const seen = new Set();
  const chunks = [];
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    if (exported.name === "default" || seen.has(exported.name)) continue;
    seen.add(exported.name);
    const sym = (exported.flags & ts.SymbolFlags.Alias) !== 0
      ? checker.getAliasedSymbol(exported)
      : exported;
    const declaration = sym.declarations?.[0];
    if (
      declaration
      && TYPE_ONLY_MODULES.has(path.basename(declaration.getSourceFile().fileName))
      && isValueDeclaration(declaration)
    ) {
      continue;
    }
    const jsdoc = formatJsdoc(ts.displayPartsToString(exported.getDocumentationComment(checker)));
    chunks.push(jsdoc + renderExport(checker, exported));
  }

  return [
    "// ============================================================",
    "// 由 VibeGal-Studio 生成，请勿手改。",
    "// 来源：packages/engine/src/rendererPublic.ts（@vibegal/engine 渲染层契约面）",
    "// 重新生成：node packages/studio/scripts/generate-engine-types.mjs",
    "// 漂移检查：pnpm check:engine-types",
    "// ============================================================",
    "",
    'declare module "@vibegal/engine" {',
    "",
    "// React 类型由 .galstudio/types/react.d.ts（最小 shim）提供。",
    'import type { ComponentType } from "react";',
    "",
    chunks.map((chunk) => chunk.replaceAll("export declare ", "export ").replace(/^/gm, "  ")).join("\n\n"),
    "",
    "}",
    "",
    'declare module "@galstudio/engine" {',
    '  export * from "@vibegal/engine";',
    "}",
    "",
  ].join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const outFile = parseOutArg(process.argv.slice(2));
  const source = generateEngineTypesSource();
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, source);
  process.stdout.write(`Generated engine renderer contract types: ${outFile}\n`);
}
