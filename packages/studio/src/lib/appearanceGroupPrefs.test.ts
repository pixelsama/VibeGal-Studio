import { describe, expect, it, vi } from "vitest";
import {
  APPEARANCE_GROUP_PREFS_STORAGE_KEY,
  DEFAULT_EXPANDED_APPEARANCE_GROUPS,
  effectiveAppearanceGroupCollapsed,
  isAppearanceGroupDefaultExpanded,
  loadAppearanceGroupPrefs,
  saveAppearanceGroupPrefs,
  updateAppearanceGroupPref,
  type AppearanceGroupPrefsStorage,
} from "./appearanceGroupPrefs";

function makeStorage(initial: Record<string, string> = {}): AppearanceGroupPrefsStorage & { data: Record<string, string> } {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe("appearanceGroupPrefs（Spec 33 §6.4）", () => {
  it("无存储数据时全部回退默认展开集（核心四组展开，其余折叠）", () => {
    const prefs = loadAppearanceGroupPrefs(makeStorage());
    expect(prefs.collapsedOverrides).toEqual({});
    for (const id of DEFAULT_EXPANDED_APPEARANCE_GROUPS) {
      expect(effectiveAppearanceGroupCollapsed(id, prefs.collapsedOverrides)).toBe(false);
    }
    expect(effectiveAppearanceGroupCollapsed("titleScreen", prefs.collapsedOverrides)).toBe(true);
    expect(effectiveAppearanceGroupCollapsed("hud", prefs.collapsedOverrides)).toBe(true);
  });

  it("保存覆盖后原样读取", () => {
    const storage = makeStorage();
    saveAppearanceGroupPrefs({ collapsedOverrides: { titleScreen: false, dialogueBox: true } }, storage);

    const prefs = loadAppearanceGroupPrefs(storage);
    expect(prefs.collapsedOverrides).toEqual({ titleScreen: false, dialogueBox: true });
    expect(effectiveAppearanceGroupCollapsed("titleScreen", prefs.collapsedOverrides)).toBe(false);
    expect(effectiveAppearanceGroupCollapsed("dialogueBox", prefs.collapsedOverrides)).toBe(true);
  });

  it("update 只存与默认展开集的差异：回到默认时删除覆盖 key", () => {
    const storage = makeStorage();

    // 默认折叠 → 展开（titleScreen）：产生覆盖
    updateAppearanceGroupPref("titleScreen", false, storage);
    expect(loadAppearanceGroupPrefs(storage).collapsedOverrides).toEqual({ titleScreen: false });
    // 回到默认折叠：删除覆盖
    updateAppearanceGroupPref("titleScreen", true, storage);
    expect(loadAppearanceGroupPrefs(storage).collapsedOverrides).toEqual({});

    // 默认展开 → 折叠（dialogueBox）：产生覆盖
    updateAppearanceGroupPref("dialogueBox", true, storage);
    expect(loadAppearanceGroupPrefs(storage).collapsedOverrides).toEqual({ dialogueBox: true });
    // 回到默认展开：删除覆盖
    updateAppearanceGroupPref("dialogueBox", false, storage);
    expect(loadAppearanceGroupPrefs(storage).collapsedOverrides).toEqual({});
  });

  it("损坏的 JSON 回退到默认", () => {
    const storage = makeStorage({ [APPEARANCE_GROUP_PREFS_STORAGE_KEY]: "{not json" });
    expect(loadAppearanceGroupPrefs(storage).collapsedOverrides).toEqual({});
  });

  it("localStorage 缺失时读写都安全回退", () => {
    vi.stubGlobal("localStorage", undefined);
    try {
      expect(loadAppearanceGroupPrefs()).toEqual({ collapsedOverrides: {} });
      expect(() => saveAppearanceGroupPrefs({ collapsedOverrides: { hud: true } })).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("isAppearanceGroupDefaultExpanded 识别默认展开集", () => {
    expect(isAppearanceGroupDefaultExpanded("dialogueBox")).toBe(true);
    expect(isAppearanceGroupDefaultExpanded("nameBox")).toBe(true);
    expect(isAppearanceGroupDefaultExpanded("choiceBox")).toBe(true);
    expect(isAppearanceGroupDefaultExpanded("stage")).toBe(true);
    expect(isAppearanceGroupDefaultExpanded("titleScreen")).toBe(false);
    expect(isAppearanceGroupDefaultExpanded("unknownPart")).toBe(false);
  });
});
