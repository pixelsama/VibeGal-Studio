import { describe, expect, it } from "vitest";
import { buildAllJsonSchemas, buildJsonSchema } from "./schemaExport";

describe("schemaExport", () => {
  it("buildJsonSchema returns a JSON Schema object for graph", () => {
    const schema = buildJsonSchema("graph");
    // JSON Schema 顶层应是 object type
    expect(schema.type).toBe("object");
    // graph schema 应包含核心字段
    expect(schema.properties).toHaveProperty("version");
    expect(schema.properties).toHaveProperty("entryNodeId");
    expect(schema.properties).toHaveProperty("nodes");
    expect(schema.properties).toHaveProperty("edges");
  });

  it("buildJsonSchema returns a JSON Schema object for nodeFile", () => {
    const schema = buildJsonSchema("nodeFile");
    // 节点文件 = Instruction[] = 数组
    expect(schema.type).toBe("array");
  });

  it("buildAllJsonSchemas returns all four schemas", () => {
    const all = buildAllJsonSchemas();
    expect(Object.keys(all).sort()).toEqual(["graph", "manifest", "meta", "nodeFile"]);
    expect(all.graph.properties).toHaveProperty("nodes");
    expect(all.manifest.type).toBe("object");
    expect(all.meta.type).toBe("object");
    expect(all.meta.properties).toHaveProperty("stage");
  });

  it("graph nodes are objects with id/title/file/position", () => {
    const schema = buildJsonSchema("graph");
    const nodeItem = (schema.properties as { nodes: { items: Record<string, unknown> } }).nodes.items;
    const props = nodeItem.properties as Record<string, unknown>;
    expect(props).toHaveProperty("id");
    expect(props).toHaveProperty("title");
    expect(props).toHaveProperty("file");
    expect(props).toHaveProperty("position");
  });

  it("exports input schemas so zod default fields are not required in raw files", () => {
    const nodeFile = buildJsonSchema("nodeFile");
    const items = nodeFile.items as { oneOf: Array<{ properties: { t: { const: string } }; required: string[] }> };
    const bg = items.oneOf.find((item) => item.properties.t.const === "bg");
    const char = items.oneOf.find((item) => item.properties.t.const === "char");

    expect(bg?.required).toEqual(["t", "id"]);
    expect(char?.required).toEqual(["t", "id"]);
  });

  it("graph schema matches the loader's optional fallback fields", () => {
    const graph = buildJsonSchema("graph");
    const nodeItem = (graph.properties as { nodes: { items: { required: string[] } } }).nodes.items;
    const edgeItem = (graph.properties as { edges: { items: { required: string[] } } }).edges.items;

    expect(graph.required).toEqual(["entryNodeId"]);
    expect(nodeItem.required).toEqual(["id", "file"]);
    expect(edgeItem.required).toEqual(["id", "from", "to"]);
  });

  it("nodeFile schema includes choice instructions", () => {
    const nodeFile = buildJsonSchema("nodeFile");
    const items = nodeFile.items as { oneOf: Array<{ properties: { t: { const: string }; choices?: unknown }; required: string[] }> };
    const choice = items.oneOf.find((item) => item.properties.t.const === "choice");

    expect(choice).toBeDefined();
    expect(choice?.required).toEqual(["t", "choices"]);
    expect(choice?.properties).toHaveProperty("choices");
  });
});
