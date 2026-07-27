#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const rendererSets = [
  {
    id: "default",
    sourceDir: path.join(root, "packages/studio/src-tauri/resources/default-renderer"),
    mirrors: [
      path.join(root, "packages/studio/templates/default-renderer"),
      path.join(root, "examples/sample-novel/renderers/default"),
    ],
  },
  {
    id: "classic",
    sourceDir: path.join(root, "packages/studio/src-tauri/resources/classic-renderer"),
    mirrors: [
      path.join(root, "packages/studio/templates/classic-renderer"),
      path.join(root, "examples/sample-novel/renderers/classic"),
    ],
  },
];

function listFiles(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const relative = path.join(prefix, entry.name);
      return entry.isDirectory() ? listFiles(path.join(dir, entry.name), relative) : [relative];
    })
    .sort();
}

const drift = [];
const summaries = [];
for (const renderer of rendererSets) {
  const sourceFiles = listFiles(renderer.sourceDir);
  for (const mirrorDir of renderer.mirrors) {
    const mirrorFiles = listFiles(mirrorDir);
    if (JSON.stringify(mirrorFiles) !== JSON.stringify(sourceFiles)) {
      drift.push(`${path.relative(root, mirrorDir)}: file list differs`);
      continue;
    }
    for (const relative of sourceFiles) {
      const source = readFileSync(path.join(renderer.sourceDir, relative));
      const mirror = readFileSync(path.join(mirrorDir, relative));
      if (!source.equals(mirror)) {
        drift.push(`${path.relative(root, mirrorDir)}/${relative}: content differs`);
      }
    }
  }
  summaries.push(
    `${renderer.id} mirrors match ${path.relative(root, renderer.sourceDir)} (${sourceFiles.length} files).`,
  );
}

if (drift.length > 0) {
  process.stderr.write(`Renderer template drift detected:\n${drift.map((item) => `- ${item}`).join("\n")}\n`);
  process.exit(1);
}

process.stdout.write(`${summaries.join("\n")}\n`);
