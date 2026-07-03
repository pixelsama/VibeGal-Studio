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
import type { AssetEntry } from "../../lib/types";
import { baseName, previewKind, resolveAssetUrl } from "./assetPreview";
import { AssetImagePreview } from "./AssetImagePreview";

interface AssetCardProps {
  entry: AssetEntry;
  projectPath: string;
  isOrphan: boolean;
  /** 引用数（被多少 manifest 条目引用）。0 = 未登记。 */
  refCount: number;
  onDelete: (relPath: string) => void;
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
    <div style={{ ...cardStyle, borderColor: isOrphan ? "#7a3a3a" : "#232a38" }}>
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
        {kind === "audio" && <audio src={url} controls style={audioStyle} />}
        {kind === "video" && <video src={url} controls style={videoStyle} />}
        {kind === "other" && <span style={otherPreviewStyle}>📄</span>}
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
            style={{ ...smallBtnStyle, color: "#e0a0a0" }}
            onClick={() => onDelete(entry.relPath)}
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
    <div style={{ ...cardStyle, borderColor: "#7a3a3a", borderStyle: "dashed" }}>
      <div style={{ ...previewStyle, background: "#1a1212" }}>
        <span style={{ ...otherPreviewStyle, color: "#e0a0a0" }}>⚠</span>
      </div>
      <div style={metaStyle}>
        <span style={nameStyle} title={path}>{id}</span>
        <span style={{ ...refStyle, color: "#e0a0a0" }}>文件缺失</span>
      </div>
      <div style={actionsStyle}>
        <span style={danglingSourceStyle} title={source}>{source}</span>
        {!readOnly && (
          <button
            type="button"
            style={{ ...smallBtnStyle, color: "#e0a0a0" }}
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
  borderRadius: 8,
  border: "1px solid #232a38",
  background: "#141922",
  overflow: "hidden",
};

const previewStyle: React.CSSProperties = {
  position: "relative",
  width: "100%",
  aspectRatio: "16 / 9",
  background: "#0e1116",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const imgStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

const audioStyle: React.CSSProperties = {
  width: "90%",
};

const videoStyle: React.CSSProperties = {
  maxWidth: "100%",
  maxHeight: "100%",
};

const otherPreviewStyle: React.CSSProperties = {
  fontSize: 28,
  color: "#7a8290",
};

const previewPlaceholderStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#7a8290",
};

const orphanBadgeStyle: React.CSSProperties = {
  position: "absolute",
  top: 6,
  right: 6,
  fontSize: 10,
  fontWeight: 700,
  padding: "2px 6px",
  borderRadius: 4,
  background: "#7a3a3a",
  color: "#fff",
};

const metaStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  padding: "8px 10px 4px",
};

const nameStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#d4dae2",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const refStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#7a8290",
};

const actionsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 6,
  padding: "4px 10px 8px",
};

const smallBtnStyle: React.CSSProperties = {
  fontSize: 11,
  padding: "3px 8px",
  borderRadius: 5,
  border: "1px solid #2f394a",
  background: "#0e1116",
  color: "#a0a8b4",
  cursor: "pointer",
};

const danglingSourceStyle: React.CSSProperties = {
  flex: 1,
  fontSize: 10,
  color: "#7a8290",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
