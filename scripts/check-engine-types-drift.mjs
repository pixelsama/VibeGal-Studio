#!/usr/bin/env node
/**
 * engine.d.ts 漂移检查：canonical 生成物必须与 rendererPublic.ts 当前导出一致。
 * 与 check-schema-drift.mjs 同思路：重新生成 → 逐字节比对 → 不一致则失败。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tracked = "packages/studio/src-tauri/generated/engine-types/engine.d.ts";
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

const tempDir = mkdtempSync(path.join(tmpdir(), "vibegal-engine-types-drift-"));
const regenerated = path.join(tempDir, "engine.d.ts");
try {
  execFileSync(process.execPath, [
    "packages/studio/scripts/generate-engine-types.mjs",
    "--out",
    regenerated,
  ], { stdio: "inherit" });

  if (sha256(tracked) !== sha256(regenerated)) {
    process.stderr.write(
      `${tracked} 与 packages/engine/src/rendererPublic.ts 当前导出不一致。\n`
        + "请运行 node packages/studio/scripts/generate-engine-types.mjs 重新生成并提交。\n",
    );
    execFileSync("git", ["diff", "--", tracked], { stdio: "inherit" });
    process.exit(1);
  }
  process.stdout.write("engine.d.ts 生成物与 engine 契约源码无差异。\n");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
