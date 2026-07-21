import type { Manifest } from "../../lib/types";
import type { Instruction } from "@vibegal/engine";

export function endingsForNode(manifest: Manifest, nodeId: string) {
  return Object.entries(manifest.unlocks.endings).filter(([, ending]) => ending.nodeId === nodeId);
}

export function registerEnding(manifest: Manifest, input: { id: string; title: string; nodeId?: string }): Manifest {
  const id = input.id.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(id)) throw new Error("结局 ID 必须是稳定标识符");
  if (!input.title.trim()) throw new Error("结局标题不能为空");
  if (manifest.unlocks.endings[id]) throw new Error(`结局 ${id} 已存在`);
  return { ...manifest, unlocks: { ...manifest.unlocks, endings: { ...manifest.unlocks.endings, [id]: { title: input.title.trim(), ...(input.nodeId ? { nodeId: input.nodeId } : {}) } } } };
}

export function unregisterEnding(manifest: Manifest, id: string): Manifest {
  const endings = { ...manifest.unlocks.endings };
  delete endings[id];
  return { ...manifest, unlocks: { ...manifest.unlocks, endings } };
}

export function upsertEnding(manifest: Manifest, input: { id: string; title: string; nodeId?: string }): Manifest {
  const without = unregisterEnding(manifest, input.id);
  return registerEnding(without, input);
}

export function insertEndingCompletion(instructions: Instruction[], endingId: string, at: "start" | "end" = "end"): Instruction[] {
  const instruction = { t: "completeEnding", id: `complete_${endingId}`, endingId } as Instruction;
  if (instructions.some((item) => item.t === "completeEnding" && item.endingId === endingId)) return instructions;
  return at === "start" ? [instruction, ...instructions] : [...instructions, instruction];
}
