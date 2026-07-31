/**
 * CharacterEditor —— 角色 section 的三栏编辑器。
 *
 * 左：角色列表（来自 manifest.characters）+ 新建角色
 * 中：选中角色的 default sprite 预览舞台
 * 右：属性面板（name/color 可编辑 + sprite 表情列表：加/删/设默认/重命名）
 *
 * 所有改动通过 onChange(manifest) 上抛为父组件本地草稿，由用户显式保存。
 */
import { useState } from "react";
import { X, UserRoundPlus } from "lucide-react";
import type { Manifest, ManifestCharacter, CharacterSpriteRef } from "../../lib/types";
import { useStudioI18n, translateZhCN, type StudioTranslator } from "../../lib/i18n";
import { importAsset, pickAssetFiles } from "../../lib/tauri";
import { Button } from "../common/Button";
import { EmptyState } from "../common/EmptyState";
import type { ToastInput } from "../common/Toast";
import { AssetImagePreview } from "./AssetImagePreview";

interface CharacterEditorProps {
  projectPath: string;
  manifest: Manifest;
  onChange: (manifest: Manifest) => void;
  onFeedback?: (toast: ToastInput) => void;
  disabled?: boolean;
}

export function CharacterEditor({ projectPath, manifest, onChange, onFeedback, disabled = false }: CharacterEditorProps) {
  const { t } = useStudioI18n();
  const characterIds = Object.keys(manifest.characters);
  const [selectedId, setSelectedId] = useState<string | null>(characterIds[0] ?? null);
  const [newExprDraft, setNewExprDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const selected = selectedId ? manifest.characters[selectedId] : undefined;

  function updateCharacter(id: string, patch: Partial<ManifestCharacter>) {
    if (disabled) return;
    const prev = manifest.characters[id];
    if (!prev) return;
    onChange({
      ...manifest,
      characters: { ...manifest.characters, [id]: { ...prev, ...patch } },
    });
  }

  function addCharacter() {
    if (disabled) return;
    let n = 1;
    let id = `char_${n}`;
    while (manifest.characters[id]) {
      n += 1;
      id = `char_${n}`;
    }
    onChange({
      ...manifest,
      characters: {
        ...manifest.characters,
        [id]: { name: "新角色", color: "#ffffff", sprites: {} },
      },
    });
    setSelectedId(id);
  }

  function deleteCharacter(id: string) {
    if (disabled) return;
    const next = { ...manifest.characters };
    delete next[id];
    onChange({ ...manifest, characters: next });
    if (selectedId === id) {
      const remaining = Object.keys(next);
      setSelectedId(remaining[0] ?? null);
    }
  }

  async function addSpriteExpr(id: string, expr: string) {
    if (disabled) return;
    const char = manifest.characters[id];
    if (!char) return;
    // 弹出文件选择器导入真实图片，避免写入占位路径制造 missing_asset。
    const files = await pickAssetFiles("character");
    if (files.length === 0) return;
    const src = files[0];
    const fileName = src.split(/[/\\]/).pop() ?? "sprite.png";
    const normalizedExpr = spriteExprNameForImport(expr, fileName, char.sprites);
    const destRel = `assets/characters/${safeAssetFileStem(id)}_${safeAssetFileStem(normalizedExpr)}${extOf(fileName)}`;
    setBusy(true);
    try {
      await importAsset(projectPath, src, destRel);
      updateCharacter(id, { sprites: { ...char.sprites, [normalizedExpr]: destRel } });
      setNewExprDraft((d) => ({ ...d, [id]: "" }));
    } catch (e) {
      onFeedback?.(createCharacterSpriteImportFailureToast(fileName, e, t));
    } finally {
      setBusy(false);
    }
  }

  /** 返回含点的扩展名（如 ".png"）；无扩展名则空串。 */
  function extOf(fileName: string): string {
    const dot = fileName.lastIndexOf(".");
    return dot > 0 ? fileName.slice(dot) : "";
  }

  function removeSpriteExpr(id: string, expr: string) {
    if (disabled) return;
    const char = manifest.characters[id];
    if (!char) return;
    const next = { ...char.sprites };
    delete next[expr];
    updateCharacter(id, { sprites: next });
  }

  function renameSpriteExpr(id: string, oldExpr: string, newExpr: string) {
    if (disabled) return;
    const char = manifest.characters[id];
    if (!char || !newExpr.trim() || oldExpr === newExpr) return;
    const entries = Object.entries(char.sprites);
    const reordered = entries.reduce<Record<string, CharacterSpriteRef>>((acc, [k, v]) => {
      acc[k === oldExpr ? newExpr : k] = v;
      return acc;
    }, {});
    updateCharacter(id, { sprites: reordered });
  }

  return (
    <div style={workspaceStyle}>
      {/* 左：角色列表 */}
      <div style={listPanelStyle}>
        <div style={listHeaderStyle}>
          <span style={panelTitleStyle}>{t("assets.character.title")}</span>
          <button
            type="button"
            style={{ ...smallBtnStyle, opacity: disabled ? 0.48 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
            onClick={addCharacter}
            disabled={disabled}
            title={disabled ? t("assets.character.editDisabledTitle") : undefined}
          >
            {t("assets.character.new")}
          </button>
        </div>
        {disabled && <div style={readOnlyHintStyle}>{t("assets.character.editDisabled")}</div>}
        <div style={listStyle}>
          {characterIds.length === 0 && <div style={emptyRowStyle}>{t("assets.character.emptyList")}</div>}
          {characterIds.map((id) => (
            <button
              key={id}
              type="button"
              style={{
                ...rowStyle,
                background: id === selectedId ? "var(--bg-active)" : "transparent",
                color: id === selectedId ? "var(--text-bright)" : "var(--text-secondary)",
              }}
              onClick={() => setSelectedId(id)}
            >
              {manifest.characters[id].name || id}
            </button>
          ))}
        </div>
      </div>

      {/* 中：预览舞台 */}
      <div style={stageStyle}>
        {selected ? (
          <CharacterStage
            char={selected}
            projectPath={projectPath}
            t={t}
          />
        ) : characterIds.length === 0 ? (
          <EmptyState
            icon={UserRoundPlus}
            title={t("assets.character.emptyTitle")}
            description={t("assets.character.emptyDescription")}
            action={!disabled ? <Button variant="primary" onClick={addCharacter}>{t("assets.character.createFirst")}</Button> : undefined}
          />
        ) : (
          <div style={emptyStageStyle}>{t("assets.character.select")}</div>
        )}
      </div>

      {/* 右：属性面板 */}
      <div style={propsPanelStyle}>
        {selected && selectedId ? (
          <>
            <div style={propGroupStyle}>
              <div style={panelTitleStyle}>{t("assets.character.basic")}</div>
              <label style={fieldLabelStyle}>
                {t("assets.character.name")}
                <input
                  type="text"
                  value={selected.name}
                  onChange={(e) => updateCharacter(selectedId, { name: e.target.value })}
                  disabled={disabled}
                  style={fieldInputStyle}
                />
              </label>
              <label style={fieldLabelStyle}>
                {t("assets.character.color")}
                <input
                  type="color"
                  value={selected.color}
                  onChange={(e) => updateCharacter(selectedId, { color: e.target.value })}
                  disabled={disabled}
                  style={colorInputStyle}
                />
                <span style={hexStyle}>{selected.color}</span>
              </label>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  style={{
                    ...smallBtnStyle,
                    color: "var(--status-error-text)",
                    opacity: disabled ? 0.48 : 1,
                    cursor: disabled ? "not-allowed" : "pointer",
                  }}
                  onClick={() => deleteCharacter(selectedId)}
                  disabled={disabled}
                >
                  {t("assets.character.delete")}
                </button>
              </div>
            </div>

            <div style={propGroupStyle}>
              <div style={panelTitleStyle}>{t("assets.character.expressions")}</div>
              {Object.entries(selected.sprites).map(([expr, sprite]) => (
                <SpriteExprRow
                  key={expr}
                  expr={expr}
                  sprite={sprite}
                  projectPath={projectPath}
                  isDefault={expr === "default"}
                  onRename={(newExpr) => renameSpriteExpr(selectedId, expr, newExpr)}
                  onRemove={() => removeSpriteExpr(selectedId, expr)}
                  onSetDefault={() => {
                    if (disabled) return;
                    if (expr === "default") return;
                    const reordered = { default: sprite, ...omit(selected.sprites, expr) };
                    updateCharacter(selectedId, { sprites: reordered });
                  }}
                  disabled={disabled}
                  t={t}
                />
              ))}
              <SpriteExprAddForm
                draft={newExprDraft[selectedId] ?? ""}
                busy={busy}
                onDraftChange={(v) => setNewExprDraft((d) => ({ ...d, [selectedId]: v }))}
                onAdd={(expr) => void addSpriteExpr(selectedId, expr)}
                disabled={disabled}
                t={t}
              />
            </div>

            <div style={propGroupStyle}>
              <div style={panelTitleStyle}>{t("assets.character.advanced")}</div>
              <div style={idStyle}>id: {selectedId}</div>
            </div>
          </>
        ) : (
          <div style={emptyPropsStyle} />
        )}
      </div>
    </div>
  );
}

export function createCharacterSpriteImportFailureToast(
  fileName: string,
  error: unknown,
  t: StudioTranslator = translateZhCN,
): ToastInput {
  return {
    kind: "error",
    message: t("assets.character.importFailed"),
    detail: `${fileName}\n${formatUnknownError(error)}`,
  };
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 中间舞台：渲染选中角色的 default sprite。 */
function CharacterStage({
  char,
  projectPath,
  t,
}: {
  char: ManifestCharacter;
  projectPath: string;
  t: StudioTranslator;
}) {
  const defaultSprite = char.sprites.default;
  const defaultPath = defaultSprite
    ? typeof defaultSprite === "string" ? defaultSprite : defaultSprite.fallback
    : null;
  return (
    <div style={stageInnerStyle}>
      {defaultPath ? (
        <AssetImagePreview
          projectPath={projectPath}
          relPath={defaultPath}
          alt={char.name}
          style={stageImgStyle}
          placeholderStyle={stagePlaceholderStyle}
        />
      ) : (
        <span style={stagePlaceholderStyle}>{t("assets.character.noDefaultExpression")}</span>
      )}
      <div style={{ ...stageNameStyle, color: char.color }}>
        {char.name}
      </div>
    </div>
  );
}

function SpriteExprRow({
  expr,
  sprite,
  projectPath,
  isDefault,
  onRename,
  onRemove,
  onSetDefault,
  disabled,
  t,
}: {
  expr: string;
  sprite: CharacterSpriteRef;
  projectPath: string;
  isDefault: boolean;
  onRename: (newExpr: string) => void;
  onRemove: () => void;
  onSetDefault: () => void;
  disabled: boolean;
  t: StudioTranslator;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(expr);
  const path = typeof sprite === "string" ? sprite : sprite.fallback;
  return (
    <div style={exprRowStyle}>
      <AssetImagePreview
        projectPath={projectPath}
        relPath={path}
        alt={expr}
        style={exprThumbStyle}
        placeholderStyle={exprThumbPlaceholderStyle}
      />
      <div style={exprMetaStyle}>
        {editing ? (
          <input
            type="text"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            disabled={disabled}
            onBlur={() => {
              onRename(draft);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onRename(draft);
                setEditing(false);
              }
            }}
            style={fieldInputStyle}
          />
        ) : (
          <button
            type="button"
            style={exprNameBtnStyle}
            onClick={() => {
              if (disabled) return;
              setDraft(expr);
              setEditing(true);
            }}
            title={t("assets.character.renameExpression")}
            disabled={disabled}
          >
            {expr}
            {isDefault && <span style={defaultTagStyle}>{t("assets.character.defaultExpression")}</span>}
          </button>
        )}
        <span style={exprPathStyle} title={path}>
          {typeof sprite === "string" ? path : t("assets.character.atlas", {
            path,
            atlas: sprite.atlas,
            clip: sprite.clip,
          })}
        </span>
      </div>
      <div style={{ display: "flex", gap: "var(--space-1)" }}>
        {!isDefault && (
          <button
            type="button"
            style={{ ...tinyBtnStyle, opacity: disabled ? 0.48 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
            onClick={onSetDefault}
            title={t("assets.character.setDefaultExpression")}
            disabled={disabled}
          >
            ★
          </button>
        )}
        <button
          type="button"
          style={{
            ...tinyBtnStyle,
            color: "var(--status-error-text)",
            opacity: disabled ? 0.48 : 1,
            cursor: disabled ? "not-allowed" : "pointer",
          }}
          onClick={onRemove}
          title={t("assets.character.deleteExpression")}
          disabled={disabled}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

function SpriteExprAddForm({
  draft,
  busy,
  onDraftChange,
  onAdd,
  disabled,
  t,
}: {
  draft: string;
  busy: boolean;
  onDraftChange: (v: string) => void;
  onAdd: (expr: string) => void;
  disabled: boolean;
  t: StudioTranslator;
}) {
  return (
    <div style={addFormStyle}>
      <input
        type="text"
        value={draft}
        placeholder={t("assets.character.expressionPlaceholder")}
        onChange={(e) => onDraftChange(e.target.value)}
        disabled={disabled}
        style={fieldInputStyle}
      />
      <button
        type="button"
        style={{ ...smallBtnStyle, opacity: busy || disabled ? 0.5 : 1, cursor: busy || disabled ? "not-allowed" : "pointer" }}
        disabled={disabled || busy}
        onClick={() => onAdd(draft)}
        title={disabled
          ? t("assets.character.importDisabled")
          : t("assets.character.chooseImageHint")}
      >
        {busy ? t("assets.character.importing") : t("assets.character.chooseImage")}
      </button>
    </div>
  );
}

export function spriteExprNameForImport(
  draft: string,
  fileName: string,
  sprites: Record<string, CharacterSpriteRef>,
): string {
  const typed = draft.trim();
  if (typed) return typed;

  if (!Object.prototype.hasOwnProperty.call(sprites, "default")) {
    return "default";
  }

  return uniqueSpriteExprName(safeAssetFileStem(fileStem(fileName)), sprites);
}

function fileStem(fileName: string): string {
  const file = fileName.split(/[/\\]/).pop() ?? fileName;
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(0, dot) : file;
}

function uniqueSpriteExprName(base: string, sprites: Record<string, CharacterSpriteRef>): string {
  const seed = base.trim() || "sprite";
  if (!Object.prototype.hasOwnProperty.call(sprites, seed)) return seed;

  let index = 2;
  let candidate = `${seed}_${index}`;
  while (Object.prototype.hasOwnProperty.call(sprites, candidate)) {
    index += 1;
    candidate = `${seed}_${index}`;
  }
  return candidate;
}

export function safeAssetFileStem(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[\\/]+/g, "_")
    .replace(/\.\.+/g, "_")
    .replace(/[<>:"|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "asset";
}

function omit<T extends Record<string, unknown>>(obj: T, key: string): T {
  const next = { ...obj };
  delete next[key];
  return next;
}

// ── 样式 ──

const workspaceStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "180px 1fr 280px",
  width: "100%",
  height: "100%",
  overflow: "hidden",
};

const listPanelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  borderRight: `1px solid var(--border)`,
  background: "var(--bg-app)",
  overflow: "hidden",
};

const listHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "var(--space-2) var(--space-3)",
  borderBottom: `1px solid var(--border)`,
};

const listStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  overflowY: "auto",
  padding: "var(--space-1) var(--space-2)",
  gap: 2,
};

const rowStyle: React.CSSProperties = {
  textAlign: "left",
  fontSize: "var(--text-base)",
  padding: "var(--space-2) var(--space-2)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid transparent",
  cursor: "pointer",
};

const emptyRowStyle: React.CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--text-muted)",
  padding: "var(--space-2)",
  textAlign: "center",
};

const readOnlyHintStyle: React.CSSProperties = {
  margin: "var(--space-2)",
  padding: "var(--space-2)",
  borderRadius: "var(--radius-sm)",
  border: `1px solid var(--border-error)`,
  background: "var(--bg-error-soft)",
  color: "var(--status-error-text)",
  fontSize: "var(--text-xs)",
  lineHeight: 1.45,
};

const stageStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: "var(--space-5)",
  overflow: "hidden",
};

const stageInnerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "var(--space-3)",
};

const stageImgStyle: React.CSSProperties = {
  maxWidth: "60%",
  maxHeight: 320,
  objectFit: "contain",
};

const stagePlaceholderStyle: React.CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "var(--text-base)",
};

const stageNameStyle: React.CSSProperties = {
  fontSize: "var(--text-lg)",
  fontWeight: 600,
};

const emptyStageStyle: React.CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "var(--text-base)",
};

const propsPanelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-4)",
  padding: "var(--space-4)",
  borderLeft: `1px solid var(--border)`,
  background: "var(--bg-app)",
  overflowY: "auto",
};

const emptyPropsStyle: React.CSSProperties = {
  flex: 1,
};

const propGroupStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
  paddingBottom: "var(--space-3)",
  borderBottom: `1px solid var(--border)`,
};

const panelTitleStyle: React.CSSProperties = {
  fontSize: "var(--text-xs)",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  letterSpacing: 0.5,
};

const fieldLabelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1)",
  fontSize: "var(--text-xs)",
  color: "var(--text-muted)",
};

const fieldInputStyle: React.CSSProperties = {
  fontSize: "var(--text-sm)",
  padding: "var(--space-1) var(--space-2)",
  borderRadius: "var(--radius-xs)",
  border: `1px solid var(--border-input)`,
  background: "var(--bg-app)",
  color: "var(--text-primary)",
  outline: "none",
};

const colorInputStyle: React.CSSProperties = {
  width: 36,
  height: "var(--control-sm)",
  padding: 0,
  border: `1px solid var(--border-input)`,
  borderRadius: "var(--radius-xs)",
  background: "transparent",
  cursor: "pointer",
};

const hexStyle: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: "var(--text-xs)",
  color: "var(--text-muted)",
};

const idStyle: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: "var(--text-xs)",
  color: "var(--text-muted)",
};

const exprRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  padding: "var(--space-1) 0",
};

const exprThumbStyle: React.CSSProperties = {
  width: 44,
  height: 44,
  objectFit: "cover",
  borderRadius: "var(--radius-xs)",
  background: "var(--bg-app)",
  border: `1px solid var(--border)`,
};

const exprThumbPlaceholderStyle: React.CSSProperties = {
  ...exprThumbStyle,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "var(--text-xs)",
  color: "var(--text-muted)",
};

const exprMetaStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  minWidth: 0,
  flex: 1,
};

const exprNameBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-1)",
  fontSize: "var(--text-sm)",
  color: "var(--text-primary)",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  padding: 0,
};

const defaultTagStyle: React.CSSProperties = {
  fontSize: "var(--text-xs)",
  padding: "1px var(--space-1)",
  borderRadius: "var(--radius-xs)",
  background: "var(--tag-narrate-bg)",
  color: "var(--status-ok-text)",
};

const exprPathStyle: React.CSSProperties = {
  fontSize: "var(--text-xs)",
  color: "var(--text-muted)",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const addFormStyle: React.CSSProperties = {
  display: "flex",
  gap: "var(--space-1)",
  marginTop: "var(--space-1)",
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

const tinyBtnStyle: React.CSSProperties = {
  fontSize: "var(--text-sm)",
  width: 22,
  height: 22,
  borderRadius: "var(--radius-xs)",
  border: `1px solid var(--border-input)`,
  background: "var(--bg-app)",
  color: "var(--text-secondary)",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};
