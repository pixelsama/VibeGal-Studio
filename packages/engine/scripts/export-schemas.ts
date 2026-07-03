/**
 * Phase 11：把 zod schema 导出成 JSON Schema 文件，写到 docs/script-graph/schemas/。
 *
 * 用 vitest 的 TS 源能力没法直接跑这个写盘脚本，所以用 tsx 运行。
 * 用法：pnpm exec tsx scripts/export-schemas.ts
 * 产物：docs/script-graph/schemas/{nodeFile,graph,manifest,meta}.json
 *
 * 这些 JSON Schema 提交进仓库，供外部工具/Agent 引用校验。
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAllJsonSchemas } from "../src/schemaExport.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../../../docs/script-graph/schemas");

mkdirSync(outDir, { recursive: true });

const all = buildAllJsonSchemas();
for (const [name, schema] of Object.entries(all)) {
  const filePath = resolve(outDir, `${name}.json`);
  writeFileSync(filePath, JSON.stringify(schema, null, 2) + "\n", "utf8");
  console.log(`wrote ${filePath}`);
}
