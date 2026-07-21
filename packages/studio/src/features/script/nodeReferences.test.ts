import { describe, expect, it } from "vitest";
import { EMPTY_MANIFEST } from "../../lib/types";
import { referencesAffectedByNodeDeletion } from "./nodeReferences";

describe("node deletion references", () => {
  it("lists replay and ending registrations without mutating the manifest", () => {
    const manifest = {
      ...EMPTY_MANIFEST,
      unlocks: {
        ...EMPTY_MANIFEST.unlocks,
        replay: { scene_a: { title: "Scene A", nodeId: "ending" } },
        endings: { true_end: { title: "True", nodeId: "ending" }, bad_end: { title: "Bad", nodeId: "other" } },
      },
    };
    const before = JSON.stringify(manifest);

    expect(referencesAffectedByNodeDeletion(manifest, ["ending"])).toEqual([
      { registry: "replay", id: "scene_a", nodeId: "ending" },
      { registry: "ending", id: "true_end", nodeId: "ending" },
    ]);
    expect(JSON.stringify(manifest)).toBe(before);
  });
});
