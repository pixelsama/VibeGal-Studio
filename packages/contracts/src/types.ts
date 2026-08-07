/**
 * 类型层全部从 @vibegal/contracts 的 Zod schema 反推 —— 这是数据契约的【消费者侧】。
 * 不要在这里手写 interface 重复定义结构，否则会和 schema 漂移。
 * 以后的小工具 import 这些类型即可获得对剧本数据的完整静态提示。
 */
import type { z } from "zod";
import type {
  InstructionSchema,
  ChapterSchema,
  ManifestSchema,
  MetaSchema,
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
  ChoiceInstruction,
  ChoiceOptionSchema,
  IfInstruction,
  VariableRegistrySchema,
  VariableDeclarationSchema,
  VariableKindSchema,
  VariableBandSchema,
  VariableOptionSchema,
  ProjectGraphSchema,
  GraphChapterSchema,
  GraphNodeSchema,
  GraphEdgeSchema,
  GraphPositionSchema,
  LocaleConfigSchema,
  LocaleTableSchema,
  DistributionConfigSchema,
  DistributionViewportSchema,
  DistributionUpdatesSchema,
  ChapterCheckpointSchema,
  AnimationAtlasClipSchema,
  CharacterSpriteRefSchema,
} from "./schema";

export type Instruction = z.infer<typeof InstructionSchema>;
export type Chapter = z.infer<typeof ChapterSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;
export type Meta = z.infer<typeof MetaSchema>;

// Phase 11：脚本图结构类型（供外部工具/Agent 校验）
export type GraphPosition = z.infer<typeof GraphPositionSchema>;
export type GraphNodeData = z.infer<typeof GraphNodeSchema>;
export type GraphChapterData = z.infer<typeof GraphChapterSchema>;
export type GraphEdgeData = z.infer<typeof GraphEdgeSchema>;
export type ProjectGraphData = z.infer<typeof ProjectGraphSchema>;
export type VariableRegistry = z.infer<typeof VariableRegistrySchema>;
export type VariableDeclaration = z.infer<typeof VariableDeclarationSchema>;
export type VariableKind = z.infer<typeof VariableKindSchema>;
export type VariableBand = z.infer<typeof VariableBandSchema>;
export type VariableOption = z.infer<typeof VariableOptionSchema>;
export type LocaleConfig = z.infer<typeof LocaleConfigSchema>;
export type LocaleTable = z.infer<typeof LocaleTableSchema>;
export type DistributionConfig = z.infer<typeof DistributionConfigSchema>;
export type DistributionViewport = z.infer<typeof DistributionViewportSchema>;
export type DistributionUpdates = z.infer<typeof DistributionUpdatesSchema>;
export type ChapterCheckpoint = z.infer<typeof ChapterCheckpointSchema>;
export type AnimationAtlasClip = z.infer<typeof AnimationAtlasClipSchema>;
export type CharacterSpriteRef = z.infer<typeof CharacterSpriteRefSchema>;

// 便于在 interpreter 的 switch 里精确收窄
export type BgInstr = z.infer<typeof BgInstruction>;
export type BgmInstr = z.infer<typeof BgmInstruction>;
export type SfxInstr = z.infer<typeof SfxInstruction>;
export type VoiceInstr = z.infer<typeof VoiceInstruction>;
export type CharInstr = z.infer<typeof CharInstruction>;
export type SayInstr = z.infer<typeof SayInstruction>;
export type NarrateInstr = z.infer<typeof NarrateInstruction>;
export type SetInstr = z.infer<typeof SetInstruction>;
export type WaitInstr = z.infer<typeof WaitInstruction>;
export type EffectInstr = z.infer<typeof EffectInstruction>;
export type TransitionInstr = z.infer<typeof TransitionInstruction>;
export type PauseInstr = z.infer<typeof PauseInstruction>;
export type InputNameInstr = z.infer<typeof InputNameInstruction>;
export type UnlockInstr = z.infer<typeof UnlockInstruction>;
export type ShowCgInstr = z.infer<typeof ShowCgInstruction>;
export type PlayVideoInstr = z.infer<typeof PlayVideoInstruction>;
export type CompleteEndingInstr = z.infer<typeof CompleteEndingInstruction>;
export type ChoiceOption = z.infer<typeof ChoiceOptionSchema>;
export type ChoiceInstr = z.infer<typeof ChoiceInstruction>;
export type IfInstr = z.infer<typeof IfInstruction>;

// 运行时指令的判别 tag
export type InstructionType = Instruction["t"];
