import { describe, expect, it } from "vitest";
import type { VariableRegistry } from "@vibegal/engine";
import { declarationForKind, registerInferredVariable, slugify, uniqueName } from "./StoryStatePanel";

const registry: VariableRegistry = {
  version: 1,
  variables: {
    affection_yuki: {
      kind: "meter", type: "number", default: 20, nullable: false, scope: "run",
      label: "好感度", of: "yuki", min: 0, max: 100,
      bands: [{ id: "cold", label: "冷淡", upTo: 29 }, { id: "love", label: "喜欢" }],
    },
    has_key: { kind: "flag", type: "boolean", default: false, nullable: false, scope: "run", label: "拿到钥匙" },
  },
};

describe("new state defaults", () => {
  it("gives a meter a usable range and bands out of the box", () => {
    const declaration = declarationForKind("meter", "好感度");
    expect(declaration).toMatchObject({ kind: "meter", type: "number", default: 0, min: 0, max: 100 });
    expect(declaration.bands).toHaveLength(3);
  });

  it("gives a state one starting option so the default is always valid", () => {
    const declaration = declarationForKind("state", "当前路线");
    expect(declaration.options).toEqual([{ id: "state_1", label: "状态 1" }]);
    expect(declaration.default).toBe("state_1");
  });

  it("keeps persisted defaults independent from the Studio locale", () => {
    expect(declarationForKind("meter", "Affection")).toMatchObject({
      bands: [
        { id: "low", label: "低", upTo: 29 },
        { id: "mid", label: "中", upTo: 59 },
        { id: "high", label: "高" },
      ],
    });
    expect(declarationForKind("state", "Route")).toMatchObject({
      options: [{ id: "state_1", label: "状态 1" }],
    });
  });

  it("keeps a counter non-negative", () => {
    expect(declarationForKind("counter", "见面次数")).toMatchObject({ min: 0, default: 0 });
  });
});

describe("identifier generation", () => {
  it("derives an identifier from a latin label", () => {
    expect(slugify("Has Key")).toBe("has_key");
  });

  it("falls back when the label has no usable ascii, rather than emitting variable_1", () => {
    expect(slugify("拿到钥匙")).toBe("");
    expect(uniqueName(slugify("拿到钥匙"), new Set())).toBe("state");
  });

  it("never collides with an existing identifier", () => {
    expect(uniqueName("state", new Set(["state", "state_2"]))).toBe("state_3");
  });
});

describe("registerInferredVariable", () => {
  it("adds a kind so legacy variables land in the right group", () => {
    expect(registerInferredVariable({ version: 1, variables: {} }, "affection", ["number"])).toEqual({
      version: 1,
      variables: { affection: { kind: "meter", type: "number", default: 0, nullable: false, scope: "run" } },
    });
  });

  it("leaves an already-declared variable untouched", () => {
    expect(registerInferredVariable(registry, "has_key", ["boolean"])).toBe(registry);
  });
});
