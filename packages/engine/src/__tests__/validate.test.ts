import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { ManifestSchema } from "../schema";
import { validateChapter, validateContent, validateManifest, validateMeta, validateReferences } from "../validate";

const manifest = {
  characters: {
    p: { name: "主角", color: "#fff", sprites: { default: "a.svg" } },
  },
  backgrounds: { bg1: "bg.svg" },
  audio: { bgm: { bgm1: "bgm.mp3" }, sfx: { sfx1: "sfx.mp3" }, voice: {} },
};

const expandedManifest = {
  ...manifest,
  cg: {
    cg_001: "assets/cg/cg_001.png",
    cg_002: {
      path: "assets/cg/cg_002.png",
      name: "屋顶",
      tags: ["night", "rain"],
      thumbnail: "assets/cg/thumbs/cg_002.png",
      group: "memory",
      unlockId: "cg_rooftop",
    },
  },
  videos: {
    op: {
      path: "assets/videos/op.mp4",
      name: "OP",
      poster: "assets/videos/op.jpg",
      skippable: true,
    },
  },
  fonts: {
    body: {
      path: "assets/fonts/body.ttf",
      family: "Body Sans",
      weight: "400",
    },
  },
  uiSkins: {
    classic: {
      name: "Classic",
      assets: { frame: "assets/ui/classic/frame.png" },
      tokens: { radius: 8, accent: "#f09" },
    },
  },
  animationAtlases: {
    heroine: {
      image: "assets/atlases/heroine.png",
      json: "assets/atlases/heroine.json",
      frameWidth: 320,
      frameHeight: 240,
    },
  },
  unlocks: {
    cg: {
      cg_rooftop: { assetId: "cg_002", title: "屋顶 CG" },
    },
    music: {
      music_theme: { audioId: "bgm1", title: "主题曲" },
    },
    replay: {
      replay_start: { nodeId: "start", title: "序章" },
    },
    endings: {
      ending_true: { title: "True End", nodeId: "ending_true" },
    },
  },
};

describe("validateContent: Zod 默认值必须应用（回归 bug #2）", () => {
  it("meta 未写 stage 时，解析后应带默认固定舞台尺寸", () => {
    const { meta } = validateContent({
      meta: { title: "T" },
      manifest,
      chapters: [],
    });

    expect(meta.stage).toEqual({ width: 1280, height: 720 });
  });

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

  it("manifestAcceptsLegacyStringAssetRefs", () => {
    const { manifest: parsed } = validateContent({
      meta: { title: "T" },
      manifest: expandedManifest,
      chapters: [],
    });

    expect(parsed.cg.cg_001).toEqual({ path: "assets/cg/cg_001.png" });
  });

  it("manifestAcceptsObjectAssetRefs", () => {
    const { manifest: parsed } = validateContent({
      meta: { title: "T" },
      manifest: expandedManifest,
      chapters: [],
    });

    expect(parsed.cg.cg_002).toEqual({
      path: "assets/cg/cg_002.png",
      name: "屋顶",
      tags: ["night", "rain"],
      thumbnail: "assets/cg/thumbs/cg_002.png",
      group: "memory",
      unlockId: "cg_rooftop",
    });
    expect(parsed.videos.op.poster).toBe("assets/videos/op.jpg");
    expect(parsed.unlocks.cg.cg_rooftop.assetId).toBe("cg_002");
  });

  it("unlockInstructionReferencesKnownUnlockId", () => {
    expect(() =>
      validateContent({
        meta: { title: "T" },
        manifest: expandedManifest,
        chapters: [{ file: "c.json", data: [{ t: "unlock", kind: "cg", id: "missing_unlock" }] }],
      }),
    ).toThrow(/missing_unlock/);
  });

  it("showCgReferencesKnownCgAsset", () => {
    expect(() =>
      validateContent({
        meta: { title: "T" },
        manifest: expandedManifest,
        chapters: [{ file: "c.json", data: [{ t: "showCg", id: "missing_cg" }] }],
      }),
    ).toThrow(/missing_cg/);
  });

  it("playVideoReferencesKnownVideoAsset", () => {
    expect(() =>
      validateContent({
        meta: { title: "T" },
        manifest: expandedManifest,
        chapters: [{ file: "c.json", data: [{ t: "playVideo", id: "missing_video" }] }],
      }),
    ).toThrow(/missing_video/);
  });

  it("acceptsKnownMediaDisplayInstructions", () => {
    const { chapters } = validateContent({
      meta: { title: "T" },
      manifest: expandedManifest,
      chapters: [{ file: "c.json", data: [{ t: "showCg", id: "cg_001" }, { t: "playVideo", id: "op" }] }],
    });

    expect(chapters[0]).toEqual([
      { t: "showCg", id: "cg_001" },
      { t: "playVideo", id: "op" },
    ]);
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

describe("runtime instruction identity", () => {
  it("instructionIdentityWarnsMissingBlockingInstructionId", () => {
    const issues = validateChapter(
      [
        { t: "say", who: "p", text: "缺少 id" },
        { t: "narrate", text: "缺少 id" },
        { t: "pause" },
        { t: "wait", ms: 100 },
      ],
      "nodes/start.json",
    );

    expect(issues).toEqual([
      expect.objectContaining({ level: "warn", file: "nodes/start.json", index: 0, code: "instruction_id_missing" }),
      expect.objectContaining({ level: "warn", file: "nodes/start.json", index: 1, code: "instruction_id_missing" }),
      expect.objectContaining({ level: "warn", file: "nodes/start.json", index: 2, code: "instruction_id_missing" }),
      expect.objectContaining({ level: "warn", file: "nodes/start.json", index: 3, code: "instruction_id_missing" }),
    ]);
  });

  it("instructionIdentityRejectsDuplicateIdsInNode", () => {
    const issues = validateChapter(
      [
        { t: "say", id: "line_01", who: "p", text: "第一句" },
        { t: "narrate", id: "line_01", text: "重复 id" },
      ],
      "nodes/start.json",
    );

    expect(issues).toEqual([
      expect.objectContaining({
        level: "error",
        file: "nodes/start.json",
        index: 1,
        code: "instruction_id_duplicate",
      }),
    ]);
  });
});

describe("shared node validation contract", () => {
  it("consumes the contracts structural corpus through engine validators", () => {
    const corpus = JSON.parse(readFileSync(
      new URL("../../../contracts/fixtures/validation-contract.json", import.meta.url),
      "utf8",
    )) as {
      nodeCases: Array<{ id: string; input: unknown; issues: Array<Record<string, unknown>> }>;
      schemaCases: Array<{
        id: string;
        schema: "graph" | "manifest" | "meta";
        input: unknown;
        issues: Array<Record<string, unknown>>;
      }>;
    };
    const stable = (issues: ReturnType<typeof validateChapter>) => issues.map((issue) => ({
      code: issue.code,
      severity: issue.level,
      source: issue.source,
      jsonPath: issue.jsonPath,
    }));

    for (const testCase of corpus.nodeCases) {
      expect(stable(validateChapter(testCase.input, `${testCase.id}.json`)), testCase.id)
        .toEqual(testCase.issues);
    }
    for (const testCase of corpus.schemaCases.filter(({ schema }) => schema !== "graph")) {
      const issues = testCase.schema === "manifest"
        ? validateManifest(testCase.input, `${testCase.id}.json`)
        : validateMeta(testCase.input, `${testCase.id}.json`);
      expect(stable(issues), testCase.id).toEqual(testCase.issues);
    }
  });

  it("normalizes structural issues with contracts-owned code and path", () => {
    const issues = validateChapter(
      [{ t: "playVideo", id: "opening", skippable: "yes" }],
      "nodes/contract.json",
    );

    expect(issues).toEqual([
      expect.objectContaining({
        code: "instruction_invalid_field",
        level: "error",
        source: "node",
        file: "nodes/contract.json",
        index: 0,
        jsonPath: "$[0].skippable",
      }),
    ]);
  });

  it("matches the contracts semantic corpus across stable issue fields", () => {
    const fixture = JSON.parse(readFileSync(
      new URL("../../../contracts/fixtures/node-semantic-contract.json", import.meta.url),
      "utf8",
    ));
    const parsedManifest = ManifestSchema.parse(fixture.manifest);
    const issues = [
      ...validateChapter(fixture.instructions, "nodes/contract.json"),
      ...validateReferences(fixture.instructions, parsedManifest, "nodes/contract.json"),
    ];

    const stable = issues.map((issue) => ({
      code: issue.code,
      severity: issue.level,
      source: issue.source,
      jsonPath: issue.jsonPath,
    })).sort((left, right) => `${left.jsonPath}\0${left.code}`.localeCompare(
      `${right.jsonPath}\0${right.code}`,
    ));
    const expected = [...fixture.expectedIssues].sort((left, right) =>
      `${left.jsonPath}\0${left.code}`.localeCompare(`${right.jsonPath}\0${right.code}`));

    expect(stable).toEqual(expected);
  });
});
