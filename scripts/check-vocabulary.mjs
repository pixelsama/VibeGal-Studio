#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireFromStudio = createRequire(path.join(repoRoot, "packages/studio/package.json"));
const ts = requireFromStudio("typescript");

const SOURCE_ROOTS = [
  "packages/engine/src",
  "packages/studio/src",
  "packages/studio/src-tauri/resources/default-renderer",
  "packages/studio/templates/default-renderer",
  "examples/sample-novel/renderers/default",
];

const USER_FACING_PROPERTIES = new Set([
  "collapsedLabel",
  "description",
  "detail",
  "hint",
  "label",
  "message",
  "name",
  "title",
]);

const USER_FACING_RETURN_FUNCTIONS = new Set([
  "exportIssueSourceLabel",
  "projectIssueSourceLabel",
]);

const FORBIDDEN_TERMS = [
  { pattern: /\bInspector\b/g, replacement: "属性面板" },
  { pattern: /CG Gallery/g, replacement: "CG 鉴赏" },
  { pattern: /Cleanup dry-run/gi, replacement: "清理预览" },
  { pattern: /--strict/g, replacement: "将警告视为错误" },
  { pattern: /--allow-warnings/g, replacement: "仍然允许警告" },
  { pattern: /\bWebView\b/g, replacement: "系统网页引擎" },
  { pattern: /\brenderer\b/gi, replacement: "界面风格" },
  { pattern: /渲染层/g, replacement: "界面风格" },
  { pattern: /(?<!content\/)\bmanifest\b(?!\.json)/gi, replacement: "资源登记表" },
];

const FORBIDDEN_VISIBLE_TRANSITIONS = {
  fade_in: "淡入",
  fade_out: "淡出",
  white_in: "白场淡入",
  white_out: "白场淡出",
};

const TRANSITION_LABELS = {
  ...FORBIDDEN_VISIBLE_TRANSITIONS,
  black: "黑场",
};

function normalizedPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function isSourceFile(filePath) {
  return /\.[cm]?[jt]sx?$/.test(filePath)
    && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(filePath);
}

function walkSourceFiles(root, relativeRoot) {
  const absoluteRoot = path.join(root, relativeRoot);
  if (!fs.existsSync(absoluteRoot)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && isSourceFile(absolute)) files.push(absolute);
    }
  };
  visit(absoluteRoot);
  return files;
}

function nodeText(node) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join("");
  }
  return null;
}

function propertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return null;
}

function functionNameForReturn(node) {
  let current = node.parent;
  while (current) {
    if (ts.isFunctionDeclaration(current)) return current.name?.text ?? null;
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      const parent = current.parent;
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
      return null;
    }
    current = current.parent;
  }
  return null;
}

function collectDisplayNodes(expression, out) {
  if (!expression) return;
  if (ts.isStringLiteralLike(expression) || ts.isTemplateExpression(expression)) {
    out.push(expression);
    return;
  }
  if (ts.isParenthesizedExpression(expression)) {
    collectDisplayNodes(expression.expression, out);
    return;
  }
  if (ts.isConditionalExpression(expression)) {
    collectDisplayNodes(expression.whenTrue, out);
    collectDisplayNodes(expression.whenFalse, out);
    return;
  }
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    collectDisplayNodes(expression.left, out);
    collectDisplayNodes(expression.right, out);
    return;
  }
  if (ts.isArrayLiteralExpression(expression)) {
    expression.elements.forEach((element) => collectDisplayNodes(element, out));
  }
}

function collectUserFacingNodes(sourceFile) {
  const nodes = [];
  const visit = (node) => {
    if (ts.isJsxText(node) && node.text.trim()) nodes.push(node);

    if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.text;
      if (name !== "options" && name !== "optionLabels") {
        if (ts.isStringLiteral(node.initializer)) nodes.push(node.initializer);
        else if (ts.isJsxExpression(node.initializer)) collectDisplayNodes(node.initializer.expression, nodes);
      }
    }

    if (ts.isJsxExpression(node) && ts.isJsxElement(node.parent)) {
      collectDisplayNodes(node.expression, nodes);
    }
    if (ts.isJsxExpression(node) && ts.isJsxFragment(node.parent)) {
      collectDisplayNodes(node.expression, nodes);
    }

    if (ts.isPropertyAssignment(node)) {
      const name = propertyNameText(node.name);
      if (name && USER_FACING_PROPERTIES.has(name)) collectDisplayNodes(node.initializer, nodes);
    }

    if (ts.isNewExpression(node) && node.expression.getText(sourceFile) === "Error") {
      node.arguments?.forEach((argument) => collectDisplayNodes(argument, nodes));
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sourceFile);
      if (/^(?:alert|confirm|prompt|window\.(?:alert|confirm|prompt))$/.test(callee)) {
        node.arguments.forEach((argument) => collectDisplayNodes(argument, nodes));
      }
    }

    if (ts.isReturnStatement(node) && USER_FACING_RETURN_FUNCTIONS.has(functionNameForReturn(node) ?? "")) {
      collectDisplayNodes(node.expression, nodes);
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...new Set(nodes)];
}

function jsxAttribute(element, name) {
  return element.attributes.properties.find(
    (property) => ts.isJsxAttribute(property) && property.name.text === name,
  );
}

function expressionFromJsxAttribute(attribute) {
  return attribute?.initializer && ts.isJsxExpression(attribute.initializer)
    ? attribute.initializer.expression
    : null;
}

function stringArrayFromExpression(expression) {
  if (!expression || !ts.isArrayLiteralExpression(expression)) return [];
  return expression.elements
    .filter(ts.isStringLiteralLike)
    .map((element) => element.text);
}

function stringMapFromExpression(expression) {
  if (!expression || !ts.isObjectLiteralExpression(expression)) return new Map();
  const map = new Map();
  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = propertyNameText(property.name);
    const value = nodeText(property.initializer);
    if (key && value != null) map.set(key, { value, node: property.initializer });
  }
  return map;
}

function lineForNode(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function checkTransitionLabels(sourceFile, relativePath, errors) {
  const visit = (node) => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(sourceFile) === "EnumField") {
      const options = stringArrayFromExpression(expressionFromJsxAttribute(jsxAttribute(node, "options")));
      const relevant = options.filter((option) => option in TRANSITION_LABELS);
      if (relevant.length > 0) {
        const labelsAttribute = jsxAttribute(node, "optionLabels");
        const labels = stringMapFromExpression(expressionFromJsxAttribute(labelsAttribute));
        for (const option of relevant) {
          const entry = labels.get(option);
          if (!entry || entry.value !== TRANSITION_LABELS[option]) {
            errors.push({
              path: relativePath,
              line: lineForNode(sourceFile, entry?.node ?? labelsAttribute ?? node),
              message: `转场稳定值 ${option} 必须显示为「${TRANSITION_LABELS[option]}」`,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

export function checkVocabularySources(sources) {
  const errors = [];
  for (const source of sources) {
    const relativePath = normalizedPath(source.path);
    if (!isSourceFile(relativePath)) continue;
    const kind = /\.[cm]?[jt]sx$/.test(relativePath) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(relativePath, source.text, ts.ScriptTarget.Latest, true, kind);

    for (const node of collectUserFacingNodes(sourceFile)) {
      const text = ts.isJsxText(node) ? node.text : nodeText(node);
      if (!text) continue;
      const containsScenarioSyntax = text.includes("@transition");
      for (const rule of FORBIDDEN_TERMS) {
        rule.pattern.lastIndex = 0;
        if (rule.pattern.test(text)) {
          errors.push({
            path: relativePath,
            line: lineForNode(sourceFile, node),
            message: `创作者文案含技术词「${text.trim()}」；请使用「${rule.replacement}」`,
          });
        }
      }
      for (const [value, replacement] of Object.entries(FORBIDDEN_VISIBLE_TRANSITIONS)) {
        if (containsScenarioSyntax) continue;
        const pattern = new RegExp(`\\b${value}\\b`, "g");
        if (pattern.test(text)) {
          errors.push({
            path: relativePath,
            line: lineForNode(sourceFile, node),
            message: `创作者文案含转场稳定值「${value}」；请使用「${replacement}」`,
          });
        }
      }
    }

    checkTransitionLabels(sourceFile, relativePath, errors);
  }
  return errors;
}

export function checkVocabularyRepository(root = repoRoot) {
  const files = SOURCE_ROOTS.flatMap((relativeRoot) => walkSourceFiles(root, relativeRoot));
  const sources = files.map((filePath) => ({
    path: normalizedPath(path.relative(root, filePath)),
    text: fs.readFileSync(filePath, "utf8"),
  }));
  return checkVocabularySources(sources);
}

function printResult(errors) {
  if (errors.length > 0) {
    console.error("Vocabulary check failed:");
    for (const error of errors) console.error(`- ${error.path}:${error.line}: ${error.message}`);
    return false;
  }
  console.log("Vocabulary check passed.");
  return true;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  if (!printResult(checkVocabularyRepository(repoRoot))) process.exit(1);
}

export { printResult, repoRoot };
