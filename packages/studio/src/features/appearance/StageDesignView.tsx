/**
 * StageDesignView —— 外观工作台「单场景」视图：场景刷 + 舞台拖拽 overlay
 *（Spec 17 步骤 4 / 第 7 节）。
 *
 * 与渲染器的解耦方式：
 * - 渲染器声明 capabilities 含 layout-parts-v1 才挂 overlay，否则只显示提示条；
 * - 部件经容器内 querySelectorAll("[data-ui-part]") 定位，舞台经
 *   [data-stage-surface]（StageFrame 里带 transform: scale 的那层）定位，
 *   缩放比 = 表层 client 宽 / 舞台宽 —— 全部实测，不假设 StageFrame 内部布局；
 * - 拖拽过程中只改本地 overrides，经 memo 合并进 SceneFixtureView 的 manifest
 *   prop 逐帧跟手；松手才把几何 token 交给父组件走 save_manifest 落盘。
 *
 * 选框坐标换算：部件 client rect →（减舞台表层原点、除以缩放比）→ 舞台坐标；
 * 选框渲染时再换回 client 并减去容器 rect，得到容器内 CSS px 位置。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RendererManifest } from "@vibegal/engine";
import type { ProjectData } from "../../lib/types";
import type { StageResolution } from "../../lib/projectMeta";
import type { FixtureScene } from "../../export/snapshotScenes";
import { SceneFixtureView } from "../preview/SceneFixtureView";
import { mergeTokenOverrides } from "./appearanceTokens";
import {
  clientPointToStage,
  clientRectToStage,
  cyclePartSelection,
  geometryTokenEntries,
  moveStageRect,
  pickTopmostPart,
  resizeStageRect,
  stageRectToClient,
  stageScaleFromSurface,
  supportsLayoutParts,
  type ClientRect,
  type ResizeCorner,
  type StagePoint,
  type StageRect,
} from "./stageLayout";

interface StageDesignViewProps {
  project: ProjectData;
  renderer: RendererManifest;
  scene: FixtureScene;
  stage: StageResolution;
  /** null = 项目还没有 uiSkin：拖拽无处落盘，不挂 overlay（左侧空态引导启用） */
  skinId: string | null;
  /** 松手提交几何 token（x/y 或 x/y/width/height），父组件负责持久化 */
  onPersistGeometry: (entries: Record<string, number>) => void;
  /** 选中部件变化（点选/Tab 循环/Esc 取消），父组件用它过滤属性面板 */
  onSelectionChange?: (part: string | null) => void;
}

interface SurfaceInfo {
  rect: ClientRect;
  scale: number;
}

interface PartInfo {
  name: string;
  rect: StageRect;
}

interface DragState {
  part: string;
  mode: "move" | ResizeCorner;
  startRect: StageRect;
  startPoint: StagePoint;
  currentRect: StageRect;
}

function toClientRect(rect: { left: number; top: number; width: number; height: number }): ClientRect {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

export function StageDesignView({ project, renderer, scene, stage, skinId, onPersistGeometry, onSelectionChange }: StageDesignViewProps) {
  const layoutSupported = supportsLayoutParts(renderer.capabilities);
  const overlayActive = layoutSupported && skinId !== null;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const containerRectRef = useRef<ClientRect | null>(null);

  // 拖拽中的几何 token 覆盖：只活一次拖拽 + 保存往返，revision 变化（= 落盘
  // 后刷新到达）即清空，之后由真实 manifest 驱动。
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [surfaceInfo, setSurfaceInfo] = useState<SurfaceInfo | null>(null);
  const [parts, setParts] = useState<PartInfo[]>([]);
  const [selected, setSelectedState] = useState<string | null>(null);
  const [dragRect, setDragRect] = useState<StageRect | null>(null);

  // 选中态本地更新 + 外发（父组件按选中部件过滤属性面板）
  const setSelected = useCallback(
    (part: string | null) => {
      setSelectedState(part);
      onSelectionChange?.(part);
    },
    [onSelectionChange],
  );

  const previewProject = useMemo<ProjectData>(() => {
    if (skinId === null || Object.keys(overrides).length === 0) return project;
    return {
      ...project,
      content: { ...project.content, manifest: mergeTokenOverrides(project.content.manifest, skinId, overrides) },
    };
  }, [project, skinId, overrides]);

  useEffect(() => {
    setOverrides({});
  }, [project.manifestRevision, scene.id]);

  // 部件测量：量舞台表层（锚点）+ 全部 [data-ui-part]。拖拽期间跳过（几何由
  // dragRef 驱动，且 DOM 正被 overrides 推动，量了也是旧帧）。
  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const surface = container.querySelector<HTMLElement>("[data-stage-surface]");
    if (!surface) {
      setSurfaceInfo(null);
      setParts([]);
      return;
    }
    const surfaceRect = toClientRect(surface.getBoundingClientRect());
    const scale = stageScaleFromSurface(surfaceRect.width, stage.width);
    const nextParts = Array.from(container.querySelectorAll<HTMLElement>("[data-ui-part]"))
      .map((el) => ({
        name: el.dataset.uiPart ?? "",
        rect: clientRectToStage(toClientRect(el.getBoundingClientRect()), surfaceRect, scale),
      }))
      .filter((part) => part.name !== "");
    containerRectRef.current = toClientRect(container.getBoundingClientRect());
    setSurfaceInfo({ rect: surfaceRect, scale });
    setParts(nextParts);
  }, [stage.width]);

  useEffect(() => {
    if (!overlayActive) return;
    const container = containerRef.current;
    if (!container) return;
    const remeasure = () => {
      if (!dragRef.current) measure();
    };
    remeasure();
    // 容器尺寸变化（窗口/侧栏拖动）→ 重测；与 StageFrame 同样的降级路径
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", remeasure);
      return () => window.removeEventListener("resize", remeasure);
    }
    const observer = new ResizeObserver(remeasure);
    observer.observe(container);
    return () => observer.disconnect();
    // previewProject 变化（token 编辑/落盘刷新）后部件几何可能已变，需要重测
  }, [overlayActive, measure, previewProject]);

  const toStagePoint = useCallback(
    (event: { clientX: number; clientY: number }): StagePoint | null =>
      surfaceInfo ? clientPointToStage(event.clientX, event.clientY, surfaceInfo.rect, surfaceInfo.scale) : null,
    [surfaceInfo],
  );

  // 空白处按下：依 DOM 序取最上层命中部件并选中，同时进入移动拖拽
  const handleOverlayPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !surfaceInfo) return;
    const point = toStagePoint(event);
    if (!point) return;
    const hit = pickTopmostPart(parts, point);
    if (!hit) {
      setSelected(null);
      return;
    }
    setSelected(hit.name);
    dragRef.current = { part: hit.name, mode: "move", startRect: hit.rect, startPoint: point, currentRect: hit.rect };
    setDragRect(hit.rect);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  // 四角手柄按下：进入对应角的缩放拖拽（stopPropagation 避免触发移动）
  const handleGripPointerDown = (corner: ResizeCorner) => (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !surfaceInfo) return;
    const part = parts.find((candidate) => candidate.name === selected);
    if (!part) return;
    event.stopPropagation();
    const point = toStagePoint(event);
    if (!point) return;
    dragRef.current = { part: part.name, mode: corner, startRect: part.rect, startPoint: point, currentRect: part.rect };
    setDragRect(part.rect);
    overlayRef.current?.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || !surfaceInfo) return;
    const point = toStagePoint(event);
    if (!point) return;
    const dx = point.x - drag.startPoint.x;
    const dy = point.y - drag.startPoint.y;
    const rect =
      drag.mode === "move"
        ? moveStageRect(drag.startRect, dx, dy, stage)
        : resizeStageRect(drag.startRect, drag.mode, dx, dy, stage);
    dragRef.current = { ...drag, currentRect: rect };
    setDragRect(rect);
    // 逐帧跟手：move 只覆盖 x/y；resize 才覆盖 width/height（nameBox 的 auto
    // 宽高借此从 DOM 现值写回具体 px）
    setOverrides(geometryTokenEntries(drag.part, rect, drag.mode !== "move"));
  };

  const endDrag = (commit: boolean) => () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDragRect(null);
    if (commit) {
      onPersistGeometry(geometryTokenEntries(drag.part, drag.currentRect, drag.mode !== "move"));
    } else {
      setOverrides({});
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      event.preventDefault();
      setSelected(cyclePartSelection(parts.map((part) => part.name), selected, event.shiftKey ? -1 : 1));
    } else if (event.key === "Escape") {
      setSelected(null);
    }
  };

  // 选框：拖拽中跟 dragRect（免等测量），否则用最近一次测量的部件 rect
  const selectionStageRect = dragRect ?? parts.find((part) => part.name === selected)?.rect ?? null;
  const containerRect = containerRectRef.current;
  const selectionBox =
    selectionStageRect && surfaceInfo && containerRect
      ? (() => {
          const client = stageRectToClient(selectionStageRect, surfaceInfo.rect, surfaceInfo.scale);
          return {
            left: client.left - containerRect.left,
            top: client.top - containerRect.top,
            width: client.width,
            height: client.height,
          };
        })()
      : null;

  return (
    <div ref={containerRef} style={rootStyle}>
      <SceneFixtureView project={previewProject} renderer={renderer} scene={scene} />
      {!layoutSupported && (
        <div style={hintBarStyle} role="status">
          此渲染层未声明可拖拽部件（缺少 layout-parts-v1 capability）
        </div>
      )}
      {overlayActive && (
        <div
          ref={overlayRef}
          // 选框本身就是焦点可见性，overlay 的默认焦点环反而是干扰
          style={{ ...overlayStyle, outline: "none" }}
          tabIndex={0}
          aria-label="舞台布局编辑层"
          onPointerDown={handleOverlayPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag(true)}
          onPointerCancel={endDrag(false)}
          onKeyDown={handleKeyDown}
        >
          {selectionBox && (
            <div
              data-selection-box={selected ?? undefined}
              style={{
                position: "absolute",
                left: selectionBox.left,
                top: selectionBox.top,
                width: selectionBox.width,
                height: selectionBox.height,
                border: "1.5px solid var(--accent-bright)",
                borderRadius: "var(--radius-sm)",
                pointerEvents: "none",
                boxSizing: "border-box",
              }}
            >
              {(["nw", "ne", "sw", "se"] as const).map((corner) => (
                <div
                  key={corner}
                  data-resize-grip={corner}
                  style={{
                    position: "absolute",
                    width: 10,
                    height: 10,
                    background: "var(--accent-bright)",
                    border: "1px solid var(--bg-app)",
                    borderRadius: 2,
                    pointerEvents: "auto",
                    cursor: corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize",
                    left: corner === "nw" || corner === "sw" ? -6 : undefined,
                    right: corner === "ne" || corner === "se" ? -6 : undefined,
                    top: corner === "nw" || corner === "ne" ? -6 : undefined,
                    bottom: corner === "sw" || corner === "se" ? -6 : undefined,
                  }}
                  onPointerDown={handleGripPointerDown(corner)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const rootStyle: React.CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  minHeight: 0,
};

const hintBarStyle: React.CSSProperties = {
  position: "absolute",
  top: "var(--space-2)",
  left: "50%",
  transform: "translateX(-50%)",
  padding: "var(--space-1) var(--space-3)",
  borderRadius: "var(--radius-pill)",
  border: "1px solid var(--border-strong)",
  background: "var(--bg-panel)",
  color: "var(--text-secondary)",
  fontSize: "var(--text-sm)",
  pointerEvents: "none",
  whiteSpace: "nowrap",
};

const overlayStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  cursor: "default",
  // 透明但可命中：点击 = 选部件/开始拖拽；场景刷是静态场景，挡住渲染层交互是预期
  background: "transparent",
};
