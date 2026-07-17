/**
 * 快照场景 —— renderer-snapshot 的内置 NovelState 场景生成。
 *
 * CLI `vibegal-cli renderer-snapshot` 把项目渲染层无头挂载到这几个确定性场景上
 * 截图，让外部 Agent 不写剧本也能预览自己写的渲染层效果。
 *
 * 场景素材全部取自 manifest（第一张背景、角色与其第一个表情），项目缺料时
 * 优雅降级：无角色则说话人场景退化为旁白，无背景则保持黑场。
 *
 * 注意：本文件只允许对 @vibegal/engine 做 type import。worker 会对本文件做
 * 单文件 esbuild.transform 后直接 dynamic import（probe），任何 value import
 * 都会让 probe 产物无法自足。因此下面的初始状态按引擎 createInitialState 的
 * 形状手写，类型标注为 NovelState —— 引擎契约漂移时 tsc 会在这里报错。
 */
import type { ActiveSprite, Manifest, NovelState, Speaker } from "@vibegal/engine";

/** 一个内置快照场景：id 用于 URL 参数，title 用于展示，state 是完整的视图契约。 */
export interface SnapshotScene {
  id: string;
  title: string;
  state: NovelState;
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
 * 生成 4 个确定性快照场景：dialogue / narration / choice / sprites。
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

  return [
    { id: "dialogue", title: "对话", state: dialogue },
    { id: "narration", title: "旁白", state: narration },
    { id: "choice", title: "选项", state: choice },
    { id: "sprites", title: "多立绘", state: sprites },
  ];
}
