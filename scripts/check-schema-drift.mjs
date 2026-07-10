#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const generatedDir = "packages/studio/src-tauri/generated/contracts";
const docsDir = "docs/script-graph/schemas";
const schemaNames = ["graph", "nodeFile", "manifest", "meta"];
const trackedFiles = [
  ...schemaNames.map((name) => `${generatedDir}/${name}.schema.json`),
  `${generatedDir}/diagnostics.json`,
  `${generatedDir}/contract-manifest.json`,
  ...schemaNames.map((name) => `${docsDir}/${name}.json`),
];
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

const missing = trackedFiles.filter((path) => !existsSync(path));
if (missing.length > 0) {
  process.stderr.write(`缺失 contracts 生成物：\n${missing.map((path) => `- ${path}`).join("\n")}\n`);
  process.exit(1);
}

const before = new Map(trackedFiles.map((path) => [path, sha256(path)]));
execFileSync("pnpm", ["--filter", "@vibegal/contracts", "generate-contracts"], {
  stdio: "inherit",
});

const drifted = trackedFiles.filter((path) => before.get(path) !== sha256(path));
for (const name of schemaNames) {
  const generatedPath = `${generatedDir}/${name}.schema.json`;
  const docsPath = `${docsDir}/${name}.json`;
  if (sha256(generatedPath) !== sha256(docsPath)) {
    drifted.push(generatedPath, docsPath);
  }
}

const uniqueDrifted = [...new Set(drifted)];
if (uniqueDrifted.length > 0) {
  process.stderr.write(`以下 contracts 生成物与 canonical source 不一致：\n`);
  for (const path of uniqueDrifted) process.stderr.write(`- ${path}\n`);
  execFileSync("git", ["diff", "--", ...uniqueDrifted], { stdio: "inherit" });
  process.exit(1);
}

process.stdout.write("contracts 生成物、Rust embedded artifacts 与 docs 镜像无差异。\n");
