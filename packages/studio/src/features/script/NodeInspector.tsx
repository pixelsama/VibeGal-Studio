import { useEffect, useMemo, useState } from "react";
import { Check, TriangleAlert } from "lucide-react";
import type { GraphEdge, Manifest, NodeEntry, NodeSummary, ProjectGraph } from "../../lib/types";
import { findNode, findNodeData } from "./graphMapping";
import { conditionDraftError } from "./graphCondition";
import type { VariableRegistry } from "@vibegal/engine";
import { BranchRules, moveEdge, moveEdgeById, normalizeEdge, orderDefaultAutoEdgeLast } from "./BranchRules";
import { collectStateSources, stateSourceDefaults } from "./storyState";
import { useStudioI18n } from "../../lib/i18n";
import { Button } from "../common/Button";
import { PromptDialog } from "../common/Dialogs";

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
  const error = conditionDraftError(condition);
  return error ? { ok: false, message: error } : { ok: true, condition };
}

/** 更新一个自动出口的原始表达式，并保持兜底出口在最后。 */
export function replaceEdgeCondition(edges: GraphEdge[], edgeId: string, source: string): GraphEdge[] {
  const condition = source.trim() || null;
  return orderDefaultAutoEdgeLast(edges.map((edge) => edge.id === edgeId
    ? normalizeEdge({ ...edge, mode: "auto", label: null, condition })
    : edge));
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
  /** 空态时提供「新建节点」动作入口（Spec 33 E4）。 */
  onCreateNode?: () => void;
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
  onCreateNode,
  saving = false,
  variables,
  manifest,
  onRegisterEnding,
  onEditEnding,
  onUnregisterEnding,
  onInsertEndingCompletion,
}: NodeInspectorProps) {
  const { t } = useStudioI18n();
  const node = findNode(graph, selectedNodeId);
  const [title, setTitle] = useState(node?.title ?? "");
  const [trialValues, setTrialValues] = useState<Record<string, string | number | boolean | null>>({});
  const [expressionPrompt, setExpressionPrompt] = useState<{ nodeId: string; edgeId: string; source: string } | null>(null);

  // 剧情经历与系统状态也要进试算环境，否则引用它们的条件会被误报成「未知变量」。
  const sources = useMemo(
    () => collectStateSources({ registry: variables, graph, manifest, t }),
    [variables, graph, manifest, t],
  );
  const defaults = useMemo(() => stateSourceDefaults(sources), [sources]);

  useEffect(() => {
    setTitle(node?.title ?? "");
  }, [node?.id, node?.title]);

  if (!node) {
    return (
      <div style={panelStyle}>
        <div style={panelTitleStyle}>{t("script.nodeInspector.title")}</div>
        <div style={emptyStyle}>{t("script.nodeInspector.selectHint")}</div>
        {onCreateNode && (
          <div style={emptyActionStyle}>
            <Button variant="primary" onClick={onCreateNode} disabled={saving}>{t("script.createNode")}</Button>
          </div>
        )}
      </div>
    );
  }

  const summary = nodeSummaries?.find((candidate) => candidate.id === node.id);
  const hasContent = summary ? summary.exists : findNodeData(nodeEntries, node.file) != null;
  const isEntry = node.id === graph.entryNodeId;
  const outgoingEdges = graph.edges.filter((edge) => edge.from === node.id).map(normalizeEdge);
  const linkedEndings = Object.entries(manifest?.unlocks?.endings ?? {}).filter(([, ending]) => ending.nodeId === node.id);

  return (
    <div style={panelStyle}>
      <div style={panelTitleStyle}>{t("script.nodeInspector.title")}</div>
      <div style={contentStyle}>
        <section style={sectionStyle}>
          <label style={titleFieldStyle}>
            <span style={fieldLabelStyle}>{t("script.node.title")}</span>
            <input
              className="gs-input"
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
            {hasContent ? t("script.nodeInspector.hasContent") : t("script.nodeInspector.missingFile")}
          </div>
        </section>

        <section style={sectionStyle}>
          {graph.chapters.length > 0 && (
            <label style={titleFieldStyle}>
              <span style={fieldLabelStyle}>{t("script.nodeInspector.chapter")}</span>
              <select
                className="gs-input"
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
          <div style={fieldLabelStyle}>{t("script.nodeInspector.exits")}</div>
          <BranchRules
            graph={graph}
            nodeId={node.id}
            edges={outgoingEdges}
            sources={sources}
            registry={variables}
            disabled={saving || !onUpdateOutgoingEdges}
            onChange={(edges) => onUpdateOutgoingEdges?.(node.id, edges)}
            onEditExpression={!saving && onUpdateOutgoingEdges
              ? (edge) => setExpressionPrompt({ nodeId: node.id, edgeId: edge.id, source: edge.condition ?? "" })
              : undefined}
            trialValues={{ ...defaults, ...trialValues }}
            onTrialChange={setTrialValues}
          />
        </section>

        <section style={sectionStyle}>
          <Field label={t("script.nodeInspector.officialEnding")} value={linkedEndings.length ? linkedEndings.map(([id]) => id).join(", ") : t("script.nodeInspector.unregistered")} />
          {linkedEndings.map(([id, ending]) => <div key={id} style={endingRowStyle}>
            <span>{id} · {ending.title}</span>
            <button type="button" onClick={() => onEditEnding?.(id)}>{t("script.nodeInspector.editEnding")}</button>
            <button type="button" onClick={() => onInsertEndingCompletion?.(node.id, id)}>{t("script.nodeInspector.insertCompletion")}</button>
            <button type="button" onClick={() => onUnregisterEnding?.(id)}>{t("script.nodeInspector.unregisterEnding")}</button>
          </div>)}
          <button type="button" onClick={() => onRegisterEnding?.(node.id)}>{t("script.nodeInspector.registerEnding")}</button>
        </section>

        <button type="button" onClick={() => onEnter(node.id)} style={actionButtonStyle}>
          {t("script.nodeInspector.enterEdit")}
        </button>
        {!isEntry && onSetEntry && (
          <button type="button" onClick={() => onSetEntry(node.id)} disabled={saving} style={secondaryButtonStyle}>
            {t("script.nodeInspector.setEntry")}
          </button>
        )}
      </div>

      {expressionPrompt?.nodeId === node.id && (
        <PromptDialog
          title={t("script.condition.editExpression")}
          label={t("script.condition.expressionLabel")}
          initialValue={expressionPrompt.source}
          allowUnchanged
          allowEmpty
          confirmLabel={t("script.condition.applyExpression")}
          validate={conditionDraftError}
          onConfirm={(source) => {
            const committed = commitConditionDraft(source);
            if (!committed.ok) return;
            onUpdateOutgoingEdges?.(
              node.id,
              replaceEdgeCondition(outgoingEdges, expressionPrompt.edgeId, committed.condition ?? ""),
            );
          }}
          onClose={() => setExpressionPrompt(null)}
        />
      )}
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

const emptyActionStyle: React.CSSProperties = {
  padding: "0 var(--space-4) var(--space-4)",
};

const statusTextStyle = (hasContent: boolean): React.CSSProperties => ({
  fontSize: "var(--text-base)",
  color: hasContent ? "var(--status-ok-text)" : "var(--status-warn-text)",
});
