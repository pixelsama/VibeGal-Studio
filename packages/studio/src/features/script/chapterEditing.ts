import type { GraphChapter, ProjectGraph } from "../../lib/types";

export type ChapterScope =
  | { kind: "all" }
  | { kind: "chapter"; chapterId: string }
  | { kind: "unassigned" };

export function addChapter(graph: ProjectGraph, chapter: GraphChapter): ProjectGraph {
  if ((graph.chapters ?? []).some((candidate) => candidate.id === chapter.id)) return graph;
  return { ...graph, chapters: [...(graph.chapters ?? []), chapter] };
}

export function renameChapter(graph: ProjectGraph, chapterId: string, title: string): ProjectGraph {
  const chapters = graph.chapters ?? [];
  if (!chapters.some((chapter) => chapter.id === chapterId)) return graph;
  return {
    ...graph,
    chapters: chapters.map((chapter) => chapter.id === chapterId ? { ...chapter, title } : chapter),
  };
}

export function moveChapter(graph: ProjectGraph, chapterId: string, offset: -1 | 1): ProjectGraph {
  const chapters = graph.chapters ?? [];
  const from = chapters.findIndex((chapter) => chapter.id === chapterId);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= chapters.length) return graph;
  const next = [...chapters];
  [next[from], next[to]] = [next[to], next[from]];
  return { ...graph, chapters: next };
}

export function deleteChapter(graph: ProjectGraph, chapterId: string): ProjectGraph {
  const chapters = graph.chapters ?? [];
  if (!chapters.some((chapter) => chapter.id === chapterId)) return graph;
  return {
    ...graph,
    chapters: chapters.filter((chapter) => chapter.id !== chapterId),
    nodes: graph.nodes.map((node) => {
      if (node.chapterId !== chapterId) return node;
      const { chapterId: _removed, ...unassigned } = node;
      return unassigned;
    }),
  };
}

export function setNodeChapter(graph: ProjectGraph, nodeId: string, chapterId: string | null): ProjectGraph {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node || node.chapterId === (chapterId ?? undefined)) return graph;
  if (chapterId && !(graph.chapters ?? []).some((chapter) => chapter.id === chapterId)) return graph;
  return {
    ...graph,
    nodes: graph.nodes.map((candidate) => {
      if (candidate.id !== nodeId) return candidate;
      if (chapterId) return { ...candidate, chapterId };
      const { chapterId: _removed, ...unassigned } = candidate;
      return unassigned;
    }),
  };
}

export function generateChapterId(graph: ProjectGraph, base = "chapter"): string {
  const normalized = base.trim().toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "chapter";
  const used = new Set((graph.chapters ?? []).map((chapter) => chapter.id));
  if (!used.has(normalized)) return normalized;
  let suffix = 2;
  while (used.has(`${normalized}_${suffix}`)) suffix += 1;
  return `${normalized}_${suffix}`;
}

export function nodeIdsForChapterScope(graph: ProjectGraph, scope: ChapterScope): Set<string> {
  return new Set(graph.nodes
    .filter((node) => scope.kind === "all"
      || (scope.kind === "unassigned" ? !node.chapterId : node.chapterId === scope.chapterId))
    .map((node) => node.id));
}

export function graphForChapterScope(graph: ProjectGraph, scope: ChapterScope): ProjectGraph {
  if (scope.kind === "all") return graph;
  const visible = nodeIdsForChapterScope(graph, scope);
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => visible.has(node.id)),
    edges: graph.edges.filter((edge) => visible.has(edge.from) && visible.has(edge.to)),
  };
}

export function chapterScopeForNode(graph: ProjectGraph, nodeId: string): ChapterScope {
  const chapterId = graph.nodes.find((node) => node.id === nodeId)?.chapterId;
  return chapterId ? { kind: "chapter", chapterId } : { kind: "unassigned" };
}

export function isNodeInChapterScope(graph: ProjectGraph, nodeId: string, scope: ChapterScope): boolean {
  return nodeIdsForChapterScope(graph, scope).has(nodeId);
}

export function normalizeChapterScope(graph: ProjectGraph, scope: ChapterScope): ChapterScope {
  if (scope.kind !== "chapter") return scope;
  return (graph.chapters ?? []).some((chapter) => chapter.id === scope.chapterId)
    ? scope
    : { kind: "all" };
}
