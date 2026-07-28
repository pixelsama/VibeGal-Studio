import { useEffect, useRef, useState } from "react";
import type { NodeDetail, NodeEntry, ProjectData } from "./types";
import { readNodeDetail, readProjectNodes } from "./tauri";

interface NodeDataState {
  entries: NodeEntry[];
  loading: boolean;
  error: string | null;
}

const MAX_NODE_DETAIL_CACHE_ENTRIES = 100;
const allNodesCache = new Map<string, Promise<NodeEntry[]>>();
const nodeDetailCache = new Map<string, Promise<NodeDetail>>();

export function clearProjectNodeCache(projectPath?: string) {
  if (!projectPath) {
    allNodesCache.clear();
    nodeDetailCache.clear();
    return;
  }
  const prefix = `${projectPath}\x00`;
  for (const key of allNodesCache.keys()) {
    if (key.startsWith(prefix)) allNodesCache.delete(key);
  }
  for (const key of nodeDetailCache.keys()) {
    if (key.startsWith(prefix)) nodeDetailCache.delete(key);
  }
}

function revisionToken(project: ProjectData): string {
  const revision = project.graphRevision;
  return revision?.sha256 ?? `${revision?.mtimeMs ?? "missing"}:${revision?.size ?? 0}`;
}

function fullCacheKey(project: ProjectData, generation: number): string {
  return `${project.path}\x00all\x00${revisionToken(project)}\x00${generation}`;
}

export function loadAllProjectNodes(project: ProjectData, generation = 0): Promise<NodeEntry[]> {
  if (project.nodes) return Promise.resolve(project.nodes);
  const key = fullCacheKey(project, generation);
  const cached = allNodesCache.get(key);
  if (cached) return cached;
  const request = readProjectNodes(project.path).catch((error) => {
    allNodesCache.delete(key);
    throw error;
  });
  allNodesCache.set(key, request);
  return request;
}

export function useAllProjectNodes(
  project: ProjectData,
  generation = 0,
  enabled = true,
): NodeDataState {
  const [state, setState] = useState<NodeDataState>(() => ({
    entries: project.nodes ?? [],
    loading: !project.nodes,
    error: null,
  }));
  const requestRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setState({ entries: project.nodes ?? [], loading: false, error: null });
      return;
    }
    if (project.nodes) {
      setState({ entries: project.nodes, loading: false, error: null });
      return;
    }
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setState((current) => ({ ...current, loading: true, error: null }));
    loadAllProjectNodes(project, generation)
      .then((entries) => {
        if (requestRef.current === requestId) setState({ entries, loading: false, error: null });
      })
      .catch((error) => {
        if (requestRef.current !== requestId) return;
        setState({ entries: [], loading: false, error: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      if (requestRef.current === requestId) requestRef.current += 1;
    };
  }, [enabled, generation, project]);

  return state;
}

function cacheNodeDetail(key: string, request: Promise<NodeDetail>) {
  nodeDetailCache.set(key, request);
  if (nodeDetailCache.size <= MAX_NODE_DETAIL_CACHE_ENTRIES) return;
  const oldest = nodeDetailCache.keys().next().value;
  if (oldest) nodeDetailCache.delete(oldest);
}

export function loadNodeDetail(
  project: ProjectData,
  relPath: string,
  generation = 0,
): Promise<NodeDetail> {
  const summary = project.nodeSummaries?.find((entry) => entry.relPath === relPath);
  const token = summary?.revision?.sha256
    ?? `${summary?.revision?.mtimeMs ?? "missing"}:${summary?.revision?.size ?? 0}`;
  const key = `${project.path}\x00${relPath}\x00${token}\x00${generation}`;
  const cached = nodeDetailCache.get(key);
  if (cached) return cached;
  const request = readNodeDetail(project.path, relPath).catch((error) => {
    nodeDetailCache.delete(key);
    throw error;
  });
  cacheNodeDetail(key, request);
  return request;
}

export function useNodeDetail(
  project: ProjectData,
  relPath: string | null,
  generation = 0,
): { detail: NodeDetail | null; loading: boolean; error: string | null } {
  const summary = project.nodeSummaries?.find((entry) => entry.relPath === relPath);
  const eager = relPath ? project.nodes?.find((entry) => entry.relPath === relPath) : undefined;
  const eagerRevision = relPath
    ? summary?.revision ?? project.nodeRevisions?.[relPath] ?? undefined
    : undefined;
  const [state, setState] = useState<{ detail: NodeDetail | null; loading: boolean; error: string | null }>({
    detail: eager?.data != null && eagerRevision
      ? { relPath: relPath!, data: eager.data, revision: eagerRevision }
      : null,
    loading: Boolean(relPath && eager?.data == null),
    error: null,
  });
  const requestRef = useRef(0);

  useEffect(() => {
    if (!relPath) {
      setState({ detail: null, loading: false, error: null });
      return;
    }
    if (eager?.data != null && eagerRevision) {
      setState({ detail: { relPath, data: eager.data, revision: eagerRevision }, loading: false, error: null });
      return;
    }
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setState({ detail: null, loading: true, error: null });
    const request = loadNodeDetail(project, relPath, generation);
    request.then((detail) => {
      if (requestRef.current === requestId) setState({ detail, loading: false, error: null });
    }).catch((error) => {
      if (requestRef.current !== requestId) return;
      setState({ detail: null, loading: false, error: error instanceof Error ? error.message : String(error) });
    });
    return () => {
      if (requestRef.current === requestId) requestRef.current += 1;
    };
  }, [eager?.data, eagerRevision, generation, project, relPath]);

  return state;
}
