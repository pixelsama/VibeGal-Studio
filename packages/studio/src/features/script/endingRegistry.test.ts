import { describe, expect, it } from "vitest";
import { registerEnding, unregisterEnding } from "./endingRegistry";
import { EMPTY_MANIFEST } from "../../lib/types";

describe("ending registry", () => {
  it("registers and unregisters without mutating manifest", () => {
    const next = registerEnding(EMPTY_MANIFEST, { id: "true_end", title: "真结局", nodeId: "ending" });
    expect(next.unlocks.endings.true_end).toEqual({ title: "真结局", nodeId: "ending" });
    expect(EMPTY_MANIFEST.unlocks.endings).toEqual({});
    expect(unregisterEnding(next, "true_end").unlocks.endings).toEqual({});
  });
});
