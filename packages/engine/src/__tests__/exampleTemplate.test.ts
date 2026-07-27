import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GraphNovelPlayer, ProjectGraphSchema } from "../index";
import type { Instruction, Manifest, Meta, VariableRegistry } from "../types";

const root = resolve(
  __dirname,
  "../../../studio/src-tauri/resources/example-content",
);
const read = (rel: string) => JSON.parse(readFileSync(resolve(root, rel), "utf8"));

describe("packaged example project template", () => {
  it("loads into the engine with its graph, state, endings, and resources", () => {
    const graph = ProjectGraphSchema.parse(read("graph.json"));
    const manifest = read("manifest.json") as Manifest;
    const meta = read("meta.json") as Meta;
    const variables = read("variables.json") as VariableRegistry;
    const player = new GraphNovelPlayer({ manifest, meta, variables });

    player.loadGraph(graph, graph.nodes.map((node) => ({
      id: node.id,
      instructions: read(node.file) as Instruction[],
    })));

    expect(player.getCurrentNodeId()).toBe("prologue");
    expect(player.state.vars).toMatchObject({
      resolve: 0,
      knows_the_fire: false,
      route: "drifting",
    });
    expect(Object.keys(manifest.backgrounds)).toContain("ocean_dawn");
    expect(Object.keys(manifest.unlocks?.endings ?? {})).toEqual(
      expect.arrayContaining(["guardian", "adrift"]),
    );
    player.dispose();
  });
});
