import type { Instruction } from "@vibegal/engine";
import type { Manifest, NodeCreatorSummary, NodeEntry } from "../../lib/types";
import { translateZhCN, type StudioTranslator } from "../../lib/i18n";

export function creatorNodeSummary(
  nodeId: string,
  file: string,
  nodeEntries?: NodeEntry[],
  manifest?: Manifest,
  nodeSummaries?: NodeCreatorSummary[],
  t: StudioTranslator = translateZhCN,
): string[] {
  const entry = nodeEntries?.find((candidate) => candidate.relPath === file);
  const hasEntryData = entry != null && Array.isArray(entry.data);
  const instructions = hasEntryData ? entry.data as Instruction[] : [];
  const summary = nodeSummaries?.find((candidate) => candidate.relPath === file);
  const sayCount = hasEntryData
    ? instructions.filter((instruction) => instruction.t === "say").length
    : summary?.sayCount ?? 0;
  const changesState = hasEntryData
    ? instructions.some((instruction) => instruction.t === "set")
    : summary?.changesState ?? false;
  const isFormalEnding = Object.values(manifest?.unlocks?.endings ?? {})
    .some((ending) => ending.nodeId === nodeId);

  return [
    ...(sayCount > 0 ? [t("script.graph.summary.dialogueCount", { count: sayCount })] : []),
    ...(changesState ? [t("script.graph.summary.changesState")] : []),
    ...(isFormalEnding ? [t("script.graph.summary.formalEnding")] : []),
  ];
}
