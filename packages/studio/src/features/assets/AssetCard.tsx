/**
 * AssetCard —— 资产网格中的单个卡片。
 *
 * 按资源类型内联预览：
 *   - image: <img> 16:9 cover
 *   - audio: <audio controls>
 *   - video: <video controls>
 *   - other: 文件名占位
 *
 * 特殊状态：
 *   - 孤儿（磁盘有、manifest 无）：红色边框 + 未登记角标 + 登记按钮
 *   - 悬空（manifest 有、磁盘无）：占位卡片 + 文件缺失（由 DanglingCard 渲染，不走本组件）
 */
import { FileText, TriangleAlert } from "lucide-react";
import type { AssetEntry } from "../../lib/types";
import { baseName, previewKind, resolveAssetUrl } from "./assetPreview";
import { AssetAudioPreview } from "./AssetAudioPreview";
import { AssetImagePreview } from "./AssetImagePreview";

interface AssetCardProps {
  entry: AssetEntry;
  projectPath: string;
  isOrphan: boolean;
  /** 引用数（被多少 manifest 条目引用）。0 = 未登记。 */
  refCount: number;
  onDelete: (relPath: string, revision: AssetEntry["revision"]) => void;
  /** 孤儿登记：把该文件加进 manifest（kind 决定放哪张子表）。可选。 */
  onRegisterOrphan?: (entry: AssetEntry) => void;
  /** true 时只展示资产，不提供会写入磁盘或 manifest 的操作。 */
  readOnly?: boolean;
}

export function AssetCard({
  entry,
  projectPath,
  isOrphan,
  refCount,
  onDelete,
  onRegisterOrphan,
  readOnly = false,
}: AssetCardProps) {
  const kind = previewKind(entry.relPath);
  const url = kind === "audio" || kind === "video" ? resolveAssetUrl(projectPath, entry.relPath) : "";
  const name = baseName(entry.relPath);

  return (
    <div style={{ ...cardStyle, borderColor: isOrphan ? "var(--border-error)" : "var(--border)" }}>
      <div style={previewStyle}>
        {kind === "image" && (
          <AssetImagePreview
            projectPath={projectPath}
            relPath={entry.relPath}
            alt={name}
            style={imgStyle}
            placeholderStyle={previewPlaceholderStyle}
          />
        )}
        {kind === "audio" && (
          <AssetAudioPreview
            projectPath={projectPath}
            relPath={entry.relPath}
            size={entry.size}
          />
        )}
        {kind === "video" && <video src={url} controls style={videoStyle} />}
        {kind === "other" && (
          <span style={otherPreviewStyle}>
            <FileText size={28} />
          </span>
        )}
        {isOrphan && <span style={orphanBadgeStyle}>未登记</span>}
      </div>
      <div style={metaStyle}>
        <span style={nameStyle} title={entry.relPath}>{name}</span>
        <span style={refStyle}>
          {isOrphan ? (
            "剧本无法引用"
          ) : (
            <>引用 {refCount}</>
          )}
        </span>
      </div>
      {!readOnly && (
        <div style={actionsStyle}>
          {isOrphan && onRegisterOrphan && (
            <button type="button" style={smallBtnStyle} onClick={() => onRegisterOrphan(entry)}>
              登记
            </button>
          )}
          <button
            type="button"
            style={{ ...smallBtnStyle, color: "var(--status-error-text)" }}
            onClick={() => onDelete(entry.relPath, entry.revision)}
            aria-label={`删除 ${name}`}
          >
            删除
          </button>
        </div>
      )}
    </div>
  );
}

/** 悬空引用卡片：manifest 声明了但磁盘文件缺失。 */
export function DanglingCard({
  id,
  path,
  source,
  readOnly = false,
  onRemoveRef,
}: {
  id: string;
  path: string;
  source: string;
  readOnly?: boolean;
  onRemoveRef: (source: string) => void;
}) {
  return (
    <div style={{ ...cardStyle, borderColor: "var(--border-error)", borderStyle: "dashed" }}>
      <div style={{ ...previewStyle, background: "var(--bg-error-soft)" }}>
        <span style={{ ...otherPreviewStyle, color: "var(--status-error-text)" }}>
          <TriangleAlert size={20} />
        </span>
      </div>
      <div style={metaStyle}>
        <span style={nameStyle} title={path}>{id}</span>
        <span style={{ ...refStyle, color: "var(--status-error-text)" }}>文件缺失</span>
      </div>
      <div style={actionsStyle}>
        <span style={danglingSourceStyle} title={source}>{source}</span>
        {!readOnly && (
          <button
            type="button"
            style={{ ...smallBtnStyle, color: "var(--status-error-text)" }}
            onClick={() => onRemoveRef(source)}
          >
            移除引用
          </button>
        )}
      </div>
    </div>
  );
}

// ── 样式 ──

const cardStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: 168,
  borderRadius: "var(--radius-md)",
  border: `1px solid var(--border)`,
  background: "var(--bg-panel)",
  overflow: "hidden",
};

const previewStyle: React.CSSProperties = {
  position: "relative",
  width: "100%",
  aspectRatio: "16 / 9",
  background: "var(--bg-app)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const imgStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

const videoStyle: React.CSSProperties = {
  maxWidth: "100%",
  maxHeight: "100%",
};

const otherPreviewStyle: React.CSSProperties = {
  fontSize: "var(--text-display)",
  color: "var(--text-muted)",
};

const previewPlaceholderStyle: React.CSSProperties = {
  fontSize: "var(--text-xs)",
  color: "var(--text-muted)",
};

const orphanBadgeStyle: React.CSSProperties = {
  position: "absolute",
  top: 6,
  right: 6,
  fontSize: "var(--text-xs)",
  fontWeight: 700,
  padding: "var(--space-1) var(--space-2)",
  borderRadius: "var(--radius-xs)",
  background: "var(--border-error)",
  color: "var(--text-on-error)",
};

const metaStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1)",
  padding: "var(--space-2) var(--space-3) var(--space-1)",
};

const nameStyle: React.CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--text-primary)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const refStyle: React.CSSProperties = {
  fontSize: "var(--text-xs)",
  color: "var(--text-muted)",
};

const actionsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: "var(--space-1)",
  padding: "var(--space-1) var(--space-3) var(--space-2)",
};

const smallBtnStyle: React.CSSProperties = {
  fontSize: "var(--text-xs)",
  padding: "var(--space-1) var(--space-2)",
  borderRadius: "var(--radius-xs)",
  border: `1px solid var(--border-input)`,
  background: "var(--bg-app)",
  color: "var(--text-secondary)",
  cursor: "pointer",
};

const danglingSourceStyle: React.CSSProperties = {
  flex: 1,
  fontSize: "var(--text-xs)",
  color: "var(--text-muted)",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
