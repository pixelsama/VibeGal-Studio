/**
 * 类型层全部从 Zod schema 反推 —— 这是数据契约的【消费者侧】。
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
  ChoiceInstruction,
  WaitInstruction,
  EffectInstruction,
  TransitionInstruction,
  ProjectGraphSchema,
  GraphNodeSchema,
  GraphEdgeSchema,
  GraphPositionSchema,
} from "./schema";

export type Instruction = z.infer<typeof InstructionSchema>;
export type Chapter = z.infer<typeof ChapterSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;
export type Meta = z.infer<typeof MetaSchema>;

// Phase 11：脚本图结构类型（供外部工具/Agent 校验）
export type GraphPosition = z.infer<typeof GraphPositionSchema>;
export type GraphNodeData = z.infer<typeof GraphNodeSchema>;
export type GraphEdgeData = z.infer<typeof GraphEdgeSchema>;
export type ProjectGraphData = z.infer<typeof ProjectGraphSchema>;

// 便于在 interpreter 的 switch 里精确收窄
export type BgInstr = z.infer<typeof BgInstruction>;
export type BgmInstr = z.infer<typeof BgmInstruction>;
export type SfxInstr = z.infer<typeof SfxInstruction>;
export type VoiceInstr = z.infer<typeof VoiceInstruction>;
export type CharInstr = z.infer<typeof CharInstruction>;
export type SayInstr = z.infer<typeof SayInstruction>;
export type NarrateInstr = z.infer<typeof NarrateInstruction>;
export type ChoiceInstr = z.infer<typeof ChoiceInstruction>;
export type WaitInstr = z.infer<typeof WaitInstruction>;
export type EffectInstr = z.infer<typeof EffectInstruction>;
export type TransitionInstr = z.infer<typeof TransitionInstruction>;

// 运行时指令的判别 tag
export type InstructionType = Instruction["t"];
