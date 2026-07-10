import { z } from "zod";
import { ChapterSchema, ManifestSchema, MetaSchema, ProjectGraphSchema } from "./schema";

export type SchemaName = "nodeFile" | "graph" | "manifest" | "meta";

export const SCHEMAS: Record<SchemaName, z.ZodType> = {
  nodeFile: ChapterSchema,
  graph: ProjectGraphSchema,
  manifest: ManifestSchema,
  meta: MetaSchema,
};

export function buildJsonSchema(name: SchemaName): Record<string, unknown> {
  return z.toJSONSchema(SCHEMAS[name], { io: "input" }) as Record<string, unknown>;
}

export function buildAllJsonSchemas(): Record<SchemaName, Record<string, unknown>> {
  return Object.fromEntries(
    (Object.keys(SCHEMAS) as SchemaName[]).map((name) => [name, buildJsonSchema(name)]),
  ) as Record<SchemaName, Record<string, unknown>>;
}
