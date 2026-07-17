/**
 * 快照宿主 —— renderer-snapshot 的浏览器侧最小运行时。
 *
 * CLI worker 把本文件与项目渲染层一起打进 bundle.js，由 snapshot.html 加载：
 * 按 URL 的 scene 参数取一个内置快照场景，用渲染层的 Component 直接渲染该
 * NovelState；就绪（图片 / 字体 / 两个 rAF）后通过 /__vibegal_snapshot_result__
 * 回传结果，CLI 据此截图。任何渲染错误也以同一通道上报并整屏显示。
 *
 * 与 webRuntimeHost 不同：这里没有播放器，场景是静态的，controls 全部 no-op。
 */
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createInMemoryRuntimeServices,
  validateRendererManifestContract,
  type Manifest,
  type Meta,
  type RendererManifest,
  type RendererProps,
  type RuntimeControls,
} from "@vibegal/engine";
import { buildSnapshotScenes } from "./snapshotScenes";

export interface SnapshotHostOptions {
  manifest: Manifest;
  stage: Meta["stage"];
  contentBase: string;
}

/** 错误层样式：整屏红底白字，保证截图里一眼能看出渲染失败。 */
const SNAPSHOT_ERROR_STYLE: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 9999,
  boxSizing: "border-box",
  padding: "24px",
  background: "#2b0000",
  color: "#ffb3b3",
  font: "14px/1.6 monospace",
  whiteSpace: "pre-wrap",
  overflow: "auto",
};

/** 每个页面只上报一次（成功或失败先到先得），后续的窗口异常不再重复打扰 CLI。 */
let snapshotReported = false;

function reportSnapshotResult(sceneId: string, status: "ok" | "error", message?: string): void {
  if (snapshotReported) return;
  snapshotReported = true;
  const params = new URLSearchParams({ scene: sceneId, status });
  if (message) params.set("message", message.slice(0, 500));
  void fetch(`/__vibegal_snapshot_result__?${params.toString()}`, { cache: "no-store" }).catch(() => {
    // 回调服务器不可用时静默；CLI 侧以超时兜底报错。
  });
}

function snapshotErrorMessage(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

interface SnapshotErrorBoundaryProps {
  onError: (error: unknown) => void;
  children?: React.ReactNode;
}

interface SnapshotErrorBoundaryState {
  message: string | null;
}

/** 渲染层异常兜底：上报 + 渲染红色错误层，避免截图停在半渲染状态。 */
class SnapshotErrorBoundary extends React.Component<SnapshotErrorBoundaryProps, SnapshotErrorBoundaryState> {
  state: SnapshotErrorBoundaryState = { message: null };

  static getDerivedStateFromError(error: unknown): SnapshotErrorBoundaryState {
    return { message: snapshotErrorMessage(error) };
  }

  componentDidCatch(error: unknown): void {
    this.props.onError(error);
  }

  render(): React.ReactNode {
    if (this.state.message != null) {
      return React.createElement("div", { style: SNAPSHOT_ERROR_STYLE }, this.state.message);
    }
    return this.props.children;
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/** 等页面图片全部就绪；解码失败或超时（5s 兜底）都不阻塞快照。 */
async function waitForImages(timeoutMs = 5_000): Promise<void> {
  const images = Array.from(document.images);
  if (images.length === 0) return;
  const settled = Promise.all(images.map(async (image) => {
    if (image.complete) return;
    try {
      await image.decode();
    } catch {
      // 图片缺失/解码失败不阻塞快照，截图里会直接表现为资源缺失。
    }
  }));
  await Promise.race([
    settled,
    new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    }),
  ]);
}

/** 渲染提交后的就绪流程：先让一帧（确保 React 已提交 DOM），再等图片、字体，最后两个 rAF。 */
async function waitForSnapshotReady(): Promise<void> {
  await nextFrame();
  await waitForImages();
  try {
    await document.fonts?.ready;
  } catch {
    // 字体加载失败同样不阻塞快照。
  }
  await nextFrame();
  await nextFrame();
}

/**
 * 启动快照宿主：解析 scene 参数 → 校验渲染层 manifest → 挂载静态场景 → 就绪上报。
 * rendererManifest 是 unknown（来自项目渲染层），校验不过时按 manifest 错误上报。
 */
export function startVibeGalSnapshotHost(rendererManifest: unknown, hostOptions: SnapshotHostOptions): void {
  const scenes = buildSnapshotScenes(hostOptions.manifest);
  const requestedSceneId = new URLSearchParams(window.location.search).get("scene");
  const scene = scenes.find((item) => item.id === requestedSceneId) ?? scenes[0];
  const sceneId = scene?.id ?? requestedSceneId ?? "unknown";

  let mountedRoot: Root | null = null;
  const fail = (error: unknown) => {
    const message = snapshotErrorMessage(error);
    reportSnapshotResult(sceneId, "error", message);
    if (mountedRoot) {
      mountedRoot.render(React.createElement("div", { style: SNAPSHOT_ERROR_STYLE }, message));
      return;
    }
    const rootElement = document.getElementById("root");
    if (rootElement) {
      rootElement.textContent = message;
      Object.assign(rootElement.style, SNAPSHOT_ERROR_STYLE);
    }
  };

  if (!scene) {
    fail(new Error(`未找到快照场景 ${JSON.stringify(requestedSceneId)}。`));
    return;
  }

  const manifestIssue = validateRendererManifestContract(rendererManifest)
    .find((issue) => issue.level === "error");
  if (manifestIssue) {
    fail(new Error(manifestIssue.message));
    return;
  }
  const resolvedManifest = rendererManifest as RendererManifest;

  const rootElement = document.getElementById("root");
  if (!rootElement) {
    fail(new Error("Missing #root element."));
    return;
  }

  window.addEventListener("error", (event) => {
    // 只处理带 message 的脚本错误；资源加载错误（图片 404 等）由超时与截图兜底。
    if (event.message) fail(event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    fail(event.reason);
  });

  // 快照是静态场景：controls 全部 no-op，runtime 用内存服务顶住设置/存档类 API。
  const controls: RuntimeControls = {
    advance: () => {},
    choose: () => {},
    setAutoPlay: () => {},
    setSkipMode: () => {},
    rollbackTo: () => {},
    restart: () => {},
  };
  const props: RendererProps = {
    state: scene.state,
    manifest: hostOptions.manifest,
    contentBase: hostOptions.contentBase,
    stage: hostOptions.stage,
    controls,
    runtime: createInMemoryRuntimeServices({
      getState: () => scene.state,
      manifest: hostOptions.manifest,
    }),
  };

  try {
    mountedRoot = createRoot(rootElement);
    mountedRoot.render(
      React.createElement(
        SnapshotErrorBoundary,
        { onError: fail },
        React.createElement(resolvedManifest.Component, props),
      ),
    );
  } catch (error) {
    fail(error);
    return;
  }

  void waitForSnapshotReady().then(() => {
    reportSnapshotResult(scene.id, "ok");
  });
}
