/**
 * CharacterEditor —— 角色 section 的两级编辑器（Spec 33 E7/§6.3）。
 *
 * 一级（卡片网格）：每个角色一张角色卡片（名字 + 默认立绘缩略图 + 颜色），
 * 「＋ 新建角色」入口；不再直接接管整个主区，侧栏分类保持常驻。
 * 二级（双栏编辑页）：点击卡片进入 —— 左预览舞台，右属性面板（
 * name/color 可编辑 + sprite 表情列表：加/删/设默认/重命名），顶部返回按钮。
 *
 * 所有改动通过 onChange(manifest) 上抛为父组件本地草稿，由父组件落盘。
 */
import { useState } from "react";
import { ArrowLeft, UserRoundPlus, X } from "lucide-react";
import type { Manifest, ManifestCharacter, CharacterSpriteRef } from "../../lib/types";
import { useStudioI18n, translateZhCN, type StudioTranslator } from "../../lib/i18n";
import { deleteAsset, importAsset, pickAssetFiles } from "../../lib/tauri";
import { Button } from "../common/Button";
import { ConfirmDialog } from "../common/Dialogs";
import { EmptyState } from "../common/EmptyState";
import type { ToastInput } from "../common/Toast";
import { AssetImagePreview } from "./AssetImagePreview";
import { characterSpriteAssetPaths } from "./assetUsage";

interface CharacterEditorProps {
  projectPath: string;
  manifest: Manifest;
  onChange: (manifest: Manifest) => void;
  onFeedback?: (toast: ToastInput) => void;
  disabled?: boolean;
}

export function CharacterEditor({ projectPath, manifest, onChange, onFeedback, disabled = false }: CharacterEditorProps) {
  const { t } = useStudioI18n();
  // 卡片网格（null）↔ 双栏编辑页（角色 id）两级切换
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newExprDraft, setNewExprDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // 删角色/删表情现在级联清理磁盘文件（Spec 33 A5），属破坏性操作，须先确认。
  const [deleteConfirm, setDeleteConfirm] = useState<{
    kind: "character" | "expression";
    characterId: string;
    expr?: string;
    fileCount: number;
  } | null>(null);
  // 磁盘操作（导入/级联删除）进行中禁用一切编辑入口，防止旧快照覆盖新改动。
  const interactiveDisabled = disabled || busy;

  const editing = editingId ? manifest.characters[editingId] : undefined;

  function updateCharacter(id: string, patch: Partial<ManifestCharacter>) {
    if (interactiveDisabled) return;
    const prev = manifest.characters[id];
    if (!prev) return;
    onChange({
      ...manifest,
      characters: { ...manifest.characters, [id]: { ...prev, ...patch } },
    });
  }

  function addCharacter() {
    if (interactiveDisabled) return;
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
    setEditingId(id);
  }

  /** 某角色所有立绘文件的去重磁盘路径（atlas 引用只算 fallback，不删共享 atlas 图）。 */
  function characterSpriteFiles(id: string): string[] {
    const char = manifest.characters[id];
    if (!char) return [];
    const paths = new Set<string>();
    for (const sprite of Object.values(char.sprites)) {
      for (const path of characterSpriteAssetPaths(sprite)) paths.add(path);
    }
    return [...paths];
  }

  // 删角色：级联清理该角色所有立绘文件（Spec 33 A5）。先确认。
  function deleteCharacter(id: string) {
    if (interactiveDisabled) return;
    const char = manifest.characters[id];
    if (!char) return;
    setDeleteConfirm({
      kind: "character",
      characterId: id,
      fileCount: characterSpriteFiles(id).length,
    });
  }

  async function performCharacterDelete(id: string) {
    setBusy(true);
    try {
      const files = characterSpriteFiles(id);
      const failed: string[] = [];
      for (const relPath of files) {
        try {
          await deleteAsset(projectPath, relPath);
        } catch {
          failed.push(relPath);
        }
      }
      const next = { ...manifest.characters };
      delete next[id];
      onChange({ ...manifest, characters: next });
      if (editingId === id) {
        setEditingId(null);
      }
      if (failed.length > 0) {
        onFeedback?.(createCharacterSpriteDeleteFailureToast(failed.length, files.length, t));
      }
    } finally {
      setBusy(false);
    }
  }

  async function addSpriteExpr(id: string, expr: string) {
    if (interactiveDisabled) return;
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

  // 删表情：级联清理该表情对应的立绘文件（Spec 33 A5）。先确认。
  function removeSpriteExpr(id: string, expr: string) {
    if (interactiveDisabled) return;
    const char = manifest.characters[id];
    if (!char || !char.sprites[expr]) return;
    setDeleteConfirm({
      kind: "expression",
      characterId: id,
      expr,
      fileCount: characterSpriteAssetPaths(char.sprites[expr]).length,
    });
  }

  async function performSpriteExprDelete(id: string, expr: string) {
    setBusy(true);
    try {
      const char = manifest.characters[id];
      if (!char || !char.sprites[expr]) return;
      const files = characterSpriteAssetPaths(char.sprites[expr]);
      const failed: string[] = [];
      for (const relPath of files) {
        try {
          await deleteAsset(projectPath, relPath);
        } catch {
          failed.push(relPath);
        }
      }
      const next = { ...char.sprites };
      delete next[expr];
      updateCharacter(id, { sprites: next });
      if (failed.length > 0) {
        onFeedback?.(createCharacterSpriteDeleteFailureToast(failed.length, files.length, t));
      }
    } finally {
      setBusy(false);
    }
  }

  function renameSpriteExpr(id: string, oldExpr: string, newExpr: string) {
    if (interactiveDisabled) return;
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
    <div style={rootStyle}>
      {editingId && editing ? (
        <CharacterDetailEditor
          characterId={editingId}
          char={editing}
          projectPath={projectPath}
          interactiveDisabled={interactiveDisabled}
          onChange={(patch) => updateCharacter(editingId, patch)}
          onDelete={() => deleteCharacter(editingId)}
          onBack={() => setEditingId(null)}
          newExprDraft={newExprDraft[editingId] ?? ""}
          busy={busy}
          onExprDraftChange={(v) => setNewExprDraft((d) => ({ ...d, [editingId]: v }))}
          onAddExpr={(expr) => void addSpriteExpr(editingId, expr)}
          onRenameExpr={(oldExpr, newExpr) => renameSpriteExpr(editingId, oldExpr, newExpr)}
          onRemoveExpr={(expr) => removeSpriteExpr(editingId, expr)}
          onSetDefaultExpr={(expr) => {
            if (interactiveDisabled) return;
            if (expr === "default") return;
            const reordered = { default: editing.sprites[expr], ...omit(editing.sprites, expr) };
            updateCharacter(editingId, { sprites: reordered });
          }}
          t={t}
        />
      ) : (
        <CharacterGrid
          characters={manifest.characters}
          projectPath={projectPath}
          disabled={interactiveDisabled}
          onSelect={setEditingId}
          onAdd={addCharacter}
        />
      )}
      {deleteConfirm && (
        <ConfirmDialog
          message={deleteConfirm.kind === "character"
            ? t("assets.character.deleteConfirm", {
                name: manifest.characters[deleteConfirm.characterId]?.name ?? deleteConfirm.characterId,
                count: deleteConfirm.fileCount,
              })
            : t("assets.character.deleteExpressionConfirm", {
                expr: deleteConfirm.expr ?? "",
                count: deleteConfirm.fileCount,
              })}
          confirmLabel={t("assets.delete")}
          danger
          onConfirm={() => {
            const pending = deleteConfirm;
            setDeleteConfirm(null);
            if (!pending) return;
            if (pending.kind === "character") {
              void performCharacterDelete(pending.characterId);
            } else if (pending.expr !== undefined) {
              void performSpriteExprDelete(pending.characterId, pending.expr);
            }
          }}
          onClose={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  );
}

/** 角色默认表情（default sprite）的磁盘路径；无默认表情返回 null。 */
function characterDefaultSpritePath(char: ManifestCharacter): string | null {
  const defaultSprite = char.sprites.default;
  return defaultSprite
    ? typeof defaultSprite === "string" ? defaultSprite : defaultSprite.fallback
    : null;
}

/** 一级视图：角色卡片网格。每张卡片 = 名字 + 默认立绘缩略图 + 颜色标识。 */
function CharacterGrid({
  characters,
  projectPath,
  disabled,
  onSelect,
  onAdd,
}: {
  characters: Manifest["characters"];
  projectPath: string;
  disabled: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  const { t } = useStudioI18n();
  const ids = Object.keys(characters);
  return (
    <div style={gridRootStyle}>
      <div style={gridHeaderStyle}>
        <span style={panelTitleStyle}>{t("assets.character.title")}</span>
        <button
          type="button"
          style={{ ...smallBtnStyle, opacity: disabled ? 0.48 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
          onClick={onAdd}
          disabled={disabled}
          title={disabled ? t("assets.character.editDisabledTitle") : undefined}
        >
          {t("assets.character.new")}
        </button>
      </div>
      {disabled && <div style={readOnlyHintStyle}>{t("assets.character.editDisabled")}</div>}
      {ids.length === 0 ? (
        <div style={gridEmptyStyle}>
          <EmptyState
            icon={UserRoundPlus}
            title={t("assets.character.emptyTitle")}
            description={t("assets.character.emptyDescription")}
            action={!disabled ? <Button variant="primary" onClick={onAdd}>{t("assets.character.createFirst")}</Button> : undefined}
          />
        </div>
      ) : (
        <div style={cardGridStyle}>
          {ids.map((id) => (
            <CharacterCard
              key={id}
              id={id}
              char={characters[id]}
              projectPath={projectPath}
              disabled={disabled}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CharacterCard({
  id,
  char,
  projectPath,
  disabled,
  onSelect,
}: {
  id: string;
  char: ManifestCharacter;
  projectPath: string;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const { t } = useStudioI18n();
  const defaultPath = characterDefaultSpritePath(char);
  return (
    <button
      type="button"
      style={cardStyle}
      onClick={() => onSelect(id)}
      disabled={disabled}
      title={char.name || id}
    >
      <div style={cardPreviewStyle}>
        {defaultPath ? (
          <AssetImagePreview
            projectPath={projectPath}
            relPath={defaultPath}
            alt={char.name}
            style={cardImgStyle}
            placeholderStyle={cardPlaceholderStyle}
          />
        ) : (
          <span style={cardPlaceholderStyle}>{t("assets.character.noDefaultExpression")}</span>
        )}
      </div>
      <div style={cardMetaStyle}>
        <span style={{ ...cardNameStyle, color: char.color }}>{char.name || id}</span>
      </div>
    </button>
  );
}

/** 二级视图：双栏编辑页（左预览舞台 / 右属性面板），顶部返回按钮回卡片网格。 */
export function CharacterDetailEditor({
  characterId,
  char,
  projectPath,
  interactiveDisabled,
  onChange,
  onDelete,
  onBack,
  newExprDraft,
  busy,
  onExprDraftChange,
  onAddExpr,
  onRenameExpr,
  onRemoveExpr,
  onSetDefaultExpr,
  t,
}: {
  characterId: string;
  char: ManifestCharacter;
  projectPath: string;
  interactiveDisabled: boolean;
  onChange: (patch: Partial<ManifestCharacter>) => void;
  onDelete: () => void;
  onBack: () => void;
  newExprDraft: string;
  busy: boolean;
  onExprDraftChange: (v: string) => void;
  onAddExpr: (expr: string) => void;
  onRenameExpr: (oldExpr: string, newExpr: string) => void;
  onRemoveExpr: (expr: string) => void;
  onSetDefaultExpr: (expr: string) => void;
  t: StudioTranslator;
}) {
  return (
    <div style={detailRootStyle}>
      <div style={detailHeaderStyle}>
        <button type="button" style={backButtonStyle} onClick={onBack}>
          <ArrowLeft size={14} />
          {t("assets.character.back")}
        </button>
        <span style={{ ...detailTitleStyle, color: char.color }}>{char.name || characterId}</span>
      </div>
      <div style={detailBodyStyle}>
        {/* 左：预览舞台 */}
        <div style={stageStyle}>
          <CharacterStage char={char} projectPath={projectPath} t={t} />
        </div>

        {/* 右：属性面板 */}
        <div style={propsPanelStyle}>
          <div style={propGroupStyle}>
            <div style={panelTitleStyle}>{t("assets.character.basic")}</div>
            <label style={fieldLabelStyle}>
              {t("assets.character.name")}
              <input
                type="text"
                value={char.name}
                onChange={(e) => onChange({ name: e.target.value })}
                disabled={interactiveDisabled}
                style={fieldInputStyle}
              />
            </label>
            <label style={fieldLabelStyle}>
              {t("assets.character.color")}
              <input
                type="color"
                value={char.color}
                onChange={(e) => onChange({ color: e.target.value })}
                disabled={interactiveDisabled}
                style={colorInputStyle}
              />
              <span style={hexStyle}>{char.color}</span>
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                style={{
                  ...smallBtnStyle,
                  color: "var(--status-error-text)",
                  opacity: interactiveDisabled ? 0.48 : 1,
                  cursor: interactiveDisabled ? "not-allowed" : "pointer",
                }}
                onClick={onDelete}
                disabled={interactiveDisabled}
              >
                {t("assets.character.delete")}
              </button>
            </div>
          </div>

          <div style={propGroupStyle}>
            <div style={panelTitleStyle}>{t("assets.character.expressions")}</div>
            {Object.entries(char.sprites).map(([expr, sprite]) => (
              <SpriteExprRow
                key={expr}
                expr={expr}
                sprite={sprite}
                projectPath={projectPath}
                isDefault={expr === "default"}
                onRename={(newExpr) => onRenameExpr(expr, newExpr)}
                onRemove={() => onRemoveExpr(expr)}
                onSetDefault={() => onSetDefaultExpr(expr)}
                disabled={interactiveDisabled}
                t={t}
              />
            ))}
            <SpriteExprAddForm
              draft={newExprDraft}
              busy={busy}
              onDraftChange={onExprDraftChange}
              onAdd={onAddExpr}
              disabled={interactiveDisabled}
              t={t}
            />
          </div>

          <div style={propGroupStyle}>
            <div style={panelTitleStyle}>{t("assets.character.advanced")}</div>
            <div style={idStyle}>id: {characterId}</div>
          </div>
        </div>
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

/** 级联删除立绘文件时部分文件未能移除（登记表已更新，磁盘残留待用户在资源页处理）。 */
export function createCharacterSpriteDeleteFailureToast(
  failedCount: number,
  totalCount: number,
  t: StudioTranslator = translateZhCN,
): ToastInput {
  return {
    kind: "error",
    message: t("assets.character.deleteFileFailed"),
    detail: t("assets.character.deleteFileFailedDetail", { failed: failedCount, total: totalCount }),
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
  const defaultPath = characterDefaultSpritePath(char);
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

const rootStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  overflow: "hidden",
  position: "relative",
};

// 一级：卡片网格
const gridRootStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  overflow: "hidden",
};

const gridHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "var(--space-2) var(--space-3)",
  borderBottom: `1px solid var(--border)`,
};

const gridEmptyStyle: React.CSSProperties = {
  display: "grid",
  placeItems: "center",
  flex: 1,
  overflowY: "auto",
};

const cardGridStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-3)",
  padding: "var(--space-3)",
  overflowY: "auto",
  alignContent: "flex-start",
};

const cardStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: 160,
  borderRadius: "var(--radius-md)",
  border: `1px solid var(--border)`,
  background: "var(--bg-panel)",
  overflow: "hidden",
  cursor: "pointer",
  padding: 0,
  textAlign: "left",
};

const cardPreviewStyle: React.CSSProperties = {
  position: "relative",
  width: "100%",
  aspectRatio: "4 / 3",
  background: "var(--bg-app)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const cardImgStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

const cardPlaceholderStyle: React.CSSProperties = {
  fontSize: "var(--text-xs)",
  color: "var(--text-muted)",
  padding: "var(--space-2)",
};

const cardMetaStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1)",
  padding: "var(--space-2) var(--space-3)",
};

const cardNameStyle: React.CSSProperties = {
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

// 二级：双栏编辑页
const detailRootStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: "100%",
  height: "100%",
  overflow: "hidden",
};

const detailHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  padding: "var(--space-2) var(--space-3)",
  borderBottom: `1px solid var(--border)`,
  background: "var(--bg-app)",
  flexShrink: 0,
};

const backButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-1)",
  fontSize: "var(--text-sm)",
  padding: "var(--space-1) var(--space-2)",
  borderRadius: "var(--radius-xs)",
  border: `1px solid var(--border-input)`,
  background: "var(--bg-app)",
  color: "var(--text-secondary)",
  cursor: "pointer",
};

const detailTitleStyle: React.CSSProperties = {
  fontSize: "var(--text-lg)",
  fontWeight: 600,
};

const detailBodyStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 280px",
  flex: 1,
  overflow: "hidden",
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

const propsPanelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-4)",
  padding: "var(--space-4)",
  borderLeft: `1px solid var(--border)`,
  background: "var(--bg-app)",
  overflowY: "auto",
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
