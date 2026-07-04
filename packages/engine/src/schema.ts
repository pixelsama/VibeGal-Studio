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

export const SayInstruction = z.object({
  t: z.literal("say"),
  who: z.string(), // 引用 manifest.characters 的 key
  expr: z.string().default("default"),
  text: z.string().min(1),
  ms: z.number().int().nonnegative().optional(), // 打完后的停顿覆盖（0=跟随全局）
});

export const NarrateInstruction = z.object({
  t: z.literal("narrate"),
  text: z.string().min(1),
  ms: z.number().int().nonnegative().optional(), // 该条旁白的自动停顿覆盖（0=跟随全局）
});

export const ChoiceInstruction = z.object({
  t: z.literal("choice"),
  choices: z.array(z.object({
    text: z.string().min(1),
    to: z.string().min(1),
  })).min(1),
});

export const WaitInstruction = z.object({
  t: z.literal("wait"),
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

export const InstructionSchema = z.discriminatedUnion("t", [
  BgInstruction,
  BgmInstruction,
  SfxInstruction,
  VoiceInstruction,
  CharInstruction,
  SayInstruction,
  NarrateInstruction,
  ChoiceInstruction,
  WaitInstruction,
  EffectInstruction,
  TransitionInstruction,
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
});

// ──────────────────────────────────────────────
// meta：全局播放参数
// ──────────────────────────────────────────────

export const MetaSchema = z.object({
  title: z.string().default(""),
  typingSpeedCps: z.number().positive().default(30), // 每秒字符数
  autoAdvanceMs: z.number().int().nonnegative().default(1200),
  chapterGapMs: z.number().int().nonnegative().default(1500),
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
  // 当前固定 null；分支条件留作后续扩展。用 unknown+nullable 保留任意 JSON。
  condition: z.unknown().nullable().default(null),
});

export const ProjectGraphSchema = z.object({
  version: z.number().int().nonnegative().default(1),
  entryNodeId: z.string(), // 空串 = 未设置入口
  nodes: z.array(GraphNodeSchema).default([]),
  edges: z.array(GraphEdgeSchema).default([]),
});
