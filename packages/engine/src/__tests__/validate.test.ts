import { describe, it, expect } from "vitest";
import { validateContent, validateManifest } from "../validate";

const manifest = {
  characters: {
    p: { name: "主角", color: "#fff", sprites: { default: "a.svg" } },
  },
  backgrounds: { bg1: "bg.svg" },
  audio: { bgm: { bgm1: "bgm.mp3" }, sfx: { sfx1: "sfx.mp3" }, voice: {} },
};

describe("validateContent: Zod 默认值必须应用（回归 bug #2）", () => {
  it("bgm 指令未写 loop/fade 时，解析后应带默认值 loop=true/fade=1500", () => {
    // 修复前：player 拿到的是原始 JSON，loop 是 undefined → BGM 不循环
    // 修复后：validateContent 返回 Zod 解析后的 chapters，默认值已应用
    const { chapters } = validateContent({
      meta: { chapters: ["c.json"] },
      manifest,
      chapters: [{ file: "c.json", data: [{ t: "bgm", id: "bgm1" }] }],
    });
    expect(chapters).toHaveLength(1);
    const instr = chapters[0][0];
    expect(instr.t).toBe("bgm");
    if (instr.t === "bgm") {
      expect(instr.loop).toBe(true); // schema 默认值
      expect(instr.fade).toBe(1500); // schema 默认值
    }
  });

  it("say 指令未写 ms 时，ms 应为 undefined（可选字段，不是默认值场景）；expr 未写应为 default", () => {
    const { chapters } = validateContent({
      meta: { chapters: ["c.json"] },
      manifest,
      chapters: [{ file: "c.json", data: [{ t: "say", who: "p", text: "你好" }] }],
    });
    const instr = chapters[0][0];
    if (instr.t === "say") {
      expect(instr.expr).toBe("default"); // 默认值
      expect(instr.ms).toBeUndefined(); // 可选，无默认
    }
  });

  it("char 指令未写 trans/pos/expr/remove 时，全部应用默认值", () => {
    const { chapters } = validateContent({
      meta: { chapters: ["c.json"] },
      manifest,
      chapters: [{ file: "c.json", data: [{ t: "char", id: "p" }] }],
    });
    const instr = chapters[0][0];
    if (instr.t === "char") {
      expect(instr.pos).toBe("center");
      expect(instr.expr).toBe("default");
      expect(instr.trans).toBe("fade");
      expect(instr.clear).toBe(false);
      expect(instr.remove).toBe(false);
    }
  });

  it("引用不存在的角色 id 应抛错并指明", () => {
    expect(() =>
      validateContent({
        meta: { chapters: ["c.json"] },
        manifest,
        chapters: [{ file: "c.json", data: [{ t: "say", who: "ghost", expr: "default", text: "…" }] }],
      }),
    ).toThrow(/ghost/);
  });
});

describe("validateManifest: strict 拒绝旧 flat audio", () => {
  it("旧 flat audio（audio.bgm_main）应被 manifest 校验报错，而非静默清空", () => {
    // 旧格式：audio 是扁平 id→path，没有 bgm/sfx/voice 子表
    const oldManifest = {
      characters: {},
      backgrounds: {},
      audio: { bgm_main: "bgm.mp3", sfx_boom: "sfx.mp3" },
    };
    const issues = validateManifest(oldManifest);
    expect(issues.length).toBeGreaterThan(0);
    // 错误应提及未知键（bgm_main/sfx_boom）
    const joined = issues.map((i) => i.message).join(" ");
    expect(joined).toMatch(/bgm_main|sfx_boom|unrecognised|unrecognized|Unknown/i);
  });

  it("新格式（bgm/sfx/voice 子表）应通过校验", () => {
    const issues = validateManifest({
      characters: {},
      backgrounds: {},
      audio: { bgm: { theme: "bgm.mp3" }, sfx: {}, voice: {} },
    });
    expect(issues).toEqual([]);
  });
});
