import { z } from "zod";

/**
 * Zod schema 是数据契约的【唯一来源】。
 * types.ts 中的类型全部从这里反推，保证「类型」与「运行时校验」永不漂移。
 * 以后 vibe 出来的小工具 import 这些 schema 来校验/解析用户数据即可。
 */

// ──────────────────────────────────────────────
// 指令（instruction）：剧本数组中的每一条
// 用判别联合（discriminated union）按 t 字段区分。
// 新增指令 = 在这里加一个分支 + interpreter 加一个 case，集中可见。
// ──────────────────────────────────────────────

export const BgInstruction = z.object({
  t: z.literal("bg"),
  id: z.string(), // 引用 manifest.backgrounds 的 key
  trans: z.enum(["fade", "cut", "dissolve"]).default("fade"),
  ms: z.number().int().nonnegative().default(1000),
});

export const BgmInstruction = z.object({
  t: z.literal("bgm"),
  id: z.string(), // 引用 manifest.audio.bgm 的 key
  fade: z.number().int().nonnegative().default(1500),
  loop: z.boolean().default(true),
});

export const SfxInstruction = z.object({
  t: z.literal("sfx"),
  id: z.string(), // 引用 manifest.audio.sfx 的 key
});

export const VoiceInstruction = z.object({
  t: z.literal("voice"),
  id: z.string(), // 引用 manifest.audio.voice 的 key
});

export const CharInstruction = z.object({
  t: z.literal("char"),
  id: z.string(), // 引用 manifest.characters 的 key
  pos: z.string().default("center"), // 语义槽名，坐标由组件决定
  expr: z.string().default("default"), // 引用该角色 sprites 的 key
  trans: z.enum(["fade", "cut", "slide"]).default("fade"),
  ms: z.number().int().nonnegative().default(600),
  clear: z.boolean().default(false), // true = 先清空场上所有立绘再登场
  remove: z.boolean().default(false), // true = 让该角色退场
});

export const StableInstructionIdSchema = z
  .string()
  .min(1)
  .describe("Stable story-point id for stoppable/runtime-restorable instructions. Required by validation for say/narrate/wait/pause.");

export const SayInstruction = z.object({
  t: z.literal("say"),
  id: StableInstructionIdSchema.optional(),
  who: z.string(), // 引用 manifest.characters 的 key
  expr: z.string().default("default"),
  text: z.string().min(1),
  ms: z.number().int().nonnegative().optional(), // 打完后的停顿覆盖（0=跟随全局）
});

export const NarrateInstruction = z.object({
  t: z.literal("narrate"),
  id: StableInstructionIdSchema.optional(),
  text: z.string().min(1),
  ms: z.number().int().nonnegative().optional(), // 该条旁白的自动停顿覆盖（0=跟随全局）
});

export const VariableValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const SetInstruction = z.object({
  t: z.literal("set"),
  key: z.string().min(1),
  value: VariableValueSchema,
});

export const WaitInstruction = z.object({
  t: z.literal("wait"),
  id: StableInstructionIdSchema.optional(),
  ms: z.number().int().nonnegative(),
});

export const EffectInstruction = z.object({
  t: z.literal("effect"),
  type: z.enum(["shake", "flash", "blur"]),
  intensity: z.number().min(0).max(20).default(6),
  ms: z.number().int().nonnegative().default(400),
});

export const TransitionInstruction = z.object({
  t: z.literal("transition"),
  type: z.enum(["fade_in", "fade_out", "white_in", "white_out", "black"]),
  ms: z.number().int().nonnegative().default(1000),
});

export const PauseInstruction = z.object({
  t: z.literal("pause"),
  id: StableInstructionIdSchema.optional(),
});

export const UnlockInstruction = z.object({
  t: z.literal("unlock"),
  kind: z.enum(["cg", "music", "replay", "endings"]),
  id: z.string().min(1),
});

export const ShowCgInstruction = z.object({
  t: z.literal("showCg"),
  id: z.string().min(1),
});

export const PlayVideoInstruction = z.object({
  t: z.literal("playVideo"),
  id: z.string().min(1),
  skippable: z.boolean().optional(),
});

export const InstructionSchema = z.discriminatedUnion("t", [
  BgInstruction,
  BgmInstruction,
  SfxInstruction,
  VoiceInstruction,
  CharInstruction,
  SayInstruction,
  NarrateInstruction,
  SetInstruction,
  WaitInstruction,
  EffectInstruction,
  TransitionInstruction,
  PauseInstruction,
  UnlockInstruction,
  ShowCgInstruction,
  PlayVideoInstruction,
]);

export const ChapterSchema = z.array(InstructionSchema);

// ──────────────────────────────────────────────
// manifest：资源表。剧本只引用 id，路径集中在这里。
//
// audio 按用途拆成三张子表（bgm / sfx / voice），与指令类型
// （BgmInstruction / SfxInstruction / VoiceInstruction）一一对应。
// 这样资产页可按子表分类浏览，引用校验也能精确到子类。
//
// .strict()：遇到未知字段（如旧 flat audio 的 audio.bgm_main）直接报错，
// 而非静默丢弃。这样旧格式项目会得到清晰的 manifest_invalid_audio 错误，
// 而不是数据被无声清空。错误通过 projectReport 进全局问题面板，不阻断加载。
// ──────────────────────────────────────────────

const AudioRegistrySchema = z
  .strictObject({
    bgm: z.record(z.string(), z.string()).default({}),
    sfx: z.record(z.string(), z.string()).default({}),
    voice: z.record(z.string(), z.string()).default({}),
  })
  .default({ bgm: {}, sfx: {}, voice: {} });

export const AssetRefSchema = z.strictObject({
  path: z.string().min(1),
  name: z.string().optional(),
  tags: z.array(z.string()).optional(),
  thumbnail: z.string().optional(),
});

export const AssetRefInputSchema = z
  .union([z.string().min(1), AssetRefSchema])
  .transform((value) => (typeof value === "string" ? { path: value } : value));

export const CgAssetRefSchema = AssetRefSchema.extend({
  group: z.string().optional(),
  unlockId: z.string().optional(),
});

export const CgAssetRefInputSchema = z
  .union([z.string().min(1), CgAssetRefSchema])
  .transform((value) => (typeof value === "string" ? { path: value } : value));

export const VideoAssetRefSchema = AssetRefSchema.extend({
  poster: z.string().optional(),
  skippable: z.boolean().optional(),
});

export const VideoAssetRefInputSchema = z
  .union([z.string().min(1), VideoAssetRefSchema])
  .transform((value) => (typeof value === "string" ? { path: value } : value));

export const FontAssetSchema = z.strictObject({
  path: z.string().min(1),
  family: z.string().min(1),
  weight: z.string().optional(),
  style: z.string().optional(),
});

export const UiSkinSchema = z.strictObject({
  name: z.string().optional(),
  assets: z.record(z.string(), z.string()).default({}),
  tokens: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});

export const AnimationAtlasSchema = z.strictObject({
  image: z.string().min(1),
  json: z.string().optional(),
  frameWidth: z.number().int().positive().optional(),
  frameHeight: z.number().int().positive().optional(),
});

export const UnlockRegistrySchema = z.strictObject({
  cg: z.record(z.string(), z.strictObject({
    assetId: z.string().min(1),
    title: z.string().optional(),
  })).default({}),
  music: z.record(z.string(), z.strictObject({
    audioId: z.string().min(1),
    title: z.string().optional(),
  })).default({}),
  replay: z.record(z.string(), z.strictObject({
    nodeId: z.string().min(1),
    title: z.string().optional(),
  })).default({}),
  endings: z.record(z.string(), z.strictObject({
    title: z.string().min(1),
    nodeId: z.string().optional(),
  })).default({}),
}).default({ cg: {}, music: {}, replay: {}, endings: {} });

export const ManifestSchema = z.strictObject({
  characters: z.record(
    z.string(),
    z.object({
      name: z.string(),
      color: z.string().default("#ffffff"),
      sprites: z.record(z.string(), z.string()), // expr → 路径
    }),
  ),
  backgrounds: z.record(z.string(), z.string()), // id → 路径
  audio: AudioRegistrySchema, // 三类音频 id → 路径
  cg: z.record(z.string(), CgAssetRefInputSchema).default({}),
  videos: z.record(z.string(), VideoAssetRefInputSchema).default({}),
  fonts: z.record(z.string(), FontAssetSchema).default({}),
  uiSkins: z.record(z.string(), UiSkinSchema).default({}),
  animationAtlases: z.record(z.string(), AnimationAtlasSchema).default({}),
  unlocks: UnlockRegistrySchema,
});

// ──────────────────────────────────────────────
// meta：全局播放参数
// ──────────────────────────────────────────────

export const StageConfigSchema = z.object({
  width: z.number().int().min(320).max(7680).default(1280),
  height: z.number().int().min(180).max(4320).default(720),
}).default({ width: 1280, height: 720 });

export const MetaSchema = z.object({
  title: z.string().default(""),
  typingSpeedCps: z.number().positive().default(30), // 每秒字符数
  autoAdvanceMs: z.number().int().nonnegative().default(1200),
  chapterGapMs: z.number().int().nonnegative().default(1500),
  stage: StageConfigSchema,
});

// ──────────────────────────────────────────────
// graph：脚本图结构（content/graph.json + content/nodes/*.json）
// Phase 11：补 graph 的 zod schema，供外部工具/Agent 校验与 JSON Schema 导出。
// 字段与 studio lib/types.ts 的 ProjectGraph + Rust lib.rs 的 ProjectGraph 对齐。
// ──────────────────────────────────────────────

export const GraphPositionSchema = z.object({
  x: z.number().default(0),
  y: z.number().default(0),
}).default({ x: 0, y: 0 });

export const GraphNodeSchema = z.object({
  id: z.string().min(1),
  // Rust loader accepts missing title and falls back to id.
  title: z.string().optional(),
  file: z.string().min(1), // 相对 content 根，如 "nodes/prologue.json"
  position: GraphPositionSchema,
});

export const GraphEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  mode: z.enum(["linear", "choice", "auto"]).default("linear"),
  label: z.string().nullable().default(null),
  condition: z.string().nullable().default(null),
});

export const ProjectGraphSchema = z.object({
  version: z.number().int().nonnegative().default(1),
  entryNodeId: z.string(), // 空串 = 未设置入口
  nodes: z.array(GraphNodeSchema).default([]),
  edges: z.array(GraphEdgeSchema).default([]),
});
