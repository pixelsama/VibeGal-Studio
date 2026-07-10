import { beforeEach, describe, expect, it } from "vitest";
import {
  clearRendererTrust,
  isProjectRendererTrusted,
  trustProjectRenderer,
} from "./rendererTrust";

describe("project renderer trust", () => {
  beforeEach(() => clearRendererTrust());

  it("requires an explicit per-project trust decision", () => {
    expect(isProjectRendererTrusted("/projects/a")).toBe(false);

    trustProjectRenderer("/projects/a");

    expect(isProjectRendererTrusted("/projects/a")).toBe(true);
    expect(isProjectRendererTrusted("/projects/b")).toBe(false);
  });

  it("revokes only the changed project when requested", () => {
    trustProjectRenderer("/projects/a");
    trustProjectRenderer("/projects/b");

    clearRendererTrust("/projects/a");

    expect(isProjectRendererTrusted("/projects/a")).toBe(false);
    expect(isProjectRendererTrusted("/projects/b")).toBe(true);
  });
});
