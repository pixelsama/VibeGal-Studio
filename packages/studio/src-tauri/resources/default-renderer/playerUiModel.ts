import type {
  NovelState,
  RuntimeRestoreResult,
  RuntimeServices,
  RuntimeSettingsRecord,
  SavePreview,
  SaveSlotSummary,
} from "@vibegal/engine";

export const MANUAL_SLOT_IDS = Array.from(
  { length: 12 },
  (_, index) => `manual-${String(index + 1).padStart(2, "0")}`,
);

export const PLAYER_MENU_PAGES = [
  { id: "save", label: "存档 / 读档" },
  { id: "history", label: "历史" },
  { id: "gallery", label: "CG Gallery" },
  { id: "replay", label: "回想" },
  { id: "music", label: "音乐鉴赏" },
  { id: "endings", label: "结局列表" },
  { id: "settings", label: "设置" },
  { id: "system", label: "系统" },
] as const;

export type PlayerMenuPage = (typeof PLAYER_MENU_PAGES)[number]["id"];
export type PlayerSlotKind = "quick" | "auto" | "manual";

/**
 * uiHint 面板 id（Spec 17 第 4.1 节）：fixture 宿主在挂载渲染层前设置
 * `window.__VIBEGAL_FIXTURE_UI__ = { panel: "<id>" }`，渲染层把它当作初始 UI 状态。
 * gallery-* 四个 id 映射到对应的 Gallery 菜单页。
 */
export type FixtureUiPanelId =
  | "save"
  | "history"
  | "settings"
  | "gallery-cg"
  | "gallery-replay"
  | "gallery-music"
  | "gallery-endings";

/** 标题门初始屏（Spec 21 第 4 节）：title = 标题画面；story = 直接呈现剧情。 */
export type TitleGateScreen = "title" | "story";

const FIXTURE_UI_PANEL_PAGES: Record<FixtureUiPanelId, PlayerMenuPage> = {
  save: "save",
  history: "history",
  settings: "settings",
  "gallery-cg": "gallery",
  "gallery-replay": "replay",
  "gallery-music": "music",
  "gallery-endings": "endings",
};

/** 结构化读取一次 uiHint 全局（SSR / 非浏览器环境安全返回 undefined）。 */
function readFixtureUiHint(): { panel?: unknown; screen?: unknown } | undefined {
  if (typeof window === "undefined") return undefined;
  const hint = (window as { __VIBEGAL_FIXTURE_UI__?: unknown }).__VIBEGAL_FIXTURE_UI__;
  if (!hint || typeof hint !== "object") return undefined;
  return hint as { panel?: unknown; screen?: unknown };
}

function fixtureUiHintMenuPage(hint: { panel?: unknown } | undefined): PlayerMenuPage | null {
  const panel = hint?.panel;
  if (typeof panel !== "string") return null;
  return (FIXTURE_UI_PANEL_PAGES as Record<string, PlayerMenuPage>)[panel] ?? null;
}

/**
 * 读取一次 uiHint（仅在挂载时调用）：无该全局、结构非法或 panel 未知时返回 null，
 * 此时行为与现状完全一致。SSR / 非浏览器环境下安全返回 null。
 */
export function readFixtureUiHintMenuPage(): PlayerMenuPage | null {
  return fixtureUiHintMenuPage(readFixtureUiHint());
}

/**
 * 标题门初始屏判定（Spec 21 第 4 节语义表，仅在挂载时调用一次）：
 * - 全局不存在（真实启动）→ "title"；
 * - `{ screen: "title" }` → "title"；
 * - `{ screen: "story" }` 或携带合法 panel → "story"（panel 语义蕴含 story）；
 * - 其它非法结构 → "title"（按真实启动退化）。
 */
export function readFixtureUiHintScreen(): TitleGateScreen {
  const hint = readFixtureUiHint();
  if (hint?.screen === "title") return "title";
  if (hint?.screen === "story") return "story";
  if (fixtureUiHintMenuPage(hint) !== null) return "story";
  return "title";
}

export interface PlayerSlotView {
  slotId: string;
  kind: PlayerSlotKind;
  empty: boolean;
  label: string;
  canSave: boolean;
  canLoad: boolean;
  canDelete: boolean;
  summary?: SaveSlotSummary;
}

export interface RuntimeErrorDetails {
  code: string;
  message: string;
}

export class PlayerUiError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PlayerUiError";
  }
}

export function buildPlayerSlots(summaries: SaveSlotSummary[]): PlayerSlotView[] {
  const byId = new Map(summaries.map((summary) => [summary.slotId, summary]));
  const definitions: Array<{ slotId: string; kind: PlayerSlotKind; label: string }> = [
    { slotId: "quick", kind: "quick", label: "快速存档" },
    { slotId: "auto:node", kind: "auto", label: "节点自动存档" },
    { slotId: "auto:choice", kind: "auto", label: "选择自动存档" },
    ...MANUAL_SLOT_IDS.map((slotId, index) => ({
      slotId,
      kind: "manual" as const,
      label: `手动存档 ${String(index + 1).padStart(2, "0")}`,
    })),
  ];

  return definitions.map((definition) => {
    const summary = byId.get(definition.slotId);
    const empty = summary == null;
    return {
      ...definition,
      empty,
      label: summary?.label ?? definition.label,
      canSave: definition.kind !== "auto",
      canLoad: !empty,
      canDelete: !empty && definition.kind !== "auto",
      summary,
    };
  });
}

/**
 * 「继续游戏」的存档选择策略（Spec 21 §5 定点）：取 updatedAt 最新的槽位直进，
 * 含 auto/quick 槽——auto 槽按节点持续写，最新槽即"上次玩到的位置"。
 * updatedAt 是 ISO 时间串，字典序即时间序；空列表返回 null（按钮禁用）。
 */
export function pickContinueSlot(summaries: SaveSlotSummary[]): SaveSlotSummary | null {
  let latest: SaveSlotSummary | null = null;
  for (const summary of summaries) {
    if (latest === null || summary.updatedAt > latest.updatedAt) latest = summary;
  }
  return latest;
}

/** 存档时间的展示格式（标题页「继续游戏」副标题）：ISO → "YYYY-MM-DD HH:mm"（UTC 口径，跨时区确定性）。 */
export function formatSlotTime(updatedAt: string): string {
  const normalized = updatedAt.slice(0, 16).replace("T", " ");
  return normalized || updatedAt;
}

export function createCurrentSavePreview(state: NovelState): SavePreview {
  const text = state.dialogue?.text ?? state.narration?.text;
  return {
    ...(text ? { text } : {}),
    background: state.background,
  };
}

export function runtimeErrorDetails(error: unknown): RuntimeErrorDetails {
  if (error && typeof error === "object") {
    const record = error as { code?: unknown; message?: unknown };
    return {
      code: typeof record.code === "string" ? record.code : "runtime_operation_failed",
      message: typeof record.message === "string" ? record.message : "运行时操作失败。",
    };
  }
  return {
    code: "runtime_operation_failed",
    message: typeof error === "string" ? error : "运行时操作失败。",
  };
}

export function isPlayerShortcutTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const element = target as {
    tagName?: string;
    isContentEditable?: boolean;
    getAttribute?: (name: string) => string | null;
  };
  const tagName = element.tagName?.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select" || tagName === "button") {
    return true;
  }
  return element.isContentEditable === true || element.getAttribute?.("role") === "textbox";
}

export class PlayerUiController {
  private active = false;

  constructor(
    private readonly runtime: RuntimeServices,
    private readonly getState: () => NovelState,
    private readonly onBusyChange: (busy: boolean) => void = () => {},
  ) {}

  get busy(): boolean {
    return this.active;
  }

  listSlots(): Promise<PlayerSlotView[]> {
    return this.run(async () => buildPlayerSlots(await this.runtime.save.listSlots()));
  }

  save(slotId: string, label: string): Promise<SaveSlotSummary> {
    return this.run(() => this.runtime.save.save(slotId, {
      label,
      preview: createCurrentSavePreview(this.getState()),
    }));
  }

  quickSave(): Promise<SaveSlotSummary> {
    return this.save("quick", "Quick Save");
  }

  quickLoad(): Promise<RuntimeRestoreResult & { slotId: string }> {
    return this.run(() => this.runtime.save.quickLoad());
  }

  load(slotId: string): Promise<RuntimeRestoreResult & { slotId: string }> {
    return this.run(() => this.runtime.save.load(slotId));
  }

  delete(slotId: string): Promise<void> {
    return this.run(() => this.runtime.save.delete(slotId));
  }

  updateSettings(patch: Partial<RuntimeSettingsRecord>): Promise<RuntimeSettingsRecord> {
    return this.run(async () => {
      await this.runtime.settings.updateSettings(patch);
      return this.runtime.settings.getSettings();
    });
  }

  rollback(entryId: string): Promise<RuntimeRestoreResult> {
    return this.run(async () => {
      const result = await this.runtime.history.rollbackTo(entryId);
      return result ?? { warnings: [] };
    });
  }

  startReplay(replayId: string): Promise<RuntimeRestoreResult> {
    return this.run(async () => {
      const result = await this.runtime.replay.start(replayId);
      return result ?? { warnings: [] };
    });
  }

  playMusic(audioId: string): Promise<void> {
    return this.run(() => this.runtime.audio.playMusic(audioId, { loop: true }));
  }

  stopMusic(): Promise<void> {
    return this.run(() => this.runtime.audio.stopMusic(300));
  }

  private async run<T>(operation: () => Promise<T> | T): Promise<T> {
    if (this.active) throw new PlayerUiError("player_ui_busy", "另一项操作仍在进行中。");
    this.active = true;
    this.onBusyChange(true);
    try {
      return await operation();
    } catch (error) {
      const details = runtimeErrorDetails(error);
      throw new PlayerUiError(details.code, details.message);
    } finally {
      this.active = false;
      this.onBusyChange(false);
    }
  }
}
