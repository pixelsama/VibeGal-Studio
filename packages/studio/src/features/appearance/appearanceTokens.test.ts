import { describe, expect, it, vi } from "vitest";
import { EMPTY_MANIFEST, type FileRevision, type Manifest } from "../../lib/types";
import {
  APPEARANCE_TOKEN_GROUPS,
  hexColorOrNull,
  mergeTokenOverrides,
  readSkinTokens,
  saveAppearanceManifest,
  selectEditableSkinId,
  tokenDefaultPlaceholder,
  tokenGroupsForPart,
  tokenVisibleChecked,
  visibleTokenEditValue,
  withDefaultUiSkin,
  withUiSkinToken,
} from "./appearanceTokens";

function manifestWithSkins(skins: Manifest["uiSkins"]): Manifest {
  return { ...EMPTY_MANIFEST, uiSkins: skins };
}

describe("selectEditableSkinId", () => {
  it("优先 default 条目", () => {
    const manifest = manifestWithSkins({
      dark: { assets: {}, tokens: {} },
      default: { assets: {}, tokens: {} },
    });
    expect(selectEditableSkinId(manifest)).toBe("default");
  });

  it("没有 default 时回退到第一个条目（与渲染器消费的是同一对象）", () => {
    const manifest = manifestWithSkins({ dark: { assets: {} } });
    expect(selectEditableSkinId(manifest)).toBe("dark");
  });

  it("一个 skin 都没有时返回 null（空态）", () => {
    expect(selectEditableSkinId(manifestWithSkins({}))).toBeNull();
  });
});

describe("readSkinTokens", () => {
  it("返回 token 表的拷贝（改写不影响原 manifest）", () => {
    const manifest = manifestWithSkins({ default: { assets: {}, tokens: { "dialogueBox.x": 120 } } });
    const tokens = readSkinTokens(manifest, "default");
    expect(tokens).toEqual({ "dialogueBox.x": 120 });
    tokens["dialogueBox.x"] = 999;
    expect(manifest.uiSkins.default.tokens?.["dialogueBox.x"]).toBe(120);
  });

  it("skin 或 tokens 缺失时返回空表", () => {
    expect(readSkinTokens(manifestWithSkins({ default: { assets: {} } }), "default")).toEqual({});
    expect(readSkinTokens(manifestWithSkins({}), "ghost")).toEqual({});
  });
});

describe("withUiSkinToken", () => {
  it("不可变写入 token，其它 skin 与其它字段不受影响", () => {
    const original = manifestWithSkins({
      default: { name: "默认", assets: { bg: "a.png" }, tokens: { "dialogueBox.x": 100 } },
      dark: { assets: {}, tokens: { "dialogueBox.x": 1 } },
    });
    const next = withUiSkinToken(original, "default", "dialogueBox.y", 480);

    expect(next).not.toBe(original);
    expect(next.uiSkins.default.tokens).toEqual({ "dialogueBox.x": 100, "dialogueBox.y": 480 });
    // 原对象未被触碰
    expect(original.uiSkins.default.tokens).toEqual({ "dialogueBox.x": 100 });
    // 其它 skin 保持引用相等（没被打包进新对象）
    expect(next.uiSkins.dark).toBe(original.uiSkins.dark);
    // skin 的其它字段保留
    expect(next.uiSkins.default.name).toBe("默认");
    expect(next.uiSkins.default.assets).toEqual({ bg: "a.png" });
  });

  it("value === undefined 时清除 token（回退渲染器默认）", () => {
    const manifest = manifestWithSkins({
      default: { assets: {}, tokens: { "dialogueBox.x": 100, "dialogueBox.y": 480 } },
    });
    const next = withUiSkinToken(manifest, "default", "dialogueBox.x", undefined);
    expect(next.uiSkins.default.tokens).toEqual({ "dialogueBox.y": 480 });
  });

  it("skin 还没有 tokens 槽位时创建", () => {
    const manifest = manifestWithSkins({ default: { assets: {} } });
    const next = withUiSkinToken(manifest, "default", "hud.visible", 0);
    expect(next.uiSkins.default.tokens).toEqual({ "hud.visible": 0 });
  });

  it("目标 skin 不存在时原样返回（不写错对象）", () => {
    const manifest = manifestWithSkins({ default: { assets: {}, tokens: {} } });
    expect(withUiSkinToken(manifest, "ghost", "dialogueBox.x", 1)).toBe(manifest);
  });
});

describe("withDefaultUiSkin", () => {
  it("空 uiSkins → 创建 default 条目（name/assets/tokens 按 schema 构造）", () => {
    const next = withDefaultUiSkin(manifestWithSkins({}));
    expect(next.uiSkins.default).toEqual({ name: "默认外观", assets: {}, tokens: {} });
    expect(selectEditableSkinId(next)).toBe("default");
  });

  it("已存在 default 时不覆盖（返回原对象）", () => {
    const manifest = manifestWithSkins({ default: { name: "既有", assets: { bg: "a.png" } } });
    expect(withDefaultUiSkin(manifest)).toBe(manifest);
  });

  it("保留其它既有 skin", () => {
    const manifest = manifestWithSkins({ dark: { assets: {}, tokens: { "hud.visible": 0 } } });
    const next = withDefaultUiSkin(manifest);
    expect(next.uiSkins.dark).toEqual({ assets: {}, tokens: { "hud.visible": 0 } });
    expect(next.uiSkins.default.name).toBe("默认外观");
  });
});

describe("mergeTokenOverrides", () => {
  it("把几何 override 覆盖进目标 skin 的 tokens（不可变）", () => {
    const manifest = manifestWithSkins({
      default: { assets: {}, tokens: { "dialogueBox.x": 100, "dialogueBox.radius": 6 } },
    });
    const next = mergeTokenOverrides(manifest, "default", { "dialogueBox.x": 120, "dialogueBox.y": 500 });
    expect(next.uiSkins.default.tokens).toEqual({ "dialogueBox.x": 120, "dialogueBox.radius": 6, "dialogueBox.y": 500 });
    expect(manifest.uiSkins.default.tokens?.["dialogueBox.x"]).toBe(100);
  });

  it("空 override 或 skin 缺失时原样返回", () => {
    const manifest = manifestWithSkins({ default: { assets: {} } });
    expect(mergeTokenOverrides(manifest, "default", {})).toBe(manifest);
    expect(mergeTokenOverrides(manifest, "ghost", { "dialogueBox.x": 1 })).toBe(manifest);
  });
});

describe("saveAppearanceManifest", () => {
  const revision: FileRevision = { relPath: "content/manifest.json", mtimeMs: 1, size: 10 };

  it("落盘成功（返回 revision）→ saved，且 expectedRevision 透传", async () => {
    const saveManifestFn = vi.fn(async () => revision);
    const manifest = manifestWithSkins({});
    const outcome = await saveAppearanceManifest(saveManifestFn, "/p", manifest, revision);
    expect(outcome).toEqual({ status: "saved", revision });
    expect(saveManifestFn).toHaveBeenCalledWith("/p", manifest, revision);
  });

  it("返回 null = revision 冲突 → conflict（不抛错）", async () => {
    const saveManifestFn = vi.fn(async () => null);
    await expect(saveAppearanceManifest(saveManifestFn, "/p", manifestWithSkins({}))).resolves.toEqual({
      status: "conflict",
      revision: null,
    });
  });

  it("后端错误照常抛出（由调用方 toast）", async () => {
    const saveManifestFn = vi.fn(async () => {
      throw new Error("io failed");
    });
    await expect(saveAppearanceManifest(saveManifestFn, "/p", manifestWithSkins({}))).rejects.toThrow("io failed");
  });
});

describe("tokenDefaultPlaceholder", () => {
  it("普通键显示 DEFAULT_UI_TOKENS 的默认值", () => {
    expect(tokenDefaultPlaceholder("dialogueBox.radius")).toBe("默认：18");
    expect(tokenDefaultPlaceholder("dialogueBox.x")).toBe("默认：77.08");
    expect(tokenDefaultPlaceholder("choiceButton.bgColor")).toBe("默认：rgba(255, 255, 255, 0.9)");
    expect(tokenDefaultPlaceholder("menuWindow.width")).toBe("默认：1060");
  });

  it("null 语义键显示默认行为说明", () => {
    expect(tokenDefaultPlaceholder("dialogueBox.bgColor")).toBe("默认：内置磨砂白");
    expect(tokenDefaultPlaceholder("dialogueBox.borderColor")).toBe("默认：发丝白边");
    expect(tokenDefaultPlaceholder("nameBox.width")).toBe("默认：auto（随内容）");
    expect(tokenDefaultPlaceholder("nameBox.bgColor")).toBe("默认：跟随说话人颜色");
    expect(tokenDefaultPlaceholder("hud.x")).toBe("默认：右上锚定（右缘 16px）");
  });

  it("未知键退化为「默认」", () => {
    expect(tokenDefaultPlaceholder("unknown.key")).toBe("默认");
  });
});

describe("tokenGroupsForPart", () => {
  it("未选中（null）时返回全部分组", () => {
    expect(tokenGroupsForPart(null)).toBe(APPEARANCE_TOKEN_GROUPS);
  });

  it("已知部件映射到对应分组（choiceBox 连按钮样式组）", () => {
    expect(tokenGroupsForPart("dialogueBox").map((group) => group.id)).toEqual(["dialogueBox"]);
    expect(tokenGroupsForPart("nameBox").map((group) => group.id)).toEqual(["nameBox"]);
    expect(tokenGroupsForPart("hud").map((group) => group.id)).toEqual(["hud"]);
    expect(tokenGroupsForPart("menuWindow").map((group) => group.id)).toEqual(["menuWindow"]);
    expect(tokenGroupsForPart("choiceBox").map((group) => group.id)).toEqual(["choiceBox", "choiceButton"]);
  });

  it("第三方渲染器的未知部件合成几何分组（x/y/width/height）", () => {
    const groups = tokenGroupsForPart("heroBanner");
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toContain("heroBanner");
    expect(groups[0].fields.map((field) => field.key)).toEqual([
      "heroBanner.x",
      "heroBanner.y",
      "heroBanner.width",
      "heroBanner.height",
    ]);
  });
});

describe("tokenVisibleChecked / visibleTokenEditValue", () => {
  it("勾选状态规则与渲染器 tokenVisible 一致", () => {
    expect(tokenVisibleChecked({}, "hud.visible")).toBe(true);
    expect(tokenVisibleChecked({ "hud.visible": 0 }, "hud.visible")).toBe(false);
    expect(tokenVisibleChecked({ "hud.visible": "0" }, "hud.visible")).toBe(false);
    expect(tokenVisibleChecked({ "hud.visible": "false" }, "hud.visible")).toBe(false);
    expect(tokenVisibleChecked({ "hud.visible": "" }, "hud.visible")).toBe(false);
    expect(tokenVisibleChecked({ "hud.visible": 1 }, "hud.visible")).toBe(true);
    expect(tokenVisibleChecked({ "hud.visible": "yes" }, "hud.visible")).toBe(true);
  });

  it("勾选 = 清除 token 回退默认；取消勾选 = 写 0", () => {
    expect(visibleTokenEditValue(true)).toBeUndefined();
    expect(visibleTokenEditValue(false)).toBe(0);
  });
});

describe("hexColorOrNull", () => {
  it("接受 #rrggbb 与 #rgb（展开为 6 位小写）", () => {
    expect(hexColorOrNull("#AABBCC")).toBe("#aabbcc");
    expect(hexColorOrNull("#abc")).toBe("#aabbcc");
  });

  it("rgba()/渐变/非字符串 → null（色板占位）", () => {
    expect(hexColorOrNull("rgba(8,12,22,0.95)")).toBeNull();
    expect(hexColorOrNull("linear-gradient(to top, #000, #fff)")).toBeNull();
    expect(hexColorOrNull(123)).toBeNull();
    expect(hexColorOrNull(undefined)).toBeNull();
  });
});
