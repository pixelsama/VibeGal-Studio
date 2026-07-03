/**
 * NovelState —— 视图契约（renderer contract）。
 *
 * 这是【引擎 ↔ 组件】之间唯一的边界。
 * 组件层（src/components/*）只允许 import 本文件里的类型，不允许 import
 * interpreter/player/useNovel 的内部实现，以保证组件可被整体替换。
 *
 * 外部工具想换一整套界面时，只需要读懂下面这些字段，重写 components/ 即可，
 * 引擎与剧本一行都不用动。
 */

/**
 * 台上一个立绘。pos 是剧本原始槽名（如 "center"），坐标由组件自行解释。
 *
 * 演出语义字段（中立，渲染层自由决定怎么演）：
 *   - changeId：每次该立绘发生任何变化（登场/换表情/移位）时递增。
 *               渲染层用它判断「这是一次新的变化」，决定是否触发动画。
 *   - justEntered：本次刚登场（从无到有），渲染层应播登场动画。
 *   - prevExpr / prevPos：变化前的表情/位置。若 expr 变了 = 表情切换；
 *               若 pos 变了 = 移位。渲染层据此决定过渡类型。
 *   - trans：作者在剧本里写的过渡意图（"fade"/"slide"/"cut"），仅作建议，
 *               渲染层可遵从也可重写。
 *   - leaving：该立绘正在退场。渲染层据此播退场动画。
 *               注意：interpreter 会把 leaving 立绘保留一帧供渲染层看到，
 *               下一次状态推进时才真正移除（由 player 在推进前清理）。
 */
export interface ActiveSprite {
  id: string;
  pos: string;
  expr: string;
  changeId: number;
  justEntered: boolean;
  prevExpr: string | null;
  prevPos: string | null;
  trans: "fade" | "cut" | "slide";
  leaving: boolean;
}

/** 当前说话人（用于名字标签 + 高亮）。 */
export interface Speaker {
  id: string;
  name: string;
  color: string;
  expr: string;
}

/** 一段特效，组件播放后即从数组移除（由 useNovel 通过版本号驱动）。 */
export interface PendingEffect {
  id: number; // 唯一标识，组件用它判断「是不是新特效」
  type: "shake" | "flash" | "blur";
  intensity: number;
  ms: number;
}

/** 转场覆盖层。 */
export interface PendingTransition {
  id: number;
  type: "fade_in" | "fade_out" | "white_in" | "white_out" | "black";
  ms: number;
}

export interface NovelState {
  /** 当前背景 id（引用 manifest.backgrounds），null = 黑场 */
  background: string | null;
  backgroundTrans: "fade" | "cut" | "dissolve";
  backgroundMs: number;

  /** 台上立绘列表，按登场顺序 */
  sprites: ActiveSprite[];

  /** 当前说话人，null = 无（纯旁白） */
  speaker: Speaker | null;

  /** 对话正文（已打字机化的部分由 typedLen 控制） */
  dialogue: {
    text: string;
    typedLen: number; // 0..text.length；等于 text.length 表示该句已打完
    fullyRevealed: boolean; // 玩家是否已点击跳过打字（整句直接显示）
  } | null;

  /** 旁白（无说话人时显示）。打字机同样用 typedLen */
  narration: {
    text: string;
    typedLen: number;
    fullyRevealed: boolean;
  } | null;

  /** 待播放特效 / 转场（组件消费） */
  effects: PendingEffect[];
  transitions: PendingTransition[];

  /** 音频线索（组件据此播放，不持有音频实例） */
  audio: {
    bgm: { id: string; fade: number; loop: boolean } | null;
    /** 最近触发的音效 id 列表（带序号，便于组件去重播放） */
    sfx: { id: string; seq: number }[];
    voice: { id: string; seq: number } | null;
  };

  /** 播放状态标记，供 UI / 控制层使用 */
  flags: {
    isWaiting: boolean; // 正在执行 wait 指令
    isAutoPlay: boolean;
    isRecording: boolean; // 录制模式：隐藏控制 UI + 固定节奏
    chapterIndex: number;
    progress: { current: number; total: number }; // 指令进度
  };

  /** 当前文本指令打完后，自动/录制模式应停留的毫秒数（null=跟随 meta.autoAdvanceMs）。 */
  currentCueMs: number | null;
}

export function createInitialState(): NovelState {
  return {
    background: null,
    backgroundTrans: "fade",
    backgroundMs: 1000,
    sprites: [],
    speaker: null,
    dialogue: null,
    narration: null,
    effects: [],
    transitions: [],
    audio: { bgm: null, sfx: [], voice: null },
    flags: {
      isWaiting: false,
      isAutoPlay: false,
      isRecording: false,
      chapterIndex: 0,
      progress: { current: 0, total: 0 },
    },
    currentCueMs: null,
  };
}
