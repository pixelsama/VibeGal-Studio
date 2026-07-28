#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generator = path.join(root, "scripts/generate-scale-project.mjs");
const output = path.resolve(process.argv[2] || "benchmark-results/scale-latest.json");
const temporary = await mkdtemp(path.join(os.tmpdir(), "vibegal-scale-benchmark-"));
const project = path.join(temporary, "project");

try {
  const started = performance.now();
  const generated = spawnSync(process.execPath, [generator, project], { encoding: "utf8" });
  if (generated.status !== 0) throw new Error(generated.stderr || generated.stdout);
  const generatedMs = performance.now() - started;

  const parseStarted = performance.now();
  const [dataset, graph, manifest, locale] = await Promise.all([
    readFile(path.join(project, "benchmark.dataset.json"), "utf8").then(JSON.parse),
    readFile(path.join(project, "content/graph.json"), "utf8").then(JSON.parse),
    readFile(path.join(project, "content/manifest.json"), "utf8").then(JSON.parse),
    readFile(path.join(project, "content/locales/zh-CN.json"), "utf8").then(JSON.parse),
  ]);
  const coreDocumentsMs = performance.now() - parseStarted;

  const report = {
    schemaVersion: 1,
    benchmark: "scale-v1",
    dataset,
    environment: {
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      cpuModel: os.cpus()[0]?.model || "unknown",
      cpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      commit: process.env.GITHUB_SHA || null,
    },
    measurements: {
      generatedMs: Number(generatedMs.toFixed(3)),
      coreDocumentsMs: Number(coreDocumentsMs.toFixed(3)),
      graphNodes: graph.nodes.length,
      graphEdges: graph.edges.length,
      localeMessages: Object.keys(locale).length,
      manifestCharacters: Object.keys(manifest.characters).length,
    },
    browser: {
      status: "not-run",
      reason: "Run the controlled Chromium harness after the P4 windowing and lazy-loading batch.",
      scenarios: [
        "workspace-interactive",
        "assets-first-render",
        "asset-search-input",
        "node-list-scroll",
        "graph-interactive",
        "single-node-edit-save",
        "peak-js-heap",
      ],
    },
  };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
