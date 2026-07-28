import { useEffect, useMemo, useState } from "react";
import { Check, TriangleAlert } from "lucide-react";
import type { GraphEdge, Manifest, NodeEntry, NodeSummary, ProjectGraph } from "../../lib/types";
import { findNode, findNodeData, summarizeNodeConnections } from "./graphMapping";
import { parseGraphCondition } from "./graphCondition";
import type { VariableRegistry } from "@vibegal/engine";
import { BranchRules, moveEdge, moveEdgeById, normalizeEdge, orderDefaultAutoEdgeLast } from "./BranchRules";
import { collectStateSources, stateSourceDefaults } from "./storyState";

// 排序模型迁到 BranchRules，这里重新导出以保持既有调用方与测试的入口不变。
export { moveEdge, moveEdgeById, orderDefaultAutoEdgeLast };

/**
 * 条件草稿的提交校验：解析失败就不写回项目文件。
 * 句子化编辑器只产出合法表达式，但表达式模式与外部改动仍需要这道闸。
 */
export function commitConditionDraft(source: string):
  | { ok: true; condition: string | null }
  | { ok: false; message: string } {
  const condition = source.trim();
  if (!condition) return { ok: true, condition: null };
  const parsed = parseGraphCondition(condition);
  return parsed.ok ? { ok: true, condition } : { ok: false, message: parsed.error };
}

interface NodeInspectorProps {
  graph: ProjectGraph;
  nodeEntries?: NodeEntry[];
  nodeSummaries?: NodeSummary[];
  selectedNodeId: string | null;
  onEnter: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onSetChapter?: (id: string, chapterId: string) => void;
  onUpdateOutgoingEdges?: (nodeId: string, edges: GraphEdge[]) => void;
  onSetEntry?: (id: string) => void;
  saving?: boolean;
  variables?: VariableRegistry;
  manifest?: Manifest;
  onRegisterEnding?: (nodeId: string) => void;
  onEditEnding?: (endingId: string) => void;
  onUnregisterEnding?: (endingId: string) => void;
  onInsertEndingCompletion?: (nodeId: string, endingId: string) => void;
}

export function NodeInspector({
  graph,
  nodeEntries,
  nodeSummaries,
  selectedNodeId,
  onEnter,
  onRename,
  onSetChapter,
  onUpdateOutgoingEdges,
  onSetEntry,
  saving = false,
  variables,
  manifest,
  onRegisterEnding,
  onEditEnding,
  onUnregisterEnding,
  onInsertEndingCompletion,
}: NodeInspectorProps) {
  const node = findNode(graph, selectedNodeId);
  const [title, setTitle] = useState(node?.title ?? "");
  const [trialValues, setTrialValues] = useState<Record<string, string | number | boolean | null>>({});

  // 剧情经历与系统状态也要进试算环境，否则引用它们的条件会被误报成「未知变量」。
  const sources = useMemo(
    () => collectStateSources({ registry: variables, graph, manifest }),
    [variables, graph, manifest],
  );
  const defaults = useMemo(() => stateSourceDefaults(sources), [sources]);

  useEffect(() => {
    setTitle(node?.title ?? "");
  }, [node?.id, node?.title]);

  if (!node) {
    return (
      <div style={panelStyle}>
        <div style={panelTitleStyle}>属性面板</div>
        <div style={emptyStyle}>选择一个节点查看属性</div>
      </div>
    );
  }

  const summary = nodeSummaries?.find((candidate) => candidate.id === node.id);
  const hasContent = summary ? summary.exists : findNodeData(nodeEntries, node.file) != null;
  const { incoming, outgoing } = summary ?? summarizeNodeConnections(graph, node.id);
  const isEntry = node.id === graph.entryNodeId;
  const outgoingEdges = graph.edges.filter((edge) => edge.from === node.id).map(normalizeEdge);
  const linkedEndings = Object.entries(manifest?.unlocks?.endings ?? {}).filter(([, ending]) => ending.nodeId === node.id);

  return (
    <div style={panelStyle}>
      <div style={panelTitleStyle}>属性面板</div>
      <div style={contentStyle}>
        <section style={sectionStyle}>
          <label style={titleFieldStyle}>
            <span style={fieldLabelStyle}>标题</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => {
                const nextTitle = title.trim();
                if (nextTitle && nextTitle !== node.title) onRename(node.id, nextTitle);
                else setTitle(node.title);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
              style={titleInputStyle}
            />
          </label>
          <div style={{ ...statusTextStyle(hasContent), display: "inline-flex", alignItems: "center", gap: "var(--space-1)" }}>
            {hasContent ? <Check size={14} /> : <TriangleAlert size={14} />}
            {hasContent ? "已有内容" : "文件缺失"}
          </div>
        </section>

        <section style={sectionStyle}>
          <Field label="ID" value={node.id} mono />
          <Field label="文件" value={node.file} mono />
          <Field label="入口" value={isEntry ? "是" : "否"} />
          <Field label="位置" value={`x ${node.position.x} / y ${node.position.y}`} mono />
          <Field label="连接" value={`入 ${incoming} / 出 ${outgoing}`} mono />
          {graph.chapters.length > 0 && (
            <label style={titleFieldStyle}>
              <span style={fieldLabelStyle}>所属章节</span>
              <select
                value={node.chapterId}
                onChange={(event) => onSetChapter?.(node.id, event.target.value)}
                disabled={saving || !onSetChapter}
                style={titleInputStyle}
              >
                {graph.chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}
              </select>
            </label>
          )}
        </section>

        <section style={sectionStyle}>
          <div style={fieldLabelStyle}>离开这个节点</div>
          <BranchRules
            graph={graph}
            nodeId={node.id}
            edges={outgoingEdges}
            sources={sources}
            registry={variables}
            disabled={saving || !onUpdateOutgoingEdges}
            onChange={(edges) => onUpdateOutgoingEdges?.(node.id, edges)}
            trialValues={{ ...defaults, ...trialValues }}
            onTrialChange={setTrialValues}
          />
        </section>

        <section style={sectionStyle}>
          <Field label="结构角色" value={outgoing === 0 ? "图终点" : "流程节点（仍有出口）"} />
          <Field label="正式结局" value={linkedEndings.length ? linkedEndings.map(([id]) => id).join(", ") : "未登记"} />
          {linkedEndings.map(([id, ending]) => <div key={id} style={endingRowStyle}>
            <span>{id} · {ending.title}</span>
            <button type="button" onClick={() => onEditEnding?.(id)}>编辑</button>
            <button type="button" onClick={() => onInsertEndingCompletion?.(node.id, id)}>插入结算</button>
            <button type="button" onClick={() => onUnregisterEnding?.(id)}>取消登记</button>
          </div>)}
          <button type="button" onClick={() => onRegisterEnding?.(node.id)}>登记新结局…</button>
        </section>

        <button type="button" onClick={() => onEnter(node.id)} style={actionButtonStyle}>
          进入编辑
        </button>
        {!isEntry && onSetEntry && (
          <button type="button" onClick={() => onSetEntry(node.id)} disabled={saving} style={secondaryButtonStyle}>
            设为入口节点
          </button>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={fieldRowStyle}>
      <div style={fieldLabelStyle}>{label}</div>
      <div style={{ ...fieldValueStyle, fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, monospace" : undefined }}>
        {value}
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  background: "var(--bg-app)",
};

const panelTitleStyle: React.CSSProperties = {
  padding: "var(--space-3) var(--space-4)",
  borderBottom: "1px solid var(--border)",
  fontSize: "var(--text-base)",
  fontWeight: 600,
  color: "var(--text-primary)",
};

const contentStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-4)",
  padding: "var(--space-4)",
  overflowY: "auto",
};

const sectionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
  padding: "var(--space-3)",
  borderRadius: "var(--radius-md)",
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
};

const titleFieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
};

const titleInputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "var(--space-2) var(--space-2)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-input)",
  background: "var(--bg-inset)",
  color: "var(--text-bright)",
  fontSize: "var(--text-md)",
  fontWeight: 600,
  outline: "none",
};

const fieldRowStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1)",
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: "var(--text-xs)",
  color: "var(--text-muted)",
  textTransform: "uppercase",
};

const fieldValueStyle: React.CSSProperties = {
  fontSize: "var(--text-base)",
  color: "var(--text-primary)",
  wordBreak: "break-all",
};

const actionButtonStyle: React.CSSProperties = {
  padding: "var(--space-2) var(--space-3)",
  borderRadius: "var(--radius-md)",
  background: "var(--accent)",
  border: "1px solid var(--accent)",
  color: "var(--text-on-accent)",
  cursor: "pointer",
  fontSize: "var(--text-base)",
  fontWeight: 600,
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: "var(--space-2) var(--space-3)",
  borderRadius: "var(--radius-md)",
  background: "var(--bg-active)",
  border: "1px solid var(--accent)",
  color: "var(--accent-bright)",
  cursor: "pointer",
  fontSize: "var(--text-base)",
  fontWeight: 600,
};




const endingRowStyle: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: "var(--space-1)", alignItems: "center" };


const emptyStyle: React.CSSProperties = {
  padding: "var(--space-4)",
  color: "var(--text-muted)",
  fontSize: "var(--text-base)",
};

const statusTextStyle = (hasContent: boolean): React.CSSProperties => ({
  fontSize: "var(--text-base)",
  color: hasContent ? "var(--status-ok-text)" : "var(--status-warn-text)",
});
