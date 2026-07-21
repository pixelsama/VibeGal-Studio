/**
 * 外观 token 编辑的纯函数层（Spec 17 步骤 3）。
 *
 * 数据流：面板编辑 → 这里的不可变变换产出新 manifest → save_manifest 落盘
 * （带 revision）→ 项目刷新链路 → 预览随 manifest prop 更新。组件层只负责
 * 事件与异步编排，所有 manifest 读写规则都收在这里以便单测。
 *
 * 默认值表来自默认渲染器的 useUiTokens 镜像（导入路径与
 * src/export/defaultRendererUiTokens.test.tsx 一致）；token 协议的权威定义
 * 见 spec 第 4 节，改协议时渲染器与该镜像同步更新。
 */
import type { FileRevision, Manifest } from "../../lib/types";
import { DEFAULT_UI_TOKENS } from "../../../src-tauri/resources/default-renderer/useUiTokens";

// ──────────────────────────────────────────────
// skin 选择（与渲染器消费规则一致，见 Spec 17 §4）
// ──────────────────────────────────────────────

export const DEFAULT_SKIN_ID = "default";

/**
 * 面板编辑目标的 skin id：优先 "default"；没有时回退到第一个条目（此时编辑的
 * 就是渲染器实际回退消费的那个对象，避免写错 skin）；一个都没有 → null（空态）。
 * 与渲染器侧不同的是不 console.warn —— 渲染层挂载时已提示过，面板不重复刷。
 */
export function selectEditableSkinId(manifest: Manifest): string | null {
  const skins = manifest.uiSkins ?? {};
  if (skins[DEFAULT_SKIN_ID]) return DEFAULT_SKIN_ID;
  return Object.keys(skins)[0] ?? null;
}

/** 读取目标 skin 的 token 表（防御性拷贝，调用方可安全改写）。 */
export function readSkinTokens(manifest: Manifest, skinId: string): Record<string, string | number> {
  return { ...(manifest.uiSkins?.[skinId]?.tokens ?? {}) };
}

// ──────────────────────────────────────────────
// manifest 不可变变换
// ──────────────────────────────────────────────

/**
 * 写入/清除一个 token（value === undefined = 清除，回退渲染器默认值）。
 * skin 不存在时原样返回（防御：绝不写到别的 skin 上）。
 */
export function withUiSkinToken(
  manifest: Manifest,
  skinId: string,
  key: string,
  value: string | number | undefined,
): Manifest {
  const skins = manifest.uiSkins ?? {};
  const skin = skins[skinId];
  if (!skin) return manifest;
  const tokens = { ...(skin.tokens ?? {}) };
  if (value === undefined) {
    delete tokens[key];
  } else {
    tokens[key] = value;
  }
  return { ...manifest, uiSkins: { ...skins, [skinId]: { ...skin, tokens } } };
}

/** 空态「启用外观编辑」：补一个 default skin；已存在则不动（不覆盖任何现有条目）。 */
export function withDefaultUiSkin(manifest: Manifest): Manifest {
  const skins = manifest.uiSkins ?? {};
  if (skins[DEFAULT_SKIN_ID]) return manifest;
  return {
    ...manifest,
    uiSkins: {
      ...skins,
      // 字段按 contracts 的 UiSkinSchema 构造（name 可选、assets 必填、tokens 可选）
      [DEFAULT_SKIN_ID]: { name: "默认外观", assets: {}, tokens: {} },
    },
  };
}

/**
 * 舞台拖拽的几何 override 合并：把 `{ "dialogueBox.x": 120, ... }` 覆盖进目标
 * skin 的 tokens，产出带 preview manifest（拖拽过程中逐帧下发，渲染层自然跟手）。
 * overrides 为空或 skin 不存在时原样返回。
 */
export function mergeTokenOverrides(
  manifest: Manifest,
  skinId: string,
  overrides: Record<string, string | number>,
): Manifest {
  if (Object.keys(overrides).length === 0) return manifest;
  const skins = manifest.uiSkins ?? {};
  const skin = skins[skinId];
  if (!skin) return manifest;
  return {
    ...manifest,
    uiSkins: { ...skins, [skinId]: { ...skin, tokens: { ...(skin.tokens ?? {}), ...overrides } } },
  };
}

// ──────────────────────────────────────────────
// 保存结果判定（revision 冲突语义：save_manifest 返回 null = 磁盘已被改写）
// ──────────────────────────────────────────────

export type AppearanceSaveStatus = "saved" | "conflict";

export interface AppearanceSaveOutcome {
  status: AppearanceSaveStatus;
  /** 落盘产生的新 revision（冲突时为 null）；RevisionedProjectMutationQueue 需要它串行携带 */
  revision: FileRevision | null;
}

export async function saveAppearanceManifest(
  saveManifestFn: (
    projectPath: string,
    manifest: Manifest,
    expectedRevision?: FileRevision | null,
  ) => Promise<FileRevision | null>,
  projectPath: string,
  manifest: Manifest,
  expectedRevision?: FileRevision | null,
): Promise<AppearanceSaveOutcome> {
  const revision = await saveManifestFn(projectPath, manifest, expectedRevision);
  return { status: revision === null ? "conflict" : "saved", revision };
}

// ──────────────────────────────────────────────
// token 字段定义（面板分组）与默认值查询
// ──────────────────────────────────────────────

export type TokenFieldKind = "color" | "number" | "checkbox" | "font" | "text";

export interface TokenFieldDef {
  /** 点号 token key，如 "dialogueBox.x" */
  key: string;
  label: string;
  kind: TokenFieldKind;
  /** number 控件的步进与范围提示（输入约束，不替代渲染器解析） */
  step?: number;
  min?: number;
  max?: number;
  /** null 语义键：默认值本身是 null（如"跟随说话人颜色"），提示文案来自 NULL_DEFAULT_HINTS */
  nullable?: boolean;
}

export interface TokenGroupDef {
  id: string;
  title: string;
  fields: TokenFieldDef[];
}

export const APPEARANCE_TOKEN_GROUPS: TokenGroupDef[] = [
  {
    id: "dialogueBox",
    title: "对话框",
    fields: [
      { key: "dialogueBox.x", label: "X", kind: "number", step: 1 },
      { key: "dialogueBox.y", label: "Y", kind: "number", step: 1 },
      { key: "dialogueBox.width", label: "宽", kind: "number", step: 1, min: 0 },
      { key: "dialogueBox.height", label: "高", kind: "number", step: 1, min: 0 },
      { key: "dialogueBox.bgColor", label: "背景色", kind: "color", nullable: true },
      { key: "dialogueBox.bgOpacity", label: "不透明度", kind: "number", step: 0.05, min: 0, max: 1, nullable: true },
      { key: "dialogueBox.radius", label: "圆角", kind: "number", step: 1, min: 0 },
      { key: "dialogueBox.padding", label: "内边距", kind: "text" },
      { key: "dialogueBox.borderColor", label: "边框色", kind: "color", nullable: true },
      { key: "dialogueBox.textColor", label: "文字色", kind: "color" },
      { key: "dialogueBox.fontSize", label: "字号", kind: "number", step: 1, min: 1 },
      { key: "dialogueBox.fontFamily", label: "字体", kind: "font" },
      { key: "dialogueBox.lineHeight", label: "行高", kind: "number", step: 0.5, min: 1 },
    ],
  },
  {
    id: "nameBox",
    title: "名字框",
    fields: [
      { key: "nameBox.x", label: "X", kind: "number", step: 1 },
      { key: "nameBox.y", label: "Y", kind: "number", step: 1 },
      { key: "nameBox.width", label: "宽", kind: "number", step: 1, min: 0, nullable: true },
      { key: "nameBox.height", label: "高", kind: "number", step: 1, min: 0, nullable: true },
      { key: "nameBox.bgColor", label: "背景色", kind: "color", nullable: true },
      { key: "nameBox.textColor", label: "文字色", kind: "color" },
      { key: "nameBox.fontSize", label: "字号", kind: "number", step: 1, min: 1 },
      { key: "nameBox.visible", label: "显示", kind: "checkbox" },
    ],
  },
  {
    id: "choiceBox",
    title: "选项区",
    fields: [
      { key: "choiceBox.x", label: "X", kind: "number", step: 1 },
      { key: "choiceBox.y", label: "Y", kind: "number", step: 1 },
      { key: "choiceBox.width", label: "宽", kind: "number", step: 1, min: 0 },
      { key: "choiceBox.height", label: "限高", kind: "number", step: 1, min: 0, nullable: true },
    ],
  },
  {
    id: "choiceButton",
    title: "选项按钮",
    fields: [
      { key: "choiceButton.bgColor", label: "背景色", kind: "color" },
      { key: "choiceButton.textColor", label: "文字色", kind: "color" },
      { key: "choiceButton.hoverColor", label: "悬停色", kind: "color" },
      { key: "choiceButton.hoverTextColor", label: "悬停文字色", kind: "color" },
      { key: "choiceButton.radius", label: "圆角", kind: "number", step: 1, min: 0 },
      { key: "choiceButton.fontSize", label: "字号", kind: "number", step: 1, min: 1 },
    ],
  },
  {
    id: "hud",
    title: "HUD",
    fields: [
      { key: "hud.x", label: "X", kind: "number", step: 1, nullable: true },
      { key: "hud.y", label: "Y", kind: "number", step: 1, nullable: true },
      { key: "hud.textColor", label: "文字色", kind: "color" },
      { key: "hud.bgColor", label: "底色", kind: "color" },
      { key: "hud.fontSize", label: "字号", kind: "number", step: 1, min: 1 },
      { key: "hud.visible", label: "显示", kind: "checkbox" },
    ],
  },
  {
    id: "menuWindow",
    title: "菜单窗口",
    fields: [
      { key: "menuWindow.x", label: "X", kind: "number", step: 1 },
      { key: "menuWindow.y", label: "Y", kind: "number", step: 1 },
      { key: "menuWindow.width", label: "宽", kind: "number", step: 1, min: 0 },
      { key: "menuWindow.height", label: "高", kind: "number", step: 1, min: 0 },
    ],
  },
  {
    id: "titleScreen",
    title: "标题画面",
    fields: [
      { key: "titleScreen.x", label: "X", kind: "number", step: 1 },
      { key: "titleScreen.y", label: "Y", kind: "number", step: 1 },
      { key: "titleScreen.width", label: "宽", kind: "number", step: 1, min: 0 },
      { key: "titleScreen.height", label: "高", kind: "number", step: 1, min: 0 },
      { key: "titleScreen.bgColor", label: "背景色", kind: "color", nullable: true },
      { key: "titleScreen.bgOpacity", label: "不透明度", kind: "number", step: 0.05, min: 0, max: 1, nullable: true },
      { key: "titleScreen.titleColor", label: "标题色", kind: "color" },
      { key: "titleScreen.titleFontSize", label: "标题字号", kind: "number", step: 1, min: 1 },
      { key: "titleScreen.titleFontFamily", label: "标题字体", kind: "font" },
    ],
  },
  {
    id: "titleScreenButton",
    title: "标题按钮",
    fields: [
      { key: "titleScreen.buttonBgColor", label: "背景色", kind: "color" },
      { key: "titleScreen.buttonTextColor", label: "文字色", kind: "color" },
      { key: "titleScreen.buttonHoverColor", label: "悬停色", kind: "color" },
      { key: "titleScreen.buttonRadius", label: "圆角", kind: "number", step: 1, min: 0 },
      { key: "titleScreen.buttonFontSize", label: "字号", kind: "number", step: 1, min: 1 },
    ],
  },
  {
    id: "stage",
    title: "舞台",
    fields: [{ key: "stage.fontFamily", label: "全局字体", kind: "font" }],
  },
];

// ──────────────────────────────────────────────
// 选中部件 → 属性分组过滤（inspector 模式）
// ──────────────────────────────────────────────

/**
 * 部件名 → 展示的分组 id 列表。choiceBox 带按钮样式组（选项区管几何，
 * 选项按钮管配色），titleScreen 带标题按钮样式组，其余部件一对一；
 * null（未选中）= 全部分组。
 */
const PART_TOKEN_GROUP_IDS: Record<string, string[]> = {
  dialogueBox: ["dialogueBox"],
  nameBox: ["nameBox"],
  choiceBox: ["choiceBox", "choiceButton"],
  hud: ["hud"],
  menuWindow: ["menuWindow"],
  titleScreen: ["titleScreen", "titleScreenButton"],
};

/**
 * 按选中部件过滤属性分组：
 * - null → 全部分组（含「舞台」全局组）；
 * - 已知部件 → 该部件的分组（choiceBox 连按钮样式组）；
 * - 未知部件（第三方渲染器的自定义 data-ui-part）→ 合成一个几何分组
 *   （x/y/width/height），拖拽落盘的 token 由此也能手动编辑。
 */
export function tokenGroupsForPart(part: string | null): TokenGroupDef[] {
  if (part === null) return APPEARANCE_TOKEN_GROUPS;
  const ids = PART_TOKEN_GROUP_IDS[part];
  if (!ids) {
    return [
      {
        id: part,
        title: `${part}（几何）`,
        fields: [
          { key: `${part}.x`, label: "X", kind: "number", step: 1 },
          { key: `${part}.y`, label: "Y", kind: "number", step: 1 },
          { key: `${part}.width`, label: "宽", kind: "number", step: 1, min: 0 },
          { key: `${part}.height`, label: "高", kind: "number", step: 1, min: 0 },
        ],
      },
    ];
  }
  return APPEARANCE_TOKEN_GROUPS.filter((group) => ids.includes(group.id));
}

/** DEFAULT_UI_TOKENS（嵌套结构）→ 点号 key 的扁平默认值表。 */
function flattenDefaultTokens(): Record<string, string | number> {
  const d = DEFAULT_UI_TOKENS;
  return {
    "dialogueBox.x": d.dialogueBox.x,
    "dialogueBox.y": d.dialogueBox.y,
    "dialogueBox.width": d.dialogueBox.width,
    "dialogueBox.height": d.dialogueBox.height,
    "dialogueBox.radius": d.dialogueBox.radius,
    "dialogueBox.padding": d.dialogueBox.padding,
    "dialogueBox.textColor": d.dialogueBox.textColor,
    "dialogueBox.fontSize": d.dialogueBox.fontSize,
    "dialogueBox.fontFamily": d.dialogueBox.fontFamily,
    "dialogueBox.lineHeight": d.dialogueBox.lineHeight,
    "nameBox.x": d.nameBox.x,
    "nameBox.y": d.nameBox.y,
    "nameBox.textColor": d.nameBox.textColor,
    "nameBox.fontSize": d.nameBox.fontSize,
    "choiceBox.x": d.choiceBox.x,
    "choiceBox.y": d.choiceBox.y,
    "choiceBox.width": d.choiceBox.width,
    "choiceButton.bgColor": d.choiceButton.bgColor,
    "choiceButton.textColor": d.choiceButton.textColor,
    "choiceButton.hoverColor": d.choiceButton.hoverColor,
    "choiceButton.hoverTextColor": d.choiceButton.hoverTextColor,
    "choiceButton.radius": d.choiceButton.radius,
    "choiceButton.fontSize": d.choiceButton.fontSize,
    "hud.textColor": d.hud.textColor,
    "hud.bgColor": d.hud.bgColor,
    "hud.fontSize": d.hud.fontSize,
    "menuWindow.x": d.menuWindow.x,
    "menuWindow.y": d.menuWindow.y,
    "menuWindow.width": d.menuWindow.width,
    "menuWindow.height": d.menuWindow.height,
    "titleScreen.x": d.titleScreen.x,
    "titleScreen.y": d.titleScreen.y,
    "titleScreen.width": d.titleScreen.width,
    "titleScreen.height": d.titleScreen.height,
    "titleScreen.titleColor": d.titleScreen.titleColor,
    "titleScreen.titleFontSize": d.titleScreen.titleFontSize,
    "titleScreen.titleFontFamily": d.titleScreen.titleFontFamily,
    "titleScreen.buttonBgColor": d.titleScreen.buttonBgColor,
    "titleScreen.buttonTextColor": d.titleScreen.buttonTextColor,
    "titleScreen.buttonHoverColor": d.titleScreen.buttonHoverColor,
    "titleScreen.buttonRadius": d.titleScreen.buttonRadius,
    "titleScreen.buttonFontSize": d.titleScreen.buttonFontSize,
    "stage.fontFamily": d.stageFontFamily,
  };
}

const TOKEN_DEFAULT_VALUES = flattenDefaultTokens();

/** null 语义键的默认行为说明（placeholder 用；协议见 spec 第 4 节）。 */
const NULL_DEFAULT_HINTS: Record<string, string> = {
  "dialogueBox.bgColor": "内置磨砂白",
  "dialogueBox.bgOpacity": "仅配背景色生效",
  "dialogueBox.borderColor": "发丝白边",
  "nameBox.width": "auto（随内容）",
  "nameBox.height": "auto（随内容）",
  "nameBox.bgColor": "跟随说话人颜色",
  "choiceBox.height": "自动（约 42% 舞台高）",
  "hud.x": "右上锚定（右缘 16px）",
  "hud.y": "顶部 14px",
  "titleScreen.bgColor": "内置磨砂白",
  "titleScreen.bgOpacity": "仅配背景色生效",
};

/** 输入框 placeholder：显示该 token 的默认值（null 语义键显示行为说明）。 */
export function tokenDefaultPlaceholder(key: string): string {
  const hint = NULL_DEFAULT_HINTS[key];
  if (hint) return `默认：${hint}`;
  const value = TOKEN_DEFAULT_VALUES[key];
  return value === undefined ? "默认" : `默认：${String(value)}`;
}

/**
 * visible 类 token 的勾选状态，规则与渲染器 tokenVisible 一致：
 * 缺失 = 默认（true）；0 / "0" / "false" / "" = 隐藏；其余真值 = 显示。
 */
export function tokenVisibleChecked(tokens: Record<string, string | number>, key: string, fallback = true): boolean {
  const value = tokens[key];
  if (value === undefined) return fallback;
  if (typeof value === "number") return value !== 0;
  const normalized = value.trim().toLowerCase();
  return normalized !== "" && normalized !== "0" && normalized !== "false";
}

/**
 * 勾选框编辑：勾选 = 清除 token 回退默认（显示）；取消勾选 = 写 0（隐藏）。
 * 这样 manifest 里只保留非默认值，数据最干净。
 */
export function visibleTokenEditValue(checked: boolean): number | undefined {
  return checked ? undefined : 0;
}

/** 色板用的 #rrggbb 提取：只认 #rgb/#rrggbb，rgba()/渐变等返回 null（色板显示占位色）。 */
export function hexColorOrNull(value: string | number | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
}
