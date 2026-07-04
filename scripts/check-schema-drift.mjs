#!/usr/bin/env node
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

const schemaDir = "docs/script-graph/schemas";
const schemaFiles = ["graph.json", "nodeFile.json", "manifest.json", "meta.json"];
const before = new Map();
for (const file of schemaFiles) {
  const path = `${schemaDir}/${file}`;
  if (!existsSync(path)) {
    process.stderr.write(`缺失 schema 快照：${path}\n`);
    process.exit(1);
  }
  before.set(file, createHash("sha256").update(readFileSync(path)).digest("hex"));
}

execSync("pnpm --filter @galstudio/engine export-schemas", { stdio: "inherit" });

try {
  const diffs = [];
  for (const file of schemaFiles) {
    const path = `${schemaDir}/${file}`;
    const after = createHash("sha256").update(readFileSync(path)).digest("hex");
    if (before.get(file) !== after) {
      diffs.push(path);
    }
  }
  if (diffs.length > 0) {
    process.stderr.write(`以下 schema 与导出结果不一致：\n`);
    for (const file of diffs) {
      process.stderr.write(`- ${file}\n`);
    }
    execSync(`git diff -- ${diffs.join(" ")}`, { stdio: "inherit" });
    process.exit(1);
  }
  process.stdout.write("schema 快照无差异。\n");
  process.exit(0);
} catch (error) {
  process.stderr.write("schema 校验失败，请先同步。\n");
  execSync(`git diff -- ${schemaDir}`, { stdio: "inherit" });
  process.exit(1);
}
