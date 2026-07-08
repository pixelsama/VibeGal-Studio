export function collectNodeStoryPoints(nodeData: unknown): { id: string; label: string }[] {
  if (!Array.isArray(nodeData)) return [];
  return nodeData.flatMap((instruction, index) => {
    const obj = typeof instruction === "object" && instruction != null ? instruction as Record<string, unknown> : null;
    if (!obj || typeof obj.id !== "string" || !["say", "narrate", "wait", "pause"].includes(String(obj.t))) return [];
    const preview = typeof obj.text === "string" ? ` · ${obj.text.slice(0, 18)}` : "";
    return [{ id: obj.id, label: `#${index + 1} ${obj.id}${preview}` }];
  });
}

export function sliceNodeDataFromStoryPoint(nodeData: unknown, instructionId: string | null): unknown {
  if (!instructionId || !Array.isArray(nodeData)) return nodeData;
  const index = nodeData.findIndex((instruction) => {
    const obj = typeof instruction === "object" && instruction != null ? instruction as Record<string, unknown> : null;
    return obj?.id === instructionId;
  });
  return index >= 0 ? nodeData.slice(index) : nodeData;
}
