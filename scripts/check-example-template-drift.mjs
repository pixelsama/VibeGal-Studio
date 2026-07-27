#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceDir = path.join(root, "examples/sample-novel/content");
const mirrorDir = path.join(root, "packages/studio/src-tauri/resources/example-content");

function listFiles(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const relative = path.join(prefix, entry.name);
      return entry.isDirectory() ? listFiles(path.join(dir, entry.name), relative) : [relative];
    })
    .sort();
}

const sourceFiles = listFiles(sourceDir);
const mirrorFiles = listFiles(mirrorDir);
const drift = [];
if (JSON.stringify(mirrorFiles) !== JSON.stringify(sourceFiles)) {
  drift.push("file list differs");
} else {
  for (const relative of sourceFiles) {
    const source = readFileSync(path.join(sourceDir, relative));
    const mirror = readFileSync(path.join(mirrorDir, relative));
    if (!source.equals(mirror)) drift.push(`${relative}: content differs`);
  }
}

if (drift.length > 0) {
  process.stderr.write(`Example project template drift detected:\n${drift.map((item) => `- ${item}`).join("\n")}\n`);
  process.exit(1);
}

process.stdout.write(`Example project template matches ${path.relative(root, sourceDir)} (${sourceFiles.length} files).\n`);
