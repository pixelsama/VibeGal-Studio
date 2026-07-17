export interface NodeStoryPoint {
  /** 指令在节点数据中的下标，预览切片与下拉选项共用这个值。 */
  index: number;
  id: string;
  label: string;
}

export function collectNodeStoryPoints(nodeData: unknown): NodeStoryPoint[] {
  if (!Array.isArray(nodeData)) return [];
  return nodeData.flatMap((instruction, index) => {
    const obj = typeof instruction === "object" && instruction != null ? instruction as Record<string, unknown> : null;
    if (!obj || typeof obj.id !== "string" || !["say", "narrate", "wait", "pause"].includes(String(obj.t))) return [];
    const preview = typeof obj.text === "string" ? ` · ${obj.text.slice(0, 18)}` : "";
    return [{ index, id: obj.id, label: `#${index + 1} ${obj.id}${preview}` }];
  });
}

/** 从指定指令下标切片预览数据；null 或越界时按原样/边界处理。 */
export function sliceNodeDataFromIndex(nodeData: unknown, index: number | null): unknown {
  if (index == null || !Array.isArray(nodeData)) return nodeData;
  const clamped = Math.max(0, Math.min(Math.floor(index), nodeData.length));
  return nodeData.slice(clamped);
}
