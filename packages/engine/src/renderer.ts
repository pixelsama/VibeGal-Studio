/**
 * 渲染层契约 —— engine 与可替换渲染层之间的接口定义。
 *
 * 一个渲染层 = 一套读 NovelState 的 React 组件实现。
 * 它存在于「项目内」（每个项目自带 renderers/），开发工具加载它、挂载它。
 * 契约稳定后，换皮 = 换一个遵守本契约的目录，引擎与剧本不动。
 */
import type { ComponentType } from "react";
import type { NovelState } from "./state";
import type { Manifest, Meta } from "./types";

/** 渲染层组件接收的 props。引擎把「当前场景状态 + 资源表 + 控制回调」交给它。 */
export interface RendererProps {
  /** 当前场景状态（视图契约），是渲染层唯一需要读懂的核心数据 */
  state: NovelState;
  /** 资源表，渲染层用它把 id 解析成图片/音频路径 */
  manifest: Manifest;
  /** 资源根路径（相对），用于拼绝对 URL */
  contentBase: string;
  /** 项目固定舞台尺寸，renderer 的坐标系应以它为准 */
  stage: Meta["stage"];
  /** 玩家推进（点击/空格）回调 */
  onAdvance: () => void;
  /** 玩家选择分支目标。Stage 1 可只提示目标，不必加载下个节点。 */
  onChoose?: (toNodeId: string) => void;
  /** 切换自动播放 */
  onToggleAuto: () => void;
  /** 切换录制模式 */
  onToggleRecording: () => void;
  /** 调试用：相对当前指令前后跳 */
  onSeekBy?: (delta: number) => void;
  /** 调试用：单步执行 */
  onStepOnce?: () => void;
  /** 调试用：上一章 */
  onPrevChapter?: () => void;
  /** 调试用：下一章 */
  onNextChapter?: () => void;
}

/** 每个渲染层目录必须导出的清单。 */
export interface RendererManifest {
  /** 唯一 id，通常 = 目录名 */
  id: string;
  /** 在 UI 里显示的名字 */
  name: string;
  /** 描述（可选） */
  description?: string;
  /** 渲染层主组件 */
  Component: ComponentType<RendererProps>;
}
