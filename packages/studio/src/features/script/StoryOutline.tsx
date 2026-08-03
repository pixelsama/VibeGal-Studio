import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { UIEvent } from "react";
import type { Manifest, NodeEntry, ProjectGraph } from "../../lib/types";
import type { ChapterScope } from "./chapterEditing";
import { searchProject } from "./projectSearch";
import { fixedListWindow } from "../common/virtualWindow";
import { useStudioI18n, type StudioTranslator } from "../../lib/i18n";

interface StoryOutlineProps {
  graph: ProjectGraph;
  nodeEntries?: NodeEntry[];
  loadingNodeEntries?: boolean;
  nodeEntriesError?: string | null;
  onSearchActiveChange?: (active: boolean) => void;
  manifest?: Manifest;
  scope: ChapterScope;
  selectedNodeId: string | null;
  onScopeChange: (scope: ChapterScope) => void;
  onSelectNode: (nodeId: string) => void;
  onSelectEdge?: (edgeId: string) => void;
  onCreateNode: () => void;
  onCreateChapter: () => void;
  onRenameChapter: (chapterId: string) => void;
  onMoveChapter: (chapterId: string, offset: -1 | 1) => void;
  onDeleteChapter: (chapterId: string) => void;
}

export function StoryOutline({
  graph,
  nodeEntries,
  loadingNodeEntries = false,
  nodeEntriesError = null,
  onSearchActiveChange,
  manifest,
  scope,
  selectedNodeId,
  onScopeChange,
  onSelectNode,
  onSelectEdge,
  onCreateNode,
  onCreateChapter,
  onRenameChapter,
  onMoveChapter,
  onDeleteChapter,
}: StoryOutlineProps) {
  const { t } = useStudioI18n();
  const [query, setQuery] = useState("");
  const [listViewport, setListViewport] = useState({ scrollTop: 0, height: 480 });
  const nodeListRef = useRef<HTMLDivElement | null>(null);
  const chapters = graph.chapters;
  const chapterCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of graph.nodes) counts.set(node.chapterId, (counts.get(node.chapterId) ?? 0) + 1);
    return counts;
  }, [graph.nodes]);
  const visibleNodes = useMemo(() => graph.nodes.filter((node) => {
    if (scope.kind === "all") return true;
    return node.chapterId === scope.chapterId;
  }), [graph.nodes, scope]);
  const searchResults = useMemo(
    () => searchProject({ graph, nodeEntries, manifest }, query),
    [graph, manifest, nodeEntries, query],
  );
  const searching = query.trim().length > 0;
  useEffect(() => {
    onSearchActiveChange?.(searching);
    return () => onSearchActiveChange?.(false);
  }, [onSearchActiveChange, searching]);
  const listItems = searching ? searchResults : visibleNodes;
  const rowHeight = searching ? 72 : 38;
  const listWindow = fixedListWindow(listItems.length, listViewport.scrollTop, listViewport.height, rowHeight);
  const windowedItems = listItems.slice(listWindow.start, listWindow.end);

  useEffect(() => {
    const list = nodeListRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const update = () => setListViewport((current) => ({ ...current, height: list.clientHeight || current.height }));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (searching || !selectedNodeId) return;
    const index = visibleNodes.findIndex((node) => node.id === selectedNodeId);
    const list = nodeListRef.current;
    if (index < 0 || !list) return;
    const top = index * 38;
    if (top < list.scrollTop || top + 38 > list.scrollTop + list.clientHeight) {
      list.scrollTo({ top: Math.max(0, top - list.clientHeight / 2), behavior: "smooth" });
    }
  }, [searching, selectedNodeId, visibleNodes]);

  const handleListScroll = (event: UIEvent<HTMLDivElement>) => {
    const scrollTop = event.currentTarget.scrollTop;
    setListViewport((current) => current.scrollTop === scrollTop ? current : { ...current, scrollTop });
  };

  return (
    <div style={panelStyle}>
      <div style={headingStyle}>
        <div>
          <div style={titleStyle}>{t("script.sidebar.story")}</div>
          <div style={hintStyle}>{t("script.outline.hint")}</div>
        </div>
        <button
          type="button"
          aria-label={t("script.outline.createChapter")}
          title={t("script.outline.createChapter")}
          style={iconButtonStyle}
          onClick={onCreateChapter}
        >
          <Plus size={15} />
        </button>
      </div>

      <div style={searchStyle}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("script.outline.searchPlaceholder")}
          aria-label={t("script.outline.searchLabel")}
          style={searchInputStyle}
        />
      </div>

      {!searching && <div style={chapterListStyle}>
        <ScopeButton
          active={scope.kind === "all"}
          title={t("script.globalView")}
          count={graph.nodes.length}
          onClick={() => onScopeChange({ kind: "all" })}
        />
        {chapters.map((chapter, index) => (
          <div key={chapter.id} style={chapterRowStyle}>
            <ScopeButton
              active={scope.kind === "chapter" && scope.chapterId === chapter.id}
              title={chapter.title}
              count={chapterCounts.get(chapter.id) ?? 0}
              onClick={() => onScopeChange({ kind: "chapter", chapterId: chapter.id })}
            />
            <div style={chapterActionsStyle}>
              <SmallAction label={t("script.outline.moveUp", { title: chapter.title })} disabled={index === 0} onClick={() => onMoveChapter(chapter.id, -1)}>
                <ChevronUp size={12} />
              </SmallAction>
              <SmallAction label={t("script.outline.moveDown", { title: chapter.title })} disabled={index === chapters.length - 1} onClick={() => onMoveChapter(chapter.id, 1)}>
                <ChevronDown size={12} />
              </SmallAction>
              <SmallAction label={t("script.outline.rename", { title: chapter.title })} onClick={() => onRenameChapter(chapter.id)}>
                <Pencil size={12} />
              </SmallAction>
              <SmallAction
                label={t("script.outline.delete", { title: chapter.title })}
                disabled={chapters.length === 1 || graph.nodes.some((node) => node.chapterId === chapter.id)}
                danger
                onClick={() => onDeleteChapter(chapter.id)}
              >
                <Trash2 size={12} />
              </SmallAction>
            </div>
          </div>
        ))}
      </div>}

      <div style={nodeSectionStyle}>
        <div style={nodeHeadingStyle}>
          {searching
            ? t("script.outline.searchResults", { count: searchResults.length })
            : t("script.outline.scopeNodes", { scope: scopeLabel(graph, scope, t) })}
        </div>
        <div
          ref={nodeListRef}
          role="listbox"
          aria-label={searching ? t("script.outline.searchResultsLabel") : t("script.outline.chapterNodes")}
          aria-setsize={listItems.length}
          style={nodeListStyle}
          onScroll={handleListScroll}
        >
          <div aria-hidden="true" style={{ height: listWindow.paddingTop, flexShrink: 0 }} />
          {searching ? (
            loadingNodeEntries ? (
              <div role="status" style={emptyStyle}>{t("script.outline.loading")}</div>
            ) : nodeEntriesError ? (
              <div role="alert" style={{ ...emptyStyle, color: "var(--status-error-text)" }}>
                {t("script.outline.searchFailed", { detail: nodeEntriesError })}
              </div>
            ) : searchResults.length === 0 ? <div style={emptyStyle}>{t("script.outline.noResults")}</div> : windowedItems.map((item, visibleIndex) => {
              const result = item as (typeof searchResults)[number];
              const index = listWindow.start + visibleIndex;
              return (
              <button
                key={`${result.kind}-${index}`}
                type="button"
                role="option"
                aria-posinset={index + 1}
                aria-setsize={searchResults.length}
                onClick={() => {
                  if (result.kind === "edge") onSelectEdge?.(result.edgeId);
                  else if ("nodeId" in result && result.nodeId) onSelectNode(result.nodeId);
                }}
                style={{ ...searchResultStyle, height: rowHeight - 2, boxSizing: "border-box", flexShrink: 0, overflow: "hidden" }}
              >
                <span style={nodeTitleStyle}>{result.label}</span>
                <span style={searchMetaStyle}>{result.preview}</span>
              </button>
              );
            })
          ) : visibleNodes.length === 0 ? (
            <div style={emptyStyle}>
              <span>{t("script.outline.empty")}</span>
              <button type="button" className="gs-btn gs-btn--primary" onClick={onCreateNode} style={emptyActionStyle}>
                <Plus size={14} />
                {t("script.createNode")}
              </button>
            </div>
          ) : windowedItems.map((item, visibleIndex) => {
            const node = item as (typeof visibleNodes)[number];
            const index = listWindow.start + visibleIndex;
            return (
            <button
              key={node.id}
              type="button"
              role="option"
              aria-selected={selectedNodeId === node.id}
              aria-posinset={index + 1}
              aria-setsize={visibleNodes.length}
              onClick={() => onSelectNode(node.id)}
              style={{
                ...nodeButtonStyle,
                height: rowHeight - 2,
                boxSizing: "border-box",
                flexShrink: 0,
                borderColor: selectedNodeId === node.id ? "var(--accent)" : "transparent",
                background: selectedNodeId === node.id ? "var(--bg-active)" : "transparent",
              }}
            >
              <span style={nodeTitleStyle}>{node.title}</span>
              {node.id === graph.entryNodeId && <span style={badgeStyle}>{t("script.outline.entry")}</span>}
            </button>
            );
          })}
          <div aria-hidden="true" style={{ height: listWindow.paddingBottom, flexShrink: 0 }} />
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

function scopeLabel(
  graph: ProjectGraph,
  scope: ChapterScope,
  t: StudioTranslator,
): string {
  if (scope.kind === "all") return t("script.globalView");
  return graph.chapters.find((chapter) => chapter.id === scope.chapterId)?.title ?? t("script.chapter");
}

const panelStyle: React.CSSProperties = { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 };
const headingStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-4)" };
const titleStyle: React.CSSProperties = { fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--text-bright)" };
const hintStyle: React.CSSProperties = { marginTop: 3, fontSize: "var(--text-xs)", color: "var(--text-muted)" };
const iconButtonStyle: React.CSSProperties = { width: 30, height: 30, display: "grid", placeItems: "center", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--bg-panel)", color: "var(--text-primary)", cursor: "pointer" };
const searchStyle: React.CSSProperties = { padding: "0 var(--space-3) var(--space-3)" };
const searchInputStyle: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border-input)", borderRadius: "var(--radius-sm)", background: "var(--bg-panel)", color: "var(--text-primary)" };
const chapterListStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 3, padding: "0 var(--space-3) var(--space-3)", borderBottom: "1px solid var(--border)" };
const chapterRowStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: 2 };
const scopeButtonStyle: React.CSSProperties = { width: "100%", minHeight: 34, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)", border: 0, borderRadius: "var(--radius-sm)", cursor: "pointer", textAlign: "left", fontSize: "var(--text-base)" };
const countStyle: React.CSSProperties = { minWidth: 22, padding: "1px 6px", borderRadius: "var(--radius-pill)", background: "var(--bg-panel)", color: "var(--text-muted)", fontSize: "var(--text-xs)", textAlign: "center" };
const chapterActionsStyle: React.CSSProperties = { display: "flex", gap: 1 };
const smallActionStyle: React.CSSProperties = { width: 22, height: 22, display: "grid", placeItems: "center", border: 0, background: "transparent", borderRadius: 4, cursor: "pointer" };
const nodeSectionStyle: React.CSSProperties = { display: "flex", flexDirection: "column", minHeight: 0, flex: 1, padding: "var(--space-3)" };
const nodeHeadingStyle: React.CSSProperties = { padding: "var(--space-1) var(--space-2) var(--space-2)", color: "var(--text-muted)", fontSize: "var(--text-xs)" };
const nodeListStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 2, overflowY: "auto", minHeight: 0, flex: 1 };
const nodeButtonStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)", border: "1px solid transparent", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", cursor: "pointer", textAlign: "left" };
const searchResultStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 3, padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--bg-panel)", color: "var(--text-primary)", cursor: "pointer", textAlign: "left" };
const searchMetaStyle: React.CSSProperties = { color: "var(--text-muted)", fontSize: "var(--text-xs)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const nodeTitleStyle: React.CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const badgeStyle: React.CSSProperties = { padding: "1px 6px", borderRadius: "var(--radius-pill)", background: "var(--bg-accent-soft)", color: "var(--accent-bright)", fontSize: "var(--text-xs)" };
const emptyStyle: React.CSSProperties = { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "var(--space-2)", padding: "var(--space-3)", color: "var(--text-muted)", fontSize: "var(--text-sm)" };
const emptyActionStyle: React.CSSProperties = { fontSize: "var(--text-sm)" };
