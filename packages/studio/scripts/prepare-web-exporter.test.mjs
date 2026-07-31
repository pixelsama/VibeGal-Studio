import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { prepareWebExporter } from "./prepare-web-exporter.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(studioRoot, "../..");

test("Tauri bundles the standalone exporter without flattening its directories", async () => {
  const config = JSON.parse(await readFile(
    path.join(studioRoot, "src-tauri/tauri.conf.json"),
    "utf8",
  ));

  assert.equal(
    config.bundle.resources["resources/exporter/"],
    "exporter/",
    "directory resources must not use a glob because Tauri flattens mapped glob results",
  );
  assert.equal(config.bundle.resources["resources/exporter/**/*"], undefined);
  assert.equal(
    config.bundle.resources["resources/player/"],
    "player/",
    "the precompiled lightweight player must be available to the bundled CLI",
  );
  assert.match(
    config.build.beforeBuildCommand,
    /prepare-web-exporter\.mjs/,
    "the exporter resource must exist before Tauri validates bundle resources",
  );
  await access(path.join(studioRoot, "src-tauri/resources/exporter/README.md"));
});

test("lightweight player starts with one hidden bootstrap window", async () => {
  const config = JSON.parse(await readFile(
    path.join(studioRoot, "src-tauri/player.tauri.conf.json"),
    "utf8",
  ));
  assert.equal(config.app.windows.length, 1);
  assert.equal(config.app.windows[0].label, "main");
  assert.equal(config.app.windows[0].visible, false);
});

test("prepared web exporter runs outside the repository layout", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "vibegal-exporter-dist-"));
  try {
    const prepare = spawnSync(process.execPath, [
      path.join(scriptDir, "prepare-web-exporter.mjs"),
      "--out", outDir,
    ], { cwd: repoRoot, encoding: "utf8" });
    assert.equal(prepare.status, 0, prepare.stdout || prepare.stderr);

    const worker = path.join(outDir, "packages/studio/scripts/build-web-export.mjs");
    const check = spawnSync(process.execPath, [
      worker,
      "--check-only",
      "--project", path.join(repoRoot, "examples/sample-novel"),
      "--renderer", "default",
    ], { cwd: os.tmpdir(), encoding: "utf8" });
    assert.equal(check.status, 0, check.stdout || check.stderr);
    assert.equal(JSON.parse(check.stdout).ok, true);

    // renderer-snapshot 依赖的共享模块与宿主文件也必须随 exporter 一起分发。
    for (const relative of [
      "packages/studio/scripts/build-desktop-export.mjs",
      "packages/studio/scripts/renderer-worker-shared.mjs",
      "packages/studio/scripts/renderer-snapshot.mjs",
      "scripts/desktop-update-client.mjs",
      "scripts/verify-update-manifest.mjs",
      "scripts/update-manifest-contract.mjs",
      "packages/studio/src/export/snapshotScenes.ts",
      "packages/studio/src/export/snapshotHost.ts",
      "packages/studio/node_modules/@electron/get/package.json",
      "packages/studio/node_modules/adm-zip/package.json",
      "packages/studio/node_modules/undici/package.json",
    ]) {
      await access(path.join(outDir, relative));
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("exporter payload resolves its relative imports inside the payload (regression: overlay imported Studio src/lib)", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "vibegal-exporter-"));
  try {
    prepareWebExporter(outDir);
    const files = [];
    const visit = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        // node_modules 包是整包复制的黑盒依赖（内部 chunk/动态导入由包自身保证），
        // 完整性检查只覆盖 exporter 自有源码（清单职责所在）。
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules") visit(full);
        }
        // .d.ts 是类型声明（esbuild 剥离类型导入，不参与运行时解析），不检查
        else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) files.push(full);
      }
    };
    visit(outDir);
    assert.ok(files.length > 0, "exporter payload contains source files");
    for (const file of files) {
      const source = await readFile(file, "utf8");
      const relative = path.relative(outDir, file);
      for (const match of source.matchAll(/(?:import|from)\s+["'](\.[^"']+)["']/g)) {
        // 类型导入（import type / export type）在 esbuild 打包时被剥离，不产生运行时依赖
        if (/\btype\s*$/.test(source.slice(Math.max(0, match.index - 8), match.index))) continue;
        const specifier = match[1];
        assert.ok(
          resolveInside(outDir, path.dirname(file), specifier),
          `${relative}: unresolved relative import "${specifier}" (exporter payload must be self-contained)`,
        );
      }
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

function resolveInside(root, fromDir, specifier) {
  const base = path.resolve(fromDir, specifier);
  const candidates = [
    base,
    `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}.json`, `${base}.d.ts`,
    path.join(base, "index.ts"), path.join(base, "index.tsx"),
    path.join(base, "index.js"), path.join(base, "index.mjs"),
  ];
  return candidates.some((candidate) => existsSync(candidate));
}
