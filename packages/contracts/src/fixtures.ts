import { z } from "zod";

/**
 * 自定义 fixture（`content/fixtures/*.json`）的数据契约 —— Spec 17 步骤 5。
 *
 * 每个 fixture 文件描述一个设计/预览场景：一份 NovelState 视图契约快照，
 * 加上可选的 unlock 瘦身快照（persistent）与面板提示（uiHint）。
 * Studio 场景刷与 CLI `renderer-snapshot` 单源读取该格式。
 *
 * NovelStateSchema 与 @vibegal/engine `state.ts` 的 NovelState 字段逐一对应；
 * 两者的类型等价由 engine 侧的 expectTypeOf 测试锁定，改动任意一边都会报错。
 */

// ──────────────────────────────────────────────
// NovelState：引擎视图契约快照（字段与 engine state.ts 对齐）
// ──────────────────────────────────────────────

export const FixtureActiveSpriteSchema = z.object({
  id: z.string(),
  pos: z.string(),
  expr: z.string(),
  changeId: z.number(),
  justEntered: z.boolean(),
  prevExpr: z.string().nullable(),
  prevPos: z.string().nullable(),
  trans: z.enum(["fade", "cut", "slide"]),
  leaving: z.boolean(),
});

export const FixtureSpeakerSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  expr: z.string(),
});

export const FixturePendingEffectSchema = z.object({
  id: z.number(),
  type: z.enum(["shake", "flash", "blur"]),
  intensity: z.number(),
  ms: z.number(),
});

export const FixturePendingTransitionSchema = z.object({
  id: z.number(),
  type: z.enum(["fade_in", "fade_out", "white_in", "white_out", "black"]),
  ms: z.number(),
});

const TypewriterTextSchema = z.object({
  text: z.string(),
  typedLen: z.number(),
  fullyRevealed: z.boolean(),
});

export const NovelStateSchema = z.object({
  vars: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null()]),
  ),
  background: z.string().nullable(),
  backgroundTrans: z.enum(["fade", "cut", "dissolve"]),
  backgroundMs: z.number(),
  sprites: z.array(FixtureActiveSpriteSchema),
  speaker: FixtureSpeakerSchema.nullable(),
  dialogue: TypewriterTextSchema.nullable(),
  narration: TypewriterTextSchema.nullable(),
  choice: z
    .object({
      choices: z.array(z.object({ text: z.string(), to: z.string() })),
    })
    .nullable(),
  effects: z.array(FixturePendingEffectSchema),
  transitions: z.array(FixturePendingTransitionSchema),
  audio: z.object({
    bgm: z
      .object({ id: z.string(), fade: z.number(), loop: z.boolean() })
      .nullable(),
    sfx: z.array(z.object({ id: z.string(), seq: z.number() })),
    voice: z.object({ id: z.string(), seq: z.number() }).nullable(),
  }),
  flags: z.object({
    isWaiting: z.boolean(),
    isAutoPlay: z.boolean(),
    skipMode: z.enum(["off", "read", "all"]),
    isRecording: z.boolean(),
    chapterIndex: z.number(),
    progress: z.object({ current: z.number(), total: z.number() }),
  }),
  currentCueMs: z.number().nullable(),
});

// ──────────────────────────────────────────────
// FixtureFile：content/fixtures/*.json 的单文件格式
// ──────────────────────────────────────────────

/** uiHint.panel 的合法取值：Studio/CLI 宿主据此把对应面板置为初始可见。 */
export const FIXTURE_UI_PANELS = [
  "save",
  "history",
  "settings",
  "gallery-cg",
  "gallery-replay",
  "gallery-music",
  "gallery-endings",
] as const;

export const FixtureUiPanelSchema = z.enum(FIXTURE_UI_PANELS);

/** unlock 瘦身快照（不照搬 GlobalPersistentRecord 全形），宿主映射进 initialGlobalPersistent。 */
export const FixtureUnlockSchema = z.object({
  cg: z.array(z.string()).default([]),
  music: z.array(z.string()).default([]),
  replay: z.array(z.string()).default([]),
  endings: z.array(z.string()).default([]),
});

export const FixturePersistentSchema = z.object({
  unlock: FixtureUnlockSchema,
});

/**
 * uiHint.screen 的合法取值（Spec 21 第 4 节）：
 * - "title"：挂载呈现标题画面；
 * - "story"：跳过标题门，直接呈现给定 state（panel 语义天然蕴含 story）。
 */
export const FIXTURE_UI_SCREENS = ["title", "story"] as const;

export const FixtureUiScreenSchema = z.enum(FIXTURE_UI_SCREENS);

/**
 * uiHint（Spec 17 步骤 5 + Spec 21 第 4 节扩展）：panel 与 screen 均可选，
 * 但至少声明其一。旧 fixture 只带 panel 时行为不变。
 */
export const FixtureUiHintSchema = z.object({
  panel: FixtureUiPanelSchema.optional(),
  screen: FixtureUiScreenSchema.optional(),
}).refine((hint) => hint.panel !== undefined || hint.screen !== undefined, {
  message: "uiHint 必须至少包含 panel 或 screen 之一",
});

export const FixtureFileSchema = z.object({
  title: z.string().optional(),
  state: NovelStateSchema,
  persistent: FixturePersistentSchema.optional(),
  uiHint: FixtureUiHintSchema.optional(),
});

// ──────────────────────────────────────────────
// 推断类型（与 schema.ts/types.ts 同一反推约定）
// ──────────────────────────────────────────────

export type FixtureNovelState = z.infer<typeof NovelStateSchema>;
export type FixtureUiPanel = z.infer<typeof FixtureUiPanelSchema>;
export type FixtureUiScreen = z.infer<typeof FixtureUiScreenSchema>;
export type FixtureUnlock = z.infer<typeof FixtureUnlockSchema>;
export type FixturePersistent = z.infer<typeof FixturePersistentSchema>;
export type FixtureUiHint = z.infer<typeof FixtureUiHintSchema>;
export type FixtureFile = z.infer<typeof FixtureFileSchema>;
