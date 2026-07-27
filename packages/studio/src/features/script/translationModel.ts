import { InstructionSchema, type Instruction } from "@vibegal/engine";
import type { LocaleTable, NodeEntry, ProjectGraph } from "../../lib/types";

export interface TranslationSourceRow {
  nodeId: string;
  nodeTitle: string;
  chapterId: string;
  chapterTitle: string;
  instructionIndex: number;
  instructionId: string;
  kind: "say" | "narrate";
  speaker?: string;
  text: string;
  textKey?: string;
}

export interface TranslationReport {
  missingKeys: number;
  missingTranslations: number;
  orphanKeys: string[];
  defaultTextDrift: number;
}

export function collectTranslationRows(
  graph: ProjectGraph,
  entries: NodeEntry[] | undefined,
): TranslationSourceRow[] {
  const dataByPath = new Map((entries ?? []).map((entry) => [entry.relPath, entry.data]));
  const chapters = new Map(graph.chapters.map((chapter) => [chapter.id, chapter.title]));
  return graph.nodes.flatMap((node) => {
    const data = dataByPath.get(node.file);
    if (!Array.isArray(data)) return [];
    return data.flatMap((raw, instructionIndex) => {
      const parsed = InstructionSchema.safeParse(raw);
      if (!parsed.success || (parsed.data.t !== "say" && parsed.data.t !== "narrate")) return [];
      const instruction = parsed.data;
      return [{
        nodeId: node.id,
        nodeTitle: node.title || node.id,
        chapterId: node.chapterId,
        chapterTitle: chapters.get(node.chapterId) ?? node.chapterId,
        instructionIndex,
        instructionId: instruction.id ?? `index:${instructionIndex}`,
        kind: instruction.t,
        ...(instruction.t === "say" ? { speaker: instruction.who } : {}),
        text: instruction.text,
        textKey: instruction.textKey,
      }];
    });
  });
}

export function buildTranslationReport(
  rows: TranslationSourceRow[],
  targetTable: LocaleTable,
  defaultTable: LocaleTable,
): TranslationReport {
  const assignedKeys = new Set(rows.flatMap((row) => row.textKey ? [row.textKey] : []));
  return {
    missingKeys: rows.filter((row) => !row.textKey).length,
    missingTranslations: rows.filter((row) => row.textKey && !hasOwn(targetTable, row.textKey)).length,
    orphanKeys: Object.keys(targetTable).filter((key) => !assignedKeys.has(key)).sort(),
    defaultTextDrift: rows.filter((row) => (
      row.textKey && hasOwn(defaultTable, row.textKey) && defaultTable[row.textKey] !== row.text
    )).length,
  };
}

export function generateTranslationKey(row: TranslationSourceRow, usedKeys: ReadonlySet<string>): string {
  const base = `${keySegment(row.nodeId)}.${keySegment(row.instructionId.replace(/^index:/, "line-"))}`;
  if (!usedKeys.has(base)) return base;
  let suffix = 2;
  while (usedKeys.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export function assignInstructionTextKey(
  data: unknown,
  instructionIndex: number,
  textKey: string,
): Instruction[] | null {
  if (!Array.isArray(data) || instructionIndex < 0 || instructionIndex >= data.length) return null;
  if (data.some((raw) => !InstructionSchema.safeParse(raw).success)) return null;
  const instruction = data[instructionIndex];
  if (!isLocalizableInstruction(instruction)) return null;
  const instructions = data.map((raw) => ({ ...(raw as Instruction) }));
  instructions[instructionIndex] = { ...instruction, textKey };
  return instructions;
}

function isLocalizableInstruction(
  value: unknown,
): value is Extract<Instruction, { t: "say" | "narrate" }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const type = (value as { t?: unknown }).t;
  return type === "say" || type === "narrate";
}

function hasOwn(table: LocaleTable, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(table, key);
}

function keySegment(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "") || "line";
}
