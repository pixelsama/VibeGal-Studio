import { z } from "zod";
import { instructionPolicies } from "./diagnostics";

/**
 * @vibegal/contracts 中的 Zod schema 是数据契约的【唯一来源】。
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
}).meta({ "x-vibegal": instructionPolicies.bg });

export const BgmInstruction = z.object({
  t: z.literal("bgm"),
  id: z.string(), // 引用 manifest.audio.bgm 的 key
  fade: z.number().int().nonnegative().default(1500),
  loop: z.boolean().default(true),
}).meta({ "x-vibegal": instructionPolicies.bgm });

export const SfxInstruction = z.object({
  t: z.literal("sfx"),
  id: z.string(), // 引用 manifest.audio.sfx 的 key
}).meta({ "x-vibegal": instructionPolicies.sfx });

export const VoiceInstruction = z.object({
  t: z.literal("voice"),
  id: z.string(), // 引用 manifest.audio.voice 的 key
}).meta({ "x-vibegal": instructionPolicies.voice });

export const CharInstruction = z.object({
  t: z.literal("char"),
  id: z.string(), // 引用 manifest.characters 的 key
  pos: z.string().default("center"), // 语义槽名，坐标由组件决定
  expr: z.string().default("default"), // 引用该角色 sprites 的 key
  trans: z.enum(["fade", "cut", "slide"]).default("fade"),
  ms: z.number().int().nonnegative().default(600),
  clear: z.boolean().default(false), // true = 先清空场上所有立绘再登场
  remove: z.boolean().default(false), // true = 让该角色退场
  scale: z.number().min(0.1).max(4).default(1),
  flip: z.boolean().default(false),
  moveFrom: z.string().min(1).optional(),
  exprMs: z.number().int().nonnegative().default(0),
}).meta({ "x-vibegal": instructionPolicies.char });

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
  textKey: z.string().min(1).optional(),
  voice: z.string().min(1).optional(), // 引用 manifest.audio.voice 的 key
  ms: z.number().int().nonnegative().optional(), // 打完后的停顿覆盖（0=跟随全局）
}).meta({ "x-vibegal": instructionPolicies.say });

export const NarrateInstruction = z.object({
  t: z.literal("narrate"),
  id: StableInstructionIdSchema.optional(),
  text: z.string().min(1),
  textKey: z.string().min(1).optional(),
  ms: z.number().int().nonnegative().optional(), // 该条旁白的自动停顿覆盖（0=跟随全局）
}).meta({ "x-vibegal": instructionPolicies.narrate });

export const VariableValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const SetInstruction = z.strictObject({
  t: z.literal("set"),
  id: StableInstructionIdSchema.optional(),
  key: z.string().min(1),
  value: VariableValueSchema.optional(),
  expr: z.string().min(1).optional(),
}).superRefine((instruction, context) => {
  const hasValue = Object.prototype.hasOwnProperty.call(instruction, "value");
  const hasExpression = Object.prototype.hasOwnProperty.call(instruction, "expr");
  if (hasValue === hasExpression) {
    context.addIssue({
      code: "custom",
      path: hasValue ? ["expr"] : ["value"],
      message: "set 指令必须且只能提供 value 或 expr 之一",
    });
  }
}).meta({ "x-vibegal": instructionPolicies.set });

export const WaitInstruction = z.object({
  t: z.literal("wait"),
  id: StableInstructionIdSchema.optional(),
  ms: z.number().int().nonnegative(),
}).meta({ "x-vibegal": instructionPolicies.wait });

export const EffectInstruction = z.object({
  t: z.literal("effect"),
  type: z.enum(["shake", "flash", "blur"]),
  intensity: z.number().min(0).max(20).default(6),
  ms: z.number().int().nonnegative().default(400),
}).meta({ "x-vibegal": instructionPolicies.effect });

export const TransitionInstruction = z.object({
  t: z.literal("transition"),
  type: z.enum(["fade_in", "fade_out", "white_in", "white_out", "black"]),
  ms: z.number().int().nonnegative().default(1000),
}).meta({ "x-vibegal": instructionPolicies.transition });

export const PauseInstruction = z.object({
  t: z.literal("pause"),
  id: StableInstructionIdSchema.optional(),
}).meta({ "x-vibegal": instructionPolicies.pause });

export const InputNameInstruction = z.strictObject({
  t: z.literal("inputName"),
  // New Scenario drafts may omit identity until saveNode assigns the stable story-point ID.
  id: StableInstructionIdSchema.optional(),
  key: z.string().min(1),
  prompt: z.string().min(1),
  default: z.string().optional(),
  maxLength: z.number().int().min(1).max(100).default(20),
}).meta({ "x-vibegal": instructionPolicies.inputName });

export const UnlockInstruction = z.object({
  t: z.literal("unlock"),
  kind: z.enum(["cg", "music", "replay", "endings"]),
  id: z.string().min(1),
}).meta({ "x-vibegal": instructionPolicies.unlock });

export const ShowCgInstruction = z.object({
  t: z.literal("showCg"),
  id: z.string().min(1),
}).meta({ "x-vibegal": instructionPolicies.showCg });

export const PlayVideoInstruction = z.object({
  t: z.literal("playVideo"),
  id: z.string().min(1),
  skippable: z.boolean().optional(),
}).meta({ "x-vibegal": instructionPolicies.playVideo });

export const CompleteEndingInstruction = z.strictObject({
  t: z.literal("completeEnding"),
  id: StableInstructionIdSchema,
  endingId: z.string().min(1),
}).meta({ "x-vibegal": instructionPolicies.completeEnding });

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
  InputNameInstruction,
  UnlockInstruction,
  ShowCgInstruction,
  PlayVideoInstruction,
  CompleteEndingInstruction,
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

export const AnimationAtlasClipSchema = z.strictObject({
  frames: z.array(z.number().int().nonnegative()).min(1),
  fps: z.number().min(1).max(60),
  loop: z.boolean().default(true),
});

export const AnimationAtlasSchema = z.strictObject({
  image: z.string().min(1),
  json: z.string().optional(),
  frameWidth: z.number().int().positive().optional(),
  frameHeight: z.number().int().positive().optional(),
  clips: z.record(z.string(), AnimationAtlasClipSchema).optional(),
});

export const AtlasSpriteRefSchema = z.strictObject({
  atlas: z.string().min(1),
  clip: z.string().min(1),
  fallback: z.string().min(1),
});

export const CharacterSpriteRefSchema = z.union([
  z.string().min(1),
  AtlasSpriteRefSchema,
]);

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
      sprites: z.record(z.string(), CharacterSpriteRefSchema), // expr → 静态路径或 atlas clip
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

export const DistributionVersionSchema = z.string().regex(
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  "作品版本必须使用 SemVer，例如 1.0.0 或 1.0.0-beta.1",
);

export const DistributionIconSchema = z.string().regex(
  /^assets\/[A-Za-z0-9_@+-]+(?:\.[A-Za-z0-9_@+-]+)*(?:\/[A-Za-z0-9_@+-]+(?:\.[A-Za-z0-9_@+-]+)*)*$/,
  "分发图标必须是 assets/ 下不含路径穿越的项目相对路径",
);

export const DistributionViewportSchema = z.strictObject({
  mode: z.enum(["fit", "fill", "responsive"]),
  width: z.number().int().min(320).max(7680),
  height: z.number().int().min(180).max(4320),
});

export const DistributionUpdatesSchema = z.union([
  z.strictObject({
    channel: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).default("stable"),
  }),
  z.strictObject({
    channel: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).default("stable"),
    endpoint: z.string().url().startsWith("https://"),
    publicKey: z.string().min(1),
  }),
]);

export const DistributionConfigSchema = z.strictObject({
  version: DistributionVersionSchema.default("0.1.0"),
  productName: z.string().trim().min(1).max(128).optional(),
  icon: DistributionIconSchema.optional(),
  viewport: DistributionViewportSchema.optional(),
  updates: DistributionUpdatesSchema.optional(),
});

export const LocaleTagSchema = z.string().regex(
  /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/,
  "语言标签必须使用 BCP 47 风格，例如 zh-CN 或 en",
).transform(canonicalizeLocaleTag);

export const LocaleConfigSchema = z.strictObject({
  default: LocaleTagSchema,
  available: z.array(LocaleTagSchema).min(1),
}).superRefine((locale, context) => {
  if (!locale.available.includes(locale.default)) {
    context.addIssue({
      code: "custom",
      path: ["default"],
      message: "默认语言必须包含在 available 中",
    });
  }
  const seen = new Set<string>();
  locale.available.forEach((tag, index) => {
    if (seen.has(tag)) {
      context.addIssue({
        code: "custom",
        path: ["available", index],
        message: `语言标签 ${tag} 重复`,
      });
    }
    seen.add(tag);
  });
});

export const LocaleTableSchema = z.record(z.string().min(1), z.string());

export const MetaSchema = z.object({
  title: z.string().default(""),
  typingSpeedCps: z.number().positive().default(30), // 每秒字符数
  autoAdvanceMs: z.number().int().nonnegative().default(1200),
  chapterGapMs: z.number().int().nonnegative().default(1500),
  stage: StageConfigSchema,
  locale: LocaleConfigSchema.optional(),
  distribution: DistributionConfigSchema.optional(),
});

function canonicalizeLocaleTag(tag: string): string {
  return tag.split("-").map((part, index) => {
    if (index === 0) return part.toLowerCase();
    if (/^[A-Za-z]{4}$/.test(part)) {
      return `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`;
    }
    if (/^(?:[A-Za-z]{2}|\d{3})$/.test(part)) return part.toUpperCase();
    return part.toLowerCase();
  }).join("-");
}

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
  chapterId: z.string().min(1),
});

export const ChapterCheckpointSchema = z.strictObject({
  nodeId: z.string().min(1),
  instructionId: z.string().min(1).nullable().optional(),
  vars: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  background: z.string().nullable().default(null),
  sprites: z.array(z.strictObject({
    id: z.string().min(1),
    pos: z.string().min(1),
    expr: z.string().min(1),
    scale: z.number().min(0.1).max(4).default(1),
    flip: z.boolean().default(false),
  })).default([]),
  bgm: z.strictObject({
    id: z.string().min(1),
    loop: z.boolean().default(true),
  }).nullable().default(null),
});

export const GraphChapterSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  checkpoint: ChapterCheckpointSchema.optional(),
});

export const GraphEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  mode: z.enum(["linear", "choice", "auto"]).default("linear"),
  label: z.string().nullable().default(null),
  condition: z.string().nullable().default(null),
  /**
   * State changes that happen because the story took *this* exit.
   *
   * Putting a `set` in the target node instead fires it for every way into that
   * node, so a shared "next morning" scene would credit affection no matter
   * which option the player picked. Reuses SetInstruction so the shape, the
   * validator and external agents are all unchanged.
   */
  effects: z.array(SetInstruction).optional(),
});

export const ProjectGraphSchema = z.object({
  version: z.number().int().nonnegative().max(4_294_967_295).default(1),
  entryNodeId: z.string(), // 空串 = 未设置入口
  chapters: z.array(GraphChapterSchema).min(1),
  nodes: z.array(GraphNodeSchema).default([]),
  edges: z.array(GraphEdgeSchema).default([]),
}).superRefine((graph, context) => {
  const chapterIds = new Set(graph.chapters.map((chapter) => chapter.id));
  graph.nodes.forEach((node, index) => {
    if (!chapterIds.has(node.chapterId)) {
      context.addIssue({
        code: "custom",
        path: ["nodes", index, "chapterId"],
        message: `节点引用了不存在的章节 ${node.chapterId}`,
      });
    }
  });
});

// Authoring intent behind a variable. `kind` is a lens over `type`, never a
// replacement: `type` stays required and authoritative so the Rust validator,
// expression evaluation and external agents keep working unchanged. Legacy
// registries without `kind` are read through the same lens by inference
// (boolean -> flag, number -> meter, string -> text).
export const VariableKindSchema = z.enum(["flag", "meter", "state", "counter", "text"]);

/** Named range of a meter/counter, so conditions read "达到 喜欢" not ">= 60". */
export const VariableBandSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  // Inclusive upper bound. The last band omits it to mean "up to max".
  upTo: z.number().optional(),
});

/** Allowed value of a `state` variable, so authors pick instead of typing. */
export const VariableOptionSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
});

// Project-level variable declarations. Runtime state remains scalar-only and
// scope is explicit so save slots never accidentally capture global progress.
export const VariableDeclarationSchema = z.strictObject({
  kind: VariableKindSchema.optional(),
  label: z.string().optional(),
  type: z.enum(["string", "number", "boolean"]),
  default: VariableValueSchema,
  nullable: z.boolean().default(false),
  scope: z.enum(["run", "global"]).default("run"),
  description: z.string().optional(),
  // manifest.characters key this variable belongs to (per-character meters).
  of: z.string().min(1).optional(),
  // Explicit bounds are clamped at write time. Absent bounds stay unbounded,
  // so registries that predate this field keep their exact runtime behaviour.
  min: z.number().optional(),
  max: z.number().optional(),
  bands: z.array(VariableBandSchema).optional(),
  options: z.array(VariableOptionSchema).optional(),
  // Read by the renderer only; suppresses the "never read by any branch" hint.
  displayOnly: z.boolean().optional(),
}).superRefine((declaration, context) => {
  const expectedType = declaration.kind ? VARIABLE_KIND_TYPE[declaration.kind] : undefined;
  if (expectedType && expectedType !== declaration.type) {
    context.addIssue({ code: "custom", path: ["type"], message: `${declaration.kind} 变量的 type 必须是 ${expectedType}` });
  }
  if (declaration.min != null && declaration.max != null && declaration.min > declaration.max) {
    context.addIssue({ code: "custom", path: ["max"], message: "变量上限不能小于下限" });
  }
  if ((declaration.min != null || declaration.max != null) && declaration.type !== "number") {
    context.addIssue({ code: "custom", path: ["min"], message: "只有数值变量可以声明范围" });
  }
  if (declaration.bands) {
    if (declaration.type !== "number") {
      context.addIssue({ code: "custom", path: ["bands"], message: "只有数值变量可以声明分段" });
    }
    const bounded = declaration.bands.filter((band) => band.upTo != null);
    bounded.forEach((band, index) => {
      if (index > 0 && band.upTo! <= bounded[index - 1].upTo!) {
        context.addIssue({ code: "custom", path: ["bands", index, "upTo"], message: "分段上界必须递增" });
      }
    });
    if (declaration.bands.length > 0 && declaration.bands.at(-1)!.upTo != null && declaration.max == null) {
      context.addIssue({ code: "custom", path: ["bands"], message: "最后一个分段应省略 upTo，或为变量声明 max" });
    }
  }
  if (declaration.options) {
    if (declaration.type !== "string") {
      context.addIssue({ code: "custom", path: ["options"], message: "只有文本变量可以声明可选值" });
    }
    const ids = new Set<string>();
    declaration.options.forEach((option, index) => {
      if (ids.has(option.id)) {
        context.addIssue({ code: "custom", path: ["options", index, "id"], message: `可选值 ${option.id} 重复` });
      }
      ids.add(option.id);
    });
    if (typeof declaration.default === "string" && declaration.options.length > 0 && !ids.has(declaration.default)) {
      context.addIssue({ code: "custom", path: ["default"], message: "默认值必须是已声明的可选值之一" });
    }
  }
  if (declaration.default === null) {
    if (!declaration.nullable) {
      context.addIssue({ code: "custom", path: ["default"], message: "只有 nullable 变量可使用 null 默认值" });
    }
    return;
  }
  if (typeof declaration.default !== declaration.type) {
    context.addIssue({ code: "custom", path: ["default"], message: "变量默认值与声明类型不匹配" });
  }
});

const VARIABLE_KIND_TYPE = {
  flag: "boolean",
  meter: "number",
  counter: "number",
  state: "string",
  text: "string",
} as const;

// system.* is runtime-provided; chose.*/seen.* are derived from the decision
// log. All three are read-only namespaces that projects must not declare.
const VariableNameSchema = z.string().regex(
  /^(?!(?:system|chose|seen)\.)(?:[A-Za-z_][A-Za-z0-9_]*)(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/,
  "变量名必须是点号分隔的标识符，且不能使用 system. / chose. / seen. 前缀",
);

export const VariableRegistrySchema = z.strictObject({
  version: z.literal(1),
  variables: z.record(VariableNameSchema, VariableDeclarationSchema).default({}),
});
