import { useEffect, useMemo, useRef, useState } from "react";
import type { UIEvent } from "react";
import type { Manifest, NodeEntry, ProjectGraph } from "../../lib/types";
import { findNodeData } from "./graphMapping";
import { searchProject } from "./projectSearch";
import { fixedListWindow } from "../common/virtualWindow";

interface NodeOutlineProps {
  graph: ProjectGraph;
  nodeEntries?: NodeEntry[];
  manifest?: Manifest;
  selectedNodeId: string | null;
  onSelect: (id: string) => void;
  onSelectEdge?: (id: string) => void;
}

export function NodeOutline({ graph, nodeEntries, manifest, selectedNodeId, onSelect, onSelectEdge }: NodeOutlineProps) {
  const [query, setQuery] = useState("");
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 480 });
  const listRef = useRef<HTMLDivElement | null>(null);
  const orderedNodes = useMemo(() => {
    const entry = graph.nodes.find((node) => node.id === graph.entryNodeId);
    const rest = graph.nodes.filter((node) => node.id !== graph.entryNodeId);
    const ordered = entry ? [entry, ...rest] : rest;
    const normalized = query.trim().toLowerCase();
    if (!normalized) return ordered;
    return ordered.filter((node) => {
      const haystack = `${node.title}\n${node.id}\n${node.file}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [graph.entryNodeId, graph.nodes, query]);
  const searchResults = useMemo(
    () => searchProject({ graph, nodeEntries, manifest }, query),
    [graph, manifest, nodeEntries, query],
  );
  const showingProjectSearch = query.trim().length > 0;
  const listItems = showingProjectSearch ? searchResults : orderedNodes;
  const rowHeight = showingProjectSearch ? 112 : 108;
  const window = fixedListWindow(listItems.length, viewport.scrollTop, viewport.height, rowHeight);
  const windowedItems = listItems.slice(window.start, window.end);

  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const update = () => setViewport((current) => ({ ...current, height: list.clientHeight || current.height }));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (showingProjectSearch || !selectedNodeId) return;
    const index = orderedNodes.findIndex((node) => node.id === selectedNodeId);
    const list = listRef.current;
    if (index < 0 || !list) return;
    const top = index * 108;
    if (top < list.scrollTop || top + 108 > list.scrollTop + list.clientHeight) {
      list.scrollTo({ top: Math.max(0, top - list.clientHeight / 2), behavior: "smooth" });
    }
  }, [orderedNodes, selectedNodeId, showingProjectSearch]);

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const scrollTop = event.currentTarget.scrollTop;
    setViewport((current) => current.scrollTop === scrollTop ? current : { ...current, scrollTop });
  };

  return (
    <div style={panelStyle}>
      <div style={toolbarStyle}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索节点 / id"
          style={searchInputStyle}
        />
      </div>
      <div
        ref={listRef}
        role="listbox"
        aria-label={showingProjectSearch ? "项目搜索结果" : "节点列表"}
        style={listStyle}
        onScroll={handleScroll}
      >
        <div aria-hidden="true" style={{ height: window.paddingTop, flexShrink: 0 }} />
        {showingProjectSearch ? (
          searchResults.length === 0 ? (
            <div style={emptyStyle}>没有匹配的结果</div>
          ) : (
            windowedItems.map((item, visibleIndex) => {
              const result = item as (typeof searchResults)[number];
              const index = window.start + visibleIndex;
              return (
              <button
                key={`${result.kind}-${index}`}
                type="button"
                role="option"
                aria-posinset={index + 1}
                aria-setsize={searchResults.length}
                onClick={() => {
                  if (result.kind === "edge") {
                    onSelectEdge?.(result.edgeId);
                    return;
                  }
                  if ("nodeId" in result && result.nodeId) onSelect(result.nodeId);
                }}
                style={{ ...itemStyle, height: rowHeight - 8, flexShrink: 0 }}
              >
                <div style={itemHeaderStyle}>
                  <span style={itemTitleStyle}>{result.label}</span>
                  <span style={entryBadgeStyle}>{searchKindLabel(result.kind)}</span>
                </div>
                <div style={itemMetaStyle}>{result.preview}</div>
                <div style={itemMetaStyle}>
                  {result.kind === "manifest" ? result.manifestPath : result.file}
                </div>
              </button>
              );
            })
          )
        ) : orderedNodes.length === 0 ? (
          <div style={emptyStyle}>{query.trim() ? "没有匹配的节点" : "暂无节点"}</div>
        ) : (
          windowedItems.map((item, visibleIndex) => {
            const node = item as (typeof orderedNodes)[number];
            const index = window.start + visibleIndex;
            const hasContent = findNodeData(nodeEntries, node.file) != null;
            const active = node.id === selectedNodeId;

            return (
              <button
                key={node.id}
                type="button"
                role="option"
                aria-selected={active}
                aria-posinset={index + 1}
                aria-setsize={orderedNodes.length}
                onClick={() => onSelect(node.id)}
                style={{
                  ...itemStyle,
                  height: rowHeight - 8,
                  flexShrink: 0,
                  borderColor: active ? "var(--accent)" : "var(--border)",
                  background: active ? "var(--bg-active)" : "var(--bg-panel)",
                }}
              >
                <div style={itemHeaderStyle}>
                  <span style={itemTitleStyle}>{node.title}</span>
                  {node.id === graph.entryNodeId && <span style={entryBadgeStyle}>起点</span>}
                </div>
                <div style={itemMetaStyle}>{node.file}</div>
                <div style={statusRowStyle}>
                  <span style={{ ...statusDotStyle, background: hasContent ? "var(--status-ok)" : "var(--status-warn)" }} />
                  <span style={{ color: hasContent ? "var(--status-ok-text)" : "var(--status-warn-text)" }}>
                    {hasContent ? "已有内容" : "文件缺失"}
                  </span>
                </div>
              </button>
            );
          })
        )}
        <div aria-hidden="true" style={{ height: window.paddingBottom, flexShrink: 0 }} />
      </div>
    </div>
  );
}

function searchKindLabel(kind: "node" | "instruction" | "edge" | "manifest"): string {
  switch (kind) {
    case "node":
      return "节点";
    case "instruction":
      return "指令";
    case "edge":
      return "边";
    case "manifest":
      return "资源";
  }
}

const panelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  background: "transparent",
};

const listStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
  padding: "var(--space-3)",
  overflowY: "auto",
  minHeight: 0,
  flex: 1,
};

const toolbarStyle: React.CSSProperties = {
  padding: "var(--space-3) var(--space-3) 0",
};

const searchInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "var(--space-2)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "var(--bg-panel)",
  color: "var(--text-primary)",
};

const itemStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: "var(--space-2)",
  padding: "var(--space-3)",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  boxSizing: "border-box",
  overflow: "hidden",
  cursor: "pointer",
  color: "var(--text-primary)",
  textAlign: "left",
};

const itemHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-2)",
};

const itemTitleStyle: React.CSSProperties = {
  fontSize: "var(--text-base)",
  fontWeight: 600,
  color: "var(--text-bright)",
};

const entryBadgeStyle: React.CSSProperties = {
  padding: "2px var(--space-2)",
  borderRadius: "var(--radius-pill)",
  background: "var(--bg-accent-soft)",
  color: "var(--accent-bright)",
  fontSize: "var(--text-xs)",
  flexShrink: 0,
};

const itemMetaStyle: React.CSSProperties = {
  fontSize: "var(--text-xs)",
  color: "var(--text-muted)",
  wordBreak: "break-all",
};

const statusRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  fontSize: "var(--text-sm)",
};

const statusDotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: "var(--radius-pill)",
  flexShrink: 0,
};

const emptyStyle: React.CSSProperties = {
  padding: "var(--space-2) var(--space-1)",
  color: "var(--text-muted)",
  fontSize: "var(--text-base)",
};
