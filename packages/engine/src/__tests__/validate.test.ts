import { describe, it, expect } from "vitest";
import { validateContent } from "../validate";

const manifest = {
  characters: {
    p: { name: "主角", color: "#fff", sprites: { default: "a.svg" } },
  },
  backgrounds: { bg1: "bg.svg" },
  audio: { bgm1: "bgm.mp3", sfx1: "sfx.mp3" },
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
