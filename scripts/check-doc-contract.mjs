#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = path.join(repoRoot, "docs", "script-graph");
const archiveDir = path.join(docsDir, "archive");
const schemaDir = path.join(docsDir, "schemas");
const cliDocFiles = [
  path.join(repoRoot, "README.md"),
  path.join(repoRoot, "docs", "project-wiki.md"),
];
const stableIdentityCliCommands = [
  "vibegal-cli instruction-ids assign",
  "vibegal-cli node insert",
  "vibegal-cli node update",
  "vibegal-cli node move",
  "vibegal-cli node duplicate",
  "vibegal-cli node delete",
];
const bannedPatterns = [/合成线性图/g, /synthesizes linear/gi];
const excludedFromBannedScan = new Set([
  "00-feature-plan.md",
  "13-documentation-convergence.spec.md",
  "doc-audit.md",
]);

const errors = [];

function walkMarkdown(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "archive") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkMarkdown(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(fullPath);
    }
  }
  return out;
}

function isRemoteLink(target) {
  return /^(https?:|mailto:|#)/i.test(target);
}

function normalizeLinkTarget(rawTarget) {
  const stripped = rawTarget.trim().replace(/^<|>$/g, "");
  const [pathPart] = stripped.split("#");
  return pathPart;
}

function checkMarkdownFile(filePath) {
  const rel = path.relative(docsDir, filePath).split(path.sep).join("/");
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/).slice(0, 12).join("\n");
  if (!/^\s*>\s*状态：/m.test(lines) && !rel.startsWith("archive/") && rel !== "doc-audit.md") {
    errors.push(`${rel}: missing top status line`);
  }

  const statusLine = text.split(/\r?\n/).find((line) => line.startsWith("> 状态：")) ?? "";
  const isHistorical = /历史背景/.test(statusLine) || rel.startsWith("archive/");
  const shouldScanBanned = !isHistorical && !excludedFromBannedScan.has(path.basename(filePath));
  if (shouldScanBanned) {
    for (const pattern of bannedPatterns) {
      if (pattern.test(text)) {
        errors.push(`${rel}: contains banned phrase matching ${pattern}`);
      }
    }
  }

  const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
  let match;
  while ((match = linkPattern.exec(text))) {
    const rawTarget = match[1];
    if (isRemoteLink(rawTarget)) continue;
    const target = normalizeLinkTarget(rawTarget);
    if (!target) continue;
    const resolved = path.resolve(path.dirname(filePath), target);
    if (!fs.existsSync(resolved)) {
      errors.push(`${rel}: broken link -> ${rawTarget}`);
    }
  }
}

function assertExists(relPath) {
  const absPath = path.join(repoRoot, relPath);
  if (!fs.existsSync(absPath)) {
    errors.push(`${relPath}: missing required file`);
  }
}

for (const md of walkMarkdown(docsDir)) {
  checkMarkdownFile(md);
}

assertExists("docs/script-graph/archive/README.md");
for (const schemaName of ["graph.json", "nodeFile.json", "manifest.json", "meta.json", "fixture.json"]) {
  assertExists(path.join("docs/script-graph/schemas", schemaName));
}

for (const filePath of cliDocFiles) {
  const rel = path.relative(repoRoot, filePath).split(path.sep).join("/");
  const text = fs.readFileSync(filePath, "utf8");
  for (const command of stableIdentityCliCommands) {
    if (!text.includes(command)) {
      errors.push(`${rel}: missing stable identity CLI command -> ${command}`);
    }
  }
}

if (errors.length > 0) {
  console.error("Doc contract check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Doc contract check passed.");
