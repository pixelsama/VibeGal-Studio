import {
  formatScenarioText,
  type Instruction,
} from "@vibegal/engine";

import type { FileRevision } from "../../lib/types";

export type NodeEditorMode = "scenario" | "json";

export function sameFileRevision(
  left: FileRevision | null | undefined,
  right: FileRevision | null | undefined,
): boolean {
  if (!left || !right) return left == null && right == null;
  if (left.relPath !== right.relPath || left.size !== right.size) return false;
  if (left.sha256 && right.sha256) return left.sha256 === right.sha256;
  return Math.abs(left.mtimeMs - right.mtimeMs) < 0.001;
}

/**
 * 外部改动检测（Spec 33 §6.1）：项目刷新带回来的 revision 是否与本地
 * 已加载/刚保存的基准不同——**必须按值比较**。
 *
 * FileRevision 是对象；openProject / save 的每次 IPC 都返回新实例，
 * 引用比较（===）会把「自己的保存+刷新往返」甚至「无关文件触发的
 * watcher 刷新」误判为外部改动（曾致资产页撤销栈被反复清空、
 * 设置页外部改动覆盖分支失效）。
 *
 * 基准为 undefined（尚未建立基准）时不视为外部改动。
 */
export function isExternalRevisionChange(
  loadedRevision: FileRevision | null | undefined,
  incomingRevision: FileRevision | null | undefined,
): boolean {
  if (loadedRevision === undefined) return false;
  return !sameFileRevision(loadedRevision, incomingRevision);
}

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
