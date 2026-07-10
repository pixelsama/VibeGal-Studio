#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceDir = path.join(root, "packages/studio/src-tauri/resources/default-renderer");
const mirrors = [
  path.join(root, "packages/studio/templates/default-renderer"),
  path.join(root, "examples/sample-novel/renderers/default"),
];

function listFiles(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const relative = path.join(prefix, entry.name);
      return entry.isDirectory() ? listFiles(path.join(dir, entry.name), relative) : [relative];
    })
    .sort();
}

const sourceFiles = listFiles(sourceDir);
const drift = [];
for (const mirrorDir of mirrors) {
  const mirrorFiles = listFiles(mirrorDir);
  if (JSON.stringify(mirrorFiles) !== JSON.stringify(sourceFiles)) {
    drift.push(`${path.relative(root, mirrorDir)}: file list differs`);
    continue;
  }
  for (const relative of sourceFiles) {
    const source = readFileSync(path.join(sourceDir, relative));
    const mirror = readFileSync(path.join(mirrorDir, relative));
    if (!source.equals(mirror)) {
      drift.push(`${path.relative(root, mirrorDir)}/${relative}: content differs`);
    }
  }
}

if (drift.length > 0) {
  process.stderr.write(`Default renderer drift detected:\n${drift.map((item) => `- ${item}`).join("\n")}\n`);
  process.exit(1);
}

process.stdout.write(`Default renderer mirrors match ${path.relative(root, sourceDir)} (${sourceFiles.length} files).\n`);
