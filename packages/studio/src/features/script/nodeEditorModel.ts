import {
  formatScenarioText,
  type Instruction,
} from "@vibegal/engine";

export type NodeEditorMode = "scenario" | "json" | "blocks";

export function isWriteConflictError(error: unknown): boolean {
  if (error instanceof Error) return isWriteConflictError(error.message);
  if (typeof error === "string") {
    if (error.includes("write_conflict")) return true;
    try {
      const parsed = JSON.parse(error) as { code?: string };
      return parsed.code === "write_conflict";
    } catch {
      return false;
    }
  }
  return typeof error === "object" && error != null && (error as { code?: string }).code === "write_conflict";
}

export function nodeEditorKeepsDraftOnWriteConflict<T extends { text: string; instructions: Instruction[] }>(
  draft: T,
  error: unknown,
): { conflict: boolean; draft: T | null } {
  return isWriteConflictError(error)
    ? { conflict: true, draft }
    : { conflict: false, draft: null };
}

export function conflictDraftCopyPath(nodeFile: string, stamp: number): string {
  return nodeFile.replace(/\.json$/, `.conflict-${stamp}.json`);
}

export function transitionNodeEditorMode({
  mode,
  text,
  instructions,
}: {
  mode: NodeEditorMode;
  text: string;
  instructions: Instruction[];
}): {
  mode: NodeEditorMode;
  text: string;
  instructions: Instruction[];
  error: string | null;
} {
  if (mode === "json") {
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        return { mode, text, instructions, error: "切换失败：节点内容必须是 JSON 数组。" };
      }
      return {
        mode: "blocks",
        text: JSON.stringify(parsed, null, 2),
        instructions: parsed as Instruction[],
        error: null,
      };
    } catch (error) {
      return {
        mode,
        text,
        instructions,
        error: `切换失败：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return {
    mode: "json",
    text: JSON.stringify(instructions, null, 2),
    instructions,
    error: null,
  };
}

export function serializeNodeData(nodeData: unknown | null): string {
  return nodeData == null ? "[]" : JSON.stringify(nodeData, null, 2);
}

export function instructionsFromNodeData(nodeData: unknown | null): Instruction[] {
  return Array.isArray(nodeData) ? (nodeData as Instruction[]) : [];
}

export function scenarioTextFromNodeData(nodeData: unknown | null): string {
  return formatScenarioText(instructionsFromNodeData(nodeData));
}

export function parseJsonInstructionText(text: string): { ok: true; instructions: Instruction[] } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return { ok: false, error: "节点内容必须是 JSON 数组。" };
    return { ok: true, instructions: parsed as Instruction[] };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
