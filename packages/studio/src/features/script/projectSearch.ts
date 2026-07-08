import type { Manifest, NodeEntry, ProjectGraph } from "../../lib/types";

export type ProjectSearchResult =
  | {
    kind: "node";
    nodeId: string;
    file: string;
    label: string;
    preview: string;
  }
  | {
    kind: "instruction";
    nodeId: string;
    file: string;
    instructionIndex: number;
    instructionId?: string;
    label: string;
    preview: string;
  }
  | {
    kind: "edge";
    edgeId: string;
    nodeId: string;
    file: "content/graph.json";
    jsonPath: string;
    label: string;
    preview: string;
  }
  | {
    kind: "manifest";
    manifestPath: string;
    file: "content/manifest.json";
    nodeId?: string;
    label: string;
    preview: string;
  };

export interface ProjectSearchInput {
  graph?: ProjectGraph;
  nodeEntries?: NodeEntry[];
  manifest?: Manifest;
}

export function searchProject(input: ProjectSearchInput, query: string): ProjectSearchResult[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const graph = input.graph;
  const nodeByFile = new Map(graph?.nodes.map((node) => [node.file, node]) ?? []);
  const results: ProjectSearchResult[] = [];

  graph?.nodes.forEach((node) => {
    addIfMatches(results, normalized, [node.id, node.title, node.file], {
      kind: "node",
      nodeId: node.id,
      file: `content/${node.file}`,
      label: node.title || node.id,
      preview: `${node.id} ${node.title} ${node.file}`,
    });
  });

  input.nodeEntries?.forEach((entry) => {
    const node = nodeByFile.get(entry.relPath);
    if (!node || !Array.isArray(entry.data)) return;
    entry.data.forEach((instruction, instructionIndex) => {
      const obj = objectRecord(instruction);
      if (!obj) return;
      const instructionId = hasStableStoryPointId(obj) ? obj.id as string : undefined;
      addIfMatches(results, normalized, instructionSearchFields(obj), {
        kind: "instruction",
        nodeId: node.id,
        file: `content/${node.file}`,
        instructionIndex,
        instructionId,
        label: `${node.title || node.id} #${instructionIndex + 1}`,
        preview: instructionPreview(obj),
      });
    });
  });

  graph?.edges.forEach((edge, index) => {
    addIfMatches(results, normalized, [
      edge.id,
      edge.from,
      edge.to,
      edge.mode ?? "linear",
      edge.label ?? "",
      edge.condition ?? "",
    ], {
      kind: "edge",
      edgeId: edge.id,
      nodeId: edge.from,
      file: "content/graph.json",
      jsonPath: `$.edges[${index}]`,
      label: edge.label || edge.id,
      preview: `${edge.from} -> ${edge.to} ${edge.condition ?? ""}`,
    });
  });

  if (input.manifest) {
    collectManifestSearchRows(input.manifest).forEach((row) => {
      addIfMatches(results, normalized, row.fields, {
        kind: "manifest",
        manifestPath: row.path,
        file: "content/manifest.json",
        nodeId: row.nodeId,
        label: row.label,
        preview: row.fields.filter(Boolean).join(" "),
      });
    });
  }

  return dedupeResults(results);
}

function hasStableStoryPointId(instruction: Record<string, unknown>): boolean {
  return (
    (instruction.t === "say" || instruction.t === "narrate" || instruction.t === "wait" || instruction.t === "pause") &&
    typeof instruction.id === "string"
  );
}

function addIfMatches<T extends ProjectSearchResult>(
  results: ProjectSearchResult[],
  query: string,
  fields: unknown[],
  result: T,
) {
  if (fields.some((field) => String(field ?? "").toLowerCase().includes(query))) {
    results.push(result);
  }
}

function instructionSearchFields(instruction: Record<string, unknown>): unknown[] {
  const fields: unknown[] = [instruction.t];
  for (const key of ["id", "text", "who", "expr", "key", "value", "kind"]) {
    fields.push(instruction[key]);
  }
  return fields;
}

function instructionPreview(instruction: Record<string, unknown>): string {
  if (instruction.t === "say") return `${instruction.who ?? ""}: ${instruction.text ?? ""}`;
  if (instruction.t === "narrate") return String(instruction.text ?? "");
  if (instruction.t === "set") return `set ${instruction.key ?? ""} = ${String(instruction.value ?? "")}`;
  if (instruction.t === "unlock") return `unlock ${instruction.kind ?? ""} ${instruction.id ?? ""}`;
  return Object.entries(instruction).map(([key, value]) => `${key}:${String(value)}`).join(" ");
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value != null ? value as Record<string, unknown> : null;
}

interface ManifestSearchRow {
  path: string;
  label: string;
  nodeId?: string;
  fields: unknown[];
}

function collectManifestSearchRows(manifest: Manifest): ManifestSearchRow[] {
  const rows: ManifestSearchRow[] = [];
  Object.entries(manifest.characters ?? {}).forEach(([id, character]) => {
    rows.push({ path: `characters.${id}`, label: character.name || id, fields: [id, character.name, character.color] });
    Object.entries(character.sprites ?? {}).forEach(([expr, path]) => {
      rows.push({ path: `characters.${id}.sprites.${expr}`, label: `${id}.${expr}`, fields: [id, expr, path] });
    });
  });
  Object.entries(manifest.backgrounds ?? {}).forEach(([id, path]) => {
    rows.push({ path: `backgrounds.${id}`, label: id, fields: [id, path] });
  });
  for (const section of ["bgm", "sfx", "voice"] as const) {
    Object.entries(manifest.audio?.[section] ?? {}).forEach(([id, path]) => {
      rows.push({ path: `audio.${section}.${id}`, label: id, fields: [id, path, section] });
    });
  }
  Object.entries(manifest.cg ?? {}).forEach(([id, asset]) => {
    rows.push({ path: `cg.${id}`, label: asset.name || id, fields: [id, asset.path, asset.name, asset.tags?.join(" "), asset.unlockId] });
  });
  Object.entries(manifest.videos ?? {}).forEach(([id, asset]) => {
    rows.push({ path: `videos.${id}`, label: asset.name || id, fields: [id, asset.path, asset.name, asset.tags?.join(" "), asset.poster] });
  });
  Object.entries(manifest.fonts ?? {}).forEach(([id, font]) => {
    rows.push({ path: `fonts.${id}`, label: font.family || id, fields: [id, font.path, font.family, font.weight, font.style] });
  });
  Object.entries(manifest.uiSkins ?? {}).forEach(([id, skin]) => {
    rows.push({ path: `uiSkins.${id}`, label: skin.name || id, fields: [id, skin.name, ...Object.values(skin.assets ?? {})] });
  });
  Object.entries(manifest.animationAtlases ?? {}).forEach(([id, atlas]) => {
    rows.push({ path: `animationAtlases.${id}`, label: id, fields: [id, atlas.image, atlas.json] });
  });
  Object.entries(manifest.unlocks?.cg ?? {}).forEach(([id, unlock]) => {
    rows.push({ path: `unlocks.cg.${id}`, label: unlock.title || id, fields: [id, unlock.assetId, unlock.title] });
  });
  Object.entries(manifest.unlocks?.music ?? {}).forEach(([id, unlock]) => {
    rows.push({ path: `unlocks.music.${id}`, label: unlock.title || id, fields: [id, unlock.audioId, unlock.title] });
  });
  Object.entries(manifest.unlocks?.replay ?? {}).forEach(([id, unlock]) => {
    rows.push({ path: `unlocks.replay.${id}`, label: unlock.title || id, nodeId: unlock.nodeId, fields: [id, unlock.nodeId, unlock.title] });
  });
  Object.entries(manifest.unlocks?.endings ?? {}).forEach(([id, unlock]) => {
    rows.push({ path: `unlocks.endings.${id}`, label: unlock.title || id, nodeId: unlock.nodeId, fields: [id, unlock.nodeId, unlock.title] });
  });
  return rows;
}

function dedupeResults(results: ProjectSearchResult[]): ProjectSearchResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = JSON.stringify(result);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
