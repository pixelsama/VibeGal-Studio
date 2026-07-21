/**
 * 快照场景 —— renderer-snapshot 的内置 NovelState 场景生成。
 *
 * CLI `vibegal-cli renderer-snapshot` 把项目渲染层无头挂载到这几个确定性场景上
 * 截图，让外部 Agent 不写剧本也能预览自己写的渲染层效果。
 *
 * 场景素材全部取自 manifest（第一张背景、角色与其第一个表情），项目缺料时
 * 优雅降级：无角色则说话人场景退化为旁白，无背景则保持黑场。
 *
 * 项目自定义 fixtures（content/fixtures/*.json，Spec 17 步骤 5）经
 * customSceneFromFixture 归一化后由 worker 排在内置场景之后合并，
 * Studio 场景刷与 CLI snapshot 单源读取同一格式。
 *
 * 内置场景 = 4 个剧情场景 + 7 个面板场景（Spec 17 §4.1：存档/历史/设置/画廊
 * 四页）+ 1 个标题页场景（Spec 21）。面板开合与标题门都是渲染层内部 UI 状态，
 * 不在 NovelState 里，因此走两条附加通道：uiHint（宿主挂载前写
 * window.__VIBEGAL_FIXTURE_UI__，渲染层当作初始 UI 状态读一次；panel 预开面板、
 * screen 决定标题/故事初始屏，Spec 21 §4）与 persistent 瘦身 unlock 快照（经
 * fixturePersistentToGlobal 映射成 GlobalPersistentRecord 后注入
 * createInMemoryRuntimeServices）。
 *
 * 注意：本文件只允许对 @vibegal/engine 做 type import。worker 会对本文件做
 * 单文件 esbuild.transform 后直接 dynamic import（probe），任何 value import
 * 都会让 probe 产物无法自足。因此下面的初始状态按引擎 createInitialState 的
 * 形状手写，类型标注为 NovelState —— 引擎契约漂移时 tsc 会在这里报错。
 * customSceneFromFixture 与 fixturePersistentToGlobal 同样不能用 zod 等依赖，
 * 形状校验与记录构造全部手写。
 */
import type {
  ActiveSprite,
  BacklogEntry,
  GlobalPersistentRecord,
  Manifest,
  NovelState,
  Speaker,
} from "@vibegal/engine";

/** uiHint.panel 的合法取值，与 contracts 的 fixture.schema.json 保持一致。 */
export const FIXTURE_UI_PANELS = [
  "save",
  "history",
  "settings",
  "gallery-cg",
  "gallery-replay",
  "gallery-music",
  "gallery-endings",
] as const;

export type FixtureUiPanel = (typeof FIXTURE_UI_PANELS)[number];

/** uiHint.screen 的合法取值（Spec 21 第 4 节）：title = 呈现标题画面；story = 跳过标题门。 */
export const FIXTURE_UI_SCREENS = ["title", "story"] as const;

export type FixtureUiScreen = (typeof FIXTURE_UI_SCREENS)[number];

/**
 * uiHint 通道：宿主在挂载前写入 window.__VIBEGAL_FIXTURE_UI__ 的初始 UI 提示。
 * panel 与 screen 均可选；panel 语义即"剧情中某面板"，天然蕴含 story（Spec 21 §4）。
 */
export interface FixtureUiHint {
  panel?: FixtureUiPanel;
  screen?: FixtureUiScreen;
}

/**
 * persistent 瘦身快照（Spec 17 §4.2）：fixture 作者只需声明 unlock 四元组，
 * 宿主经 fixturePersistentToGlobal 映射成 GlobalPersistentRecord 全形。
 */
export interface FixturePersistentSnapshot {
  unlock: { cg: string[]; music: string[]; replay: string[]; endings: string[] };
}

/**
 * 一个快照场景：id 用于 URL 参数，title 用于展示，state 是完整的视图契约。
 * 内置剧情场景只有前三项；面板场景与项目自定义 fixtures 可带
 * persistent / uiHint / backlog 附加通道，宿主负责映射进 runtime / 初始 UI。
 */
export interface SnapshotScene {
  id: string;
  title: string;
  state: NovelState;
  persistent?: FixturePersistentSnapshot;
  uiHint?: FixtureUiHint;
  /** 历史面板场景的示例 backlog（persistent 无法表达，走 initialBacklog 通道）。 */
  backlog?: BacklogEntry[];
}

/** 项目自定义 fixture 场景（content/fixtures/*.json）与内置场景同形。 */
export type FixtureScene = SnapshotScene;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 把一个 fixture 文件 JSON 归一化为自定义场景。
 * id 一律用文件名（去掉 .json）；title 缺省时与 id 相同。
 * 形状非法时抛出带文件信息的 Error（worker 捕获后 warn 并跳过该文件）。
 *
 * 本函数会被 probe（esbuild 单文件 transform + dynamic import）与 Studio 共用，
 * 不能依赖任何 import，校验全部手写。
 */
export function customSceneFromFixture(json: unknown, fallbackId: string): FixtureScene {
  const fail = (reason: string): never => {
    throw new Error(`fixture ${JSON.stringify(fallbackId)} 非法: ${reason}`);
  };
  if (!isPlainObject(json)) {
    return fail("顶层必须是 JSON 对象");
  }
  const { title, state, persistent, uiHint } = json;
  if (title !== undefined && typeof title !== "string") {
    return fail("title 必须是字符串");
  }
  if (!isPlainObject(state)) {
    return fail("缺少必需的 state 对象（NovelState 快照，详见 fixture.schema.json）");
  }

  let normalizedPersistent: FixtureScene["persistent"];
  if (persistent !== undefined) {
    if (!isPlainObject(persistent) || !isPlainObject(persistent.unlock)) {
      return fail("persistent 必须形如 { unlock: { cg?, music?, replay?, endings? } }");
    }
    const unlock = persistent.unlock;
    const readIdList = (key: "cg" | "music" | "replay" | "endings"): string[] => {
      const value = unlock[key];
      if (value === undefined) return [];
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        throw new Error(
          `fixture ${JSON.stringify(fallbackId)} 非法: persistent.unlock.${key} 必须是字符串数组`,
        );
      }
      return value;
    };
    normalizedPersistent = {
      unlock: {
        cg: readIdList("cg"),
        music: readIdList("music"),
        replay: readIdList("replay"),
        endings: readIdList("endings"),
      },
    };
  }

  let normalizedUiHint: FixtureScene["uiHint"];
  if (uiHint !== undefined) {
    if (!isPlainObject(uiHint)) {
      return fail("uiHint 必须是对象");
    }
    const panel = uiHint.panel;
    if (panel !== undefined && (typeof panel !== "string" || !(FIXTURE_UI_PANELS as readonly string[]).includes(panel))) {
      return fail(`uiHint.panel 必须是以下值之一: ${FIXTURE_UI_PANELS.join(" | ")}`);
    }
    const screen = uiHint.screen;
    if (screen !== undefined && (typeof screen !== "string" || !(FIXTURE_UI_SCREENS as readonly string[]).includes(screen))) {
      return fail(`uiHint.screen 必须是以下值之一: ${FIXTURE_UI_SCREENS.join(" | ")}`);
    }
    if (panel === undefined && screen === undefined) {
      return fail("uiHint 必须至少包含 panel 或 screen 之一");
    }
    normalizedUiHint = {
      ...(panel !== undefined ? { panel: panel as FixtureUiPanel } : {}),
      ...(screen !== undefined ? { screen: screen as FixtureUiScreen } : {}),
    };
  }

  return {
    id: fallbackId,
    title: (title as string | undefined) ?? fallbackId,
    // state 的逐字段校验由 fixture.schema.json 承担，这里只做存在性检查后透传。
    state: state as unknown as NovelState,
    ...(normalizedPersistent ? { persistent: normalizedPersistent } : {}),
    ...(normalizedUiHint ? { uiHint: normalizedUiHint } : {}),
  };
}

/**
 * 瘦身 persistent → GlobalPersistentRecord 全形（Spec 17 §4.2），喂给
 * createInMemoryRuntimeServices 的 initialGlobalPersistent；无 persistent
 * 时返回 undefined，让引擎自己落默认值。
 *
 * schemaVersion 与引擎 RUNTIME_RECORD_SCHEMA_VERSION 对齐（当前为 1）：
 * 本文件不能 value import，漂移时 GlobalPersistentRecord 类型会在这里报错。
 */
export function fixturePersistentToGlobal(
  persistent: FixturePersistentSnapshot | undefined,
  projectId = "studio-fixture",
): GlobalPersistentRecord | undefined {
  if (!persistent) return undefined;
  return {
    schemaVersion: 1,
    projectId,
    readText: [],
    unlockedCg: [...persistent.unlock.cg],
    unlockedMusic: [...persistent.unlock.music],
    unlockedReplays: [...persistent.unlock.replay],
    unlockedEndings: [...persistent.unlock.endings],
    playthroughCount: 0,
  };
}

/** 场景里用到的角色信息（从 manifest.characters 提取）。 */
interface SnapshotCastMember {
  id: string;
  name: string;
  color: string;
  expr: string;
}

/** 与引擎 createInitialState 对齐的静态初态；progress 固定给个中间值，让进度 UI 有东西可画。 */
function createSnapshotBaseState(): NovelState {
  return {
    vars: {},
    background: null,
    backgroundTrans: "fade",
    backgroundMs: 1000,
    sprites: [],
    speaker: null,
    dialogue: null,
    narration: null,
    choice: null,
    effects: [],
    transitions: [],
    audio: { bgm: null, sfx: [], voice: null },
    flags: {
      isWaiting: false,
      isAutoPlay: false,
      skipMode: "off",
      isRecording: false,
      chapterIndex: 0,
      progress: { current: 3, total: 10 },
    },
    currentCueMs: null,
  };
}

/** 整句直接显示：typedLen = 全文、fullyRevealed = true，截图不需要等打字机。 */
function revealedText(text: string): { text: string; typedLen: number; fullyRevealed: boolean } {
  return { text, typedLen: text.length, fullyRevealed: true };
}

/** 从 manifest 提取角色表；表情一律用该角色 sprites 的第一个 key。 */
function snapshotCast(manifest: Manifest): SnapshotCastMember[] {
  return Object.entries(manifest.characters ?? {}).map(([id, character]) => ({
    id,
    name: character.name ?? id,
    color: character.color ?? "#ffffff",
    expr: Object.keys(character.sprites ?? {})[0] ?? "default",
  }));
}

/** 取第一张背景；没有背景时返回 null（黑场）。 */
function snapshotBackground(manifest: Manifest): string | null {
  return Object.keys(manifest.backgrounds ?? {})[0] ?? null;
}

function snapshotSprite(member: SnapshotCastMember, pos: string): ActiveSprite {
  return {
    id: member.id,
    pos,
    expr: member.expr,
    changeId: 1,
    justEntered: false,
    prevExpr: null,
    prevPos: null,
    trans: "fade",
    leaving: false,
  };
}

function snapshotSpeaker(member: SnapshotCastMember): Speaker {
  return { id: member.id, name: member.name, color: member.color, expr: member.expr };
}

/**
 * 面板场景的 unlock 快照：把 manifest.unlocks 注册表里的全部 id 解锁，
 * 画廊/音乐室等面板（gallery.listXxx = 注册表 ∩ unlock 集合）才有真实内容。
 */
function snapshotPanelPersistent(manifest: Manifest): FixturePersistentSnapshot {
  return {
    unlock: {
      cg: Object.keys(manifest.unlocks?.cg ?? {}),
      music: Object.keys(manifest.unlocks?.music ?? {}),
      replay: Object.keys(manifest.unlocks?.replay ?? {}),
      endings: Object.keys(manifest.unlocks?.endings ?? {}),
    },
  };
}

/** 历史面板场景的示例 backlog：复用剧情场景的台词，顺序与条数固定。 */
function snapshotPanelBacklog(protagonist: SnapshotCastMember | undefined): BacklogEntry[] {
  const lines = [
    "海平线上的第一缕光，比记忆里任何一次都要亮。",
    "清晨的风穿过甲板，把昨夜的喧嚣吹得一干二净。",
    "接下来，你想先去哪里看看？",
  ];
  return lines.map((text, index) => ({
    id: `snapshot-backlog-${index + 1}`,
    storyPoint: { nodeId: "snapshot", instructionId: `line-${index + 1}` },
    ...(protagonist ? { speakerName: protagonist.name } : {}),
    text,
    createdOrder: index + 1,
  }));
}

/** 面板场景目录：id 即 uiHint.panel（与 FIXTURE_UI_PANELS 一一对应）。 */
const SNAPSHOT_PANEL_SCENES: Array<{ id: FixtureUiPanel; title: string }> = [
  { id: "save", title: "存档" },
  { id: "history", title: "历史" },
  { id: "settings", title: "设置" },
  { id: "gallery-cg", title: "CG 画廊" },
  { id: "gallery-replay", title: "场景回放" },
  { id: "gallery-music", title: "音乐室" },
  { id: "gallery-endings", title: "结局列表" },
];

/**
 * 生成 12 个确定性快照场景：1 个标题页场景（Spec 21：uiHint.screen = "title"）
 * + 4 个剧情场景（dialogue / narration / choice / sprites，注入
 * uiHint.screen = "story"，fixture 挂载不会卡在渲染层标题门）
 * + 7 个面板场景（Spec 17 §4.1，uiHint.panel 语义天然蕴含 story）。
 * 输出只依赖 manifest，同一项目多次运行结果一致，便于截图对比。
 */
export function buildSnapshotScenes(manifest: Manifest): SnapshotScene[] {
  const cast = snapshotCast(manifest);
  const background = snapshotBackground(manifest);
  const protagonist = cast[0];

  // 对话：背景 + 主角居中立绘 + 一句台词；无角色时退化为旁白。
  const dialogue = createSnapshotBaseState();
  dialogue.background = background;
  if (protagonist) {
    dialogue.sprites = [snapshotSprite(protagonist, "center")];
    dialogue.speaker = snapshotSpeaker(protagonist);
    dialogue.dialogue = revealedText("海平线上的第一缕光，比记忆里任何一次都要亮。");
  } else {
    dialogue.narration = revealedText("海平线上的第一缕光，比记忆里任何一次都要亮。");
  }

  // 旁白：只有背景与旁白文本，无说话人、无立绘。
  const narration = createSnapshotBaseState();
  narration.background = background;
  narration.narration = revealedText("清晨的风穿过甲板，把昨夜的喧嚣吹得一干二净。");

  // 选项：一句引导语 + 三个分支；无角色时引导语用旁白呈现。
  const choice = createSnapshotBaseState();
  choice.background = background;
  if (protagonist) {
    choice.speaker = snapshotSpeaker(protagonist);
    choice.dialogue = revealedText("接下来，你想先去哪里看看？");
  } else {
    choice.narration = revealedText("接下来，你想先去哪里看看？");
  }
  choice.choice = {
    choices: [
      { text: "去甲板看日出", to: "node-a" },
      { text: "回船舱整理装备", to: "node-b" },
      { text: "去舰桥确认航线", to: "node-c" },
    ],
  };

  // 多立绘：最多三名角色分列 left/center/right，人数不足时自动向中间靠拢。
  const sprites = createSnapshotBaseState();
  sprites.background = background;
  const onStage = cast.slice(0, 3);
  const positions = onStage.length === 1
    ? ["center"]
    : onStage.length === 2
      ? ["left", "right"]
      : ["left", "center", "right"];
  sprites.sprites = onStage.map((member, index) => snapshotSprite(member, positions[index]));
  const focus = onStage.at(Math.floor((onStage.length - 1) / 2));
  if (focus) {
    sprites.speaker = snapshotSpeaker(focus);
    sprites.dialogue = revealedText("大家聚在一起的时候，连海风都变得热闹起来了。");
  } else {
    sprites.narration = revealedText("空荡荡的舞台上，只有灯光静静亮着。");
  }

  // 面板场景：底景与 dialogue 场景相同（第一个背景 + 一句对话/旁白），面板
  // 由 uiHint 浮在其上；persistent/backlog 让面板有确定性的真实内容。
  const panelPersistent = snapshotPanelPersistent(manifest);
  const panelBacklog = snapshotPanelBacklog(protagonist);

  // 标题画面（Spec 21）：最小背景 + 空对话，真正的标题 UI 由渲染层标题门呈现。
  const title = createSnapshotBaseState();
  title.background = background;

  // 剧情场景统一注入 story 语义 hint：宿主挂载任何 fixture 都不会卡在标题门。
  const storyHint: SnapshotScene["uiHint"] = { screen: "story" };

  return [
    { id: "dialogue", title: "对话", state: dialogue, uiHint: storyHint },
    { id: "narration", title: "旁白", state: narration, uiHint: storyHint },
    { id: "choice", title: "选项", state: choice, uiHint: storyHint },
    { id: "sprites", title: "多立绘", state: sprites, uiHint: storyHint },
    ...SNAPSHOT_PANEL_SCENES.map((panel): SnapshotScene => ({
      id: panel.id,
      title: panel.title,
      state: dialogue,
      persistent: panelPersistent,
      uiHint: { panel: panel.id },
      ...(panel.id === "history" ? { backlog: panelBacklog } : {}),
    })),
    { id: "title", title: "标题画面", state: title, uiHint: { screen: "title" } },
  ];
}
