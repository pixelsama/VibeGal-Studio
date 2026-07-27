import type { Instruction, VariableRegistry } from "@vibegal/engine";
import type { Manifest, NodeEntry, ProjectGraph } from "../../lib/types";
import { describeCondition } from "./ConditionEditor";
import { collectStateSources } from "./storyState";

export function creatorEdgeLabel(
  edge: { mode?: string; label?: string | null; condition?: string | null },
  options: { graph: ProjectGraph; variables?: VariableRegistry; manifest?: Manifest },
): string | undefined {
  const mode = edge.mode ?? "linear";
  if (mode === "choice") return edge.label?.trim() || "选项";
  if (mode !== "auto") return undefined;

  const condition = edge.condition?.trim() ?? "";
  if (!condition) return "否则";
  const sources = collectStateSources({
    registry: options.variables,
    graph: options.graph,
    manifest: options.manifest,
  });
  return describeCondition(condition, sources);
}

export function creatorNodeSummary(
  nodeId: string,
  file: string,
  nodeEntries?: NodeEntry[],
  manifest?: Manifest,
): string[] {
  const entry = nodeEntries?.find((candidate) => candidate.relPath === file);
  const hasEntryData = entry != null && Array.isArray(entry.data);
  const instructions = hasEntryData ? entry.data as Instruction[] : [];
  const sayCount = instructions.filter((instruction) => instruction.t === "say").length;
  const changesState = instructions.some((instruction) => instruction.t === "set");
  const isFormalEnding = hasEntryData && Object.values(manifest?.unlocks?.endings ?? {})
    .some((ending) => ending.nodeId === nodeId);

  return [
    ...(sayCount > 0 ? [`${sayCount} 句台词`] : []),
    ...(changesState ? ["改变故事状态"] : []),
    ...(isFormalEnding ? ["正式结局"] : []),
  ];
}
