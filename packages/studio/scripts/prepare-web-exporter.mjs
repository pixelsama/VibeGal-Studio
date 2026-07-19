#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(studioRoot, "../..");
const requireFromStudio = createRequire(path.join(studioRoot, "package.json"));

function parseOutArg(argv) {
  const index = argv.indexOf("--out");
  return index >= 0 && argv[index + 1]
    ? path.resolve(argv[index + 1])
    : path.join(studioRoot, "src-tauri/resources/exporter");
}

function packageRoot(specifier, resolver) {
  try {
    const manifestPath = resolver.resolve(`${specifier}/package.json`);
    return {
      root: path.dirname(manifestPath),
      manifest: JSON.parse(readFileSync(manifestPath, "utf8")),
      manifestPath,
    };
  } catch {
    // Some packages do not export package.json; fall back to walking from main.
  }
  let current = path.dirname(resolver.resolve(specifier));
  while (current !== path.dirname(current)) {
    const manifestPath = path.join(current, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (manifest.name === specifier) return { root: current, manifest, manifestPath };
    }
    current = path.dirname(current);
  }
  throw new Error(`Cannot locate package root for ${specifier}`);
}

function platformEsbuildPackage() {
  const platform = process.platform === "win32" ? "win32" : process.platform;
  const arch = process.arch === "x64" ? "x64" : process.arch;
  return `@esbuild/${platform}-${arch}`;
}

export function prepareWebExporter(outDir = parseOutArg(process.argv.slice(2))) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    path.join(outDir, "README.md"),
    "# Generated Exporter Resource\n\nThis directory is populated by `scripts/prepare-web-exporter.mjs` before a Tauri build.\nThe tracked placeholder keeps direct Cargo checks valid in a clean checkout.\n",
  );

  const copies = [
    [path.join(studioRoot, "package.json"), "packages/studio/package.json"],
    [path.join(scriptDir, "build-web-export.mjs"), "packages/studio/scripts/build-web-export.mjs"],
    [path.join(scriptDir, "build-desktop-export.mjs"), "packages/studio/scripts/build-desktop-export.mjs"],
    [path.join(scriptDir, "renderer-worker-shared.mjs"), "packages/studio/scripts/renderer-worker-shared.mjs"],
    [path.join(scriptDir, "renderer-snapshot.mjs"), "packages/studio/scripts/renderer-snapshot.mjs"],
    [path.join(studioRoot, "src/export/webRuntimeHost.ts"), "packages/studio/src/export/webRuntimeHost.ts"],
    [path.join(studioRoot, "src/export/snapshotScenes.ts"), "packages/studio/src/export/snapshotScenes.ts"],
    [path.join(studioRoot, "src/export/snapshotHost.ts"), "packages/studio/src/export/snapshotHost.ts"],
    [path.join(studioRoot, "src/features/preview/RuntimeMediaOverlay.tsx"), "packages/studio/src/features/preview/RuntimeMediaOverlay.tsx"],
    [path.join(repoRoot, "packages/engine/src"), "packages/engine/src"],
    [path.join(repoRoot, "packages/contracts/src"), "packages/contracts/src"],
  ];
  for (const [source, relative] of copies) {
    cpSync(source, path.join(outDir, relative), { recursive: true, dereference: true });
  }

  const destinationNodeModules = path.join(outDir, "packages/studio/node_modules");
  const copied = new Set();
  const copyPackage = (specifier, resolver = requireFromStudio) => {
    if (copied.has(specifier)) return;
    const pkg = packageRoot(specifier, resolver);
    copied.add(specifier);
    cpSync(pkg.root, path.join(destinationNodeModules, ...specifier.split("/")), {
      recursive: true,
      dereference: true,
    });
    const packageRequire = createRequire(pkg.manifestPath);
    for (const dependency of Object.keys(pkg.manifest.dependencies ?? {})) {
      copyPackage(dependency, packageRequire);
    }
  };

  for (const dependency of [
    "react",
    "react-dom",
    "esbuild",
    "typescript",
    "@types/react",
    "@types/react-dom",
    "zod",
    "@electron/get",
    "adm-zip",
  ]) {
    copyPackage(dependency);
  }
  const electronGetPackage = packageRoot("@electron/get", requireFromStudio);
  copyPackage("undici", createRequire(electronGetPackage.manifestPath));
  const esbuildPackage = packageRoot("esbuild", requireFromStudio);
  copyPackage(platformEsbuildPackage(), createRequire(esbuildPackage.manifestPath));

  const entry = path.join(outDir, "packages/studio/scripts/build-web-export.mjs");
  process.stdout.write(`Prepared standalone VibeGal web exporter: ${entry}\n`);
  return entry;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  prepareWebExporter();
}
