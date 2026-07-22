import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { Manifest, NodeEntry, ProjectGraph } from "../../lib/types";
import type { ChapterScope } from "./chapterEditing";
import { searchProject } from "./projectSearch";

interface StoryOutlineProps {
  graph: ProjectGraph;
  nodeEntries?: NodeEntry[];
  manifest?: Manifest;
  scope: ChapterScope;
  selectedNodeId: string | null;
  onScopeChange: (scope: ChapterScope) => void;
  onSelectNode: (nodeId: string) => void;
  onSelectEdge?: (edgeId: string) => void;
  onCreateChapter: () => void;
  onRenameChapter: (chapterId: string) => void;
  onMoveChapter: (chapterId: string, offset: -1 | 1) => void;
  onDeleteChapter: (chapterId: string) => void;
}

export function StoryOutline({
  graph,
  nodeEntries,
  manifest,
  scope,
  selectedNodeId,
  onScopeChange,
  onSelectNode,
  onSelectEdge,
  onCreateChapter,
  onRenameChapter,
  onMoveChapter,
  onDeleteChapter,
}: StoryOutlineProps) {
  const [query, setQuery] = useState("");
  const chapters = graph.chapters ?? [];
  const unassigned = graph.nodes.filter((node) => !node.chapterId);
  const visibleNodes = graph.nodes.filter((node) => {
    if (scope.kind === "all") return true;
    if (scope.kind === "unassigned") return !node.chapterId;
    return node.chapterId === scope.chapterId;
  });
  const searchResults = useMemo(
    () => searchProject({ graph, nodeEntries, manifest }, query),
    [graph, manifest, nodeEntries, query],
  );
  const searching = query.trim().length > 0;

  return (
    <div style={panelStyle}>
      <div style={headingStyle}>
        <div>
          <div style={titleStyle}>故事结构</div>
          <div style={hintStyle}>按章节聚焦流程画布</div>
        </div>
        <button type="button" aria-label="新建章节" title="新建章节" style={iconButtonStyle} onClick={onCreateChapter}>
          <Plus size={15} />
        </button>
      </div>

      <div style={searchStyle}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索节点、台词、分支或资源"
          aria-label="搜索故事"
          style={searchInputStyle}
        />
      </div>

      {!searching && <div style={chapterListStyle}>
        <ScopeButton
          active={scope.kind === "all"}
          title="全部流程"
          count={graph.nodes.length}
          onClick={() => onScopeChange({ kind: "all" })}
        />
        {chapters.map((chapter, index) => (
          <div key={chapter.id} style={chapterRowStyle}>
            <ScopeButton
              active={scope.kind === "chapter" && scope.chapterId === chapter.id}
              title={chapter.title}
              count={graph.nodes.filter((node) => node.chapterId === chapter.id).length}
              onClick={() => onScopeChange({ kind: "chapter", chapterId: chapter.id })}
            />
            <div style={chapterActionsStyle}>
              <SmallAction label={`上移章节 ${chapter.title}`} disabled={index === 0} onClick={() => onMoveChapter(chapter.id, -1)}>
                <ChevronUp size={12} />
              </SmallAction>
              <SmallAction label={`下移章节 ${chapter.title}`} disabled={index === chapters.length - 1} onClick={() => onMoveChapter(chapter.id, 1)}>
                <ChevronDown size={12} />
              </SmallAction>
              <SmallAction label={`重命名章节 ${chapter.title}`} onClick={() => onRenameChapter(chapter.id)}>
                <Pencil size={12} />
              </SmallAction>
              <SmallAction label={`删除章节 ${chapter.title}`} danger onClick={() => onDeleteChapter(chapter.id)}>
                <Trash2 size={12} />
              </SmallAction>
            </div>
          </div>
        ))}
        {(unassigned.length > 0 || chapters.length > 0) && (
          <ScopeButton
            active={scope.kind === "unassigned"}
            title="未分章"
            count={unassigned.length}
            onClick={() => onScopeChange({ kind: "unassigned" })}
          />
        )}
      </div>}

      <div style={nodeSectionStyle}>
        <div style={nodeHeadingStyle}>{searching ? `搜索结果 · ${searchResults.length}` : `${scopeLabel(graph, scope)} · 节点`}</div>
        <div style={nodeListStyle}>
          {searching ? (
            searchResults.length === 0 ? <div style={emptyStyle}>没有匹配的结果</div> : searchResults.map((result, index) => (
              <button
                key={`${result.kind}-${index}`}
                type="button"
                onClick={() => {
                  if (result.kind === "edge") onSelectEdge?.(result.edgeId);
                  else if ("nodeId" in result && result.nodeId) onSelectNode(result.nodeId);
                }}
                style={searchResultStyle}
              >
                <span style={nodeTitleStyle}>{result.label}</span>
                <span style={searchMetaStyle}>{result.preview}</span>
              </button>
            ))
          ) : visibleNodes.length === 0 ? (
            <div style={emptyStyle}>这个章节还没有节点</div>
          ) : visibleNodes.map((node) => (
            <button
              key={node.id}
              type="button"
              onClick={() => onSelectNode(node.id)}
              style={{
                ...nodeButtonStyle,
                borderColor: selectedNodeId === node.id ? "var(--accent)" : "transparent",
                background: selectedNodeId === node.id ? "var(--bg-active)" : "transparent",
              }}
            >
              <span style={nodeTitleStyle}>{node.title}</span>
              {node.id === graph.entryNodeId && <span style={badgeStyle}>起点</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ScopeButton({ active, title, count, onClick }: { active: boolean; title: string; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      onClick={onClick}
      style={{ ...scopeButtonStyle, background: active ? "var(--bg-active)" : "transparent", color: active ? "var(--text-bright)" : "var(--text-primary)" }}
    >
      <span>{title}</span>
      <span style={countStyle}>{count}</span>
    </button>
  );
}

function SmallAction({ label, disabled, danger, onClick, children }: {
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      style={{ ...smallActionStyle, color: danger ? "var(--status-error-text)" : "var(--text-muted)" }}
    >
      {children}
    </button>
  );
}

function scopeLabel(graph: ProjectGraph, scope: ChapterScope): string {
  if (scope.kind === "all") return "全部流程";
  if (scope.kind === "unassigned") return "未分章";
  return graph.chapters?.find((chapter) => chapter.id === scope.chapterId)?.title ?? "章节";
}

const panelStyle: React.CSSProperties = { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 };
const headingStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-4)" };
const titleStyle: React.CSSProperties = { fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--text-bright)" };
const hintStyle: React.CSSProperties = { marginTop: 3, fontSize: "var(--text-xs)", color: "var(--text-muted)" };
const iconButtonStyle: React.CSSProperties = { width: 30, height: 30, display: "grid", placeItems: "center", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--bg-panel)", color: "var(--text-primary)", cursor: "pointer" };
const searchStyle: React.CSSProperties = { padding: "0 var(--space-3) var(--space-3)" };
const searchInputStyle: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border-input)", borderRadius: "var(--radius-sm)", background: "var(--bg-panel)", color: "var(--text-primary)", outline: "none" };
const chapterListStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 3, padding: "0 var(--space-3) var(--space-3)", borderBottom: "1px solid var(--border)" };
const chapterRowStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: 2 };
const scopeButtonStyle: React.CSSProperties = { width: "100%", minHeight: 34, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)", border: 0, borderRadius: "var(--radius-sm)", cursor: "pointer", textAlign: "left", fontSize: "var(--text-base)" };
const countStyle: React.CSSProperties = { minWidth: 22, padding: "1px 6px", borderRadius: "var(--radius-pill)", background: "var(--bg-panel)", color: "var(--text-muted)", fontSize: "var(--text-xs)", textAlign: "center" };
const chapterActionsStyle: React.CSSProperties = { display: "flex", gap: 1 };
const smallActionStyle: React.CSSProperties = { width: 22, height: 22, display: "grid", placeItems: "center", border: 0, background: "transparent", borderRadius: 4, cursor: "pointer" };
const nodeSectionStyle: React.CSSProperties = { display: "flex", flexDirection: "column", minHeight: 0, flex: 1, padding: "var(--space-3)" };
const nodeHeadingStyle: React.CSSProperties = { padding: "var(--space-1) var(--space-2) var(--space-2)", color: "var(--text-muted)", fontSize: "var(--text-xs)" };
const nodeListStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 2, overflowY: "auto" };
const nodeButtonStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)", border: "1px solid transparent", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", cursor: "pointer", textAlign: "left" };
const searchResultStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 3, padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--bg-panel)", color: "var(--text-primary)", cursor: "pointer", textAlign: "left" };
const searchMetaStyle: React.CSSProperties = { color: "var(--text-muted)", fontSize: "var(--text-xs)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const nodeTitleStyle: React.CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const badgeStyle: React.CSSProperties = { padding: "1px 6px", borderRadius: "var(--radius-pill)", background: "var(--bg-accent-soft)", color: "var(--accent-bright)", fontSize: "var(--text-xs)" };
const emptyStyle: React.CSSProperties = { padding: "var(--space-3)", color: "var(--text-muted)", fontSize: "var(--text-sm)" };
