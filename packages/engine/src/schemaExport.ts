/**
 * Phase 11：把 zod schema 转成 JSON Schema（纯函数，可单测）。
 *
 * 这些 JSON Schema 供外部工具/Agent 校验 graph.json 和节点文件，
 * 不需要打开 VibeGal-Studio 源码也能知道合法结构。
 */
import { z } from "zod";
import {
  ChapterSchema,
  ManifestSchema,
  MetaSchema,
  ProjectGraphSchema,
} from "./schema";

export type SchemaName = "nodeFile" | "graph" | "manifest" | "meta";

/** 各 schema 的 zod 对象映射，键 = 导出文件名（不含扩展名）。 */
export const SCHEMAS: Record<SchemaName, z.ZodType> = {
  nodeFile: ChapterSchema, // 节点文件 = Instruction[] = Chapter
  graph: ProjectGraphSchema,
  manifest: ManifestSchema,
  meta: MetaSchema,
};

/**
 * 把指定 schema 名转成 JSON Schema 对象（zod v4 的 z.toJSONSchema）。
 * 返回的是普通 JS 对象，调用方可 JSON.stringify 或写盘。
 */
export function buildJsonSchema(name: SchemaName): Record<string, unknown> {
  return z.toJSONSchema(SCHEMAS[name], { io: "input" }) as Record<string, unknown>;
}

/** 全部 schema 转 { name → jsonSchema }，供批量导出。 */
export function buildAllJsonSchemas(): Record<SchemaName, Record<string, unknown>> {
  const result = {} as Record<SchemaName, Record<string, unknown>>;
  for (const name of Object.keys(SCHEMAS) as SchemaName[]) {
    result[name] = buildJsonSchema(name);
  }
  return result;
}
