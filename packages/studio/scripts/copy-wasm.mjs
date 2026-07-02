// postinstall fallback：从 esbuild-wasm 包拷贝 wasm 到 public/
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
try {
  const src = require.resolve("esbuild-wasm/esbuild.wasm");
  const dst = "public/esbuild.wasm";
  if (!existsSync(dirname(dst))) mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  console.log("[copy-wasm] 已拷贝 esbuild.wasm → public/");
} catch (e) {
  console.error("[copy-wasm] 拷贝失败:", e.message);
  process.exit(0); // 不阻断安装
}
