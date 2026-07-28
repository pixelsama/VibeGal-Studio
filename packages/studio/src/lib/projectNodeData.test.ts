import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectData } from "./types";

vi.mock("./tauri", () => ({
  readNodeDetail: vi.fn(),
  readProjectNodes: vi.fn(),
}));

import { readNodeDetail, readProjectNodes } from "./tauri";
import {
  clearProjectNodeCache,
  loadAllProjectNodes,
  loadNodeDetail,
} from "./projectNodeData";

const project = (path = "/project", mtimeMs = 1): ProjectData => ({
  path,
  meta: { name: "T", activeRendererId: "default", createdAt: "0" },
  content: {
    manifest: { characters: {}, backgrounds: {}, audio: { bgm: {}, sfx: {}, voice: {} } },
    meta: {},
    variables: { version: 1, variables: {} },
  },
  rendererIds: ["default"],
  graphRevision: { relPath: "content/graph.json", mtimeMs, size: 10 },
  nodeSummaries: [{
    id: "a",
    title: "A",
    relPath: "nodes/a.json",
    chapterId: "chapter_1",
    exists: true,
    incoming: 0,
    outgoing: 0,
    revision: { relPath: "content/nodes/a.json", mtimeMs, size: 2 },
  }],
});

beforeEach(() => {
  clearProjectNodeCache();
  vi.clearAllMocks();
});

describe("project node caches", () => {
  it("deduplicates full-node requests for the same revision and generation", async () => {
    vi.mocked(readProjectNodes).mockResolvedValue([{ relPath: "nodes/a.json", data: [] }]);

    const first = loadAllProjectNodes(project(), 2);
    const second = loadAllProjectNodes(project(), 2);

    expect(first).toBe(second);
    await first;
    expect(readProjectNodes).toHaveBeenCalledTimes(1);
  });

  it("invalidates full-node requests on revision and generation changes", async () => {
    vi.mocked(readProjectNodes).mockResolvedValue([]);

    await loadAllProjectNodes(project(), 0);
    await loadAllProjectNodes(project("/project", 2), 0);
    await loadAllProjectNodes(project("/project", 2), 1);

    expect(readProjectNodes).toHaveBeenCalledTimes(3);
  });

  it("deduplicates details but clears a project's entries explicitly", async () => {
    vi.mocked(readNodeDetail).mockResolvedValue({
      relPath: "nodes/a.json",
      data: [],
      text: "[]\n",
      revision: { relPath: "content/nodes/a.json", mtimeMs: 1, size: 2, sha256: "a".repeat(64) },
    });

    await Promise.all([
      loadNodeDetail(project(), "nodes/a.json", 0),
      loadNodeDetail(project(), "nodes/a.json", 0),
    ]);
    expect(readNodeDetail).toHaveBeenCalledTimes(1);

    clearProjectNodeCache("/project");
    await loadNodeDetail(project(), "nodes/a.json", 0);
    expect(readNodeDetail).toHaveBeenCalledTimes(2);
  });

  it("does not reuse details across project paths", async () => {
    vi.mocked(readNodeDetail).mockResolvedValue({
      relPath: "nodes/a.json",
      data: [],
      text: "[]\n",
      revision: { relPath: "content/nodes/a.json", mtimeMs: 1, size: 2 },
    });

    await loadNodeDetail(project("/one"), "nodes/a.json", 0);
    await loadNodeDetail(project("/two"), "nodes/a.json", 0);

    expect(readNodeDetail).toHaveBeenCalledTimes(2);
  });
});
