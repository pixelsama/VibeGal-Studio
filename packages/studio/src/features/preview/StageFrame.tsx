import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { StageResolution } from "../../lib/projectMeta";

interface StageFrameProps {
  stage: StageResolution;
  children: ReactNode;
  /** 外观设计画布相对“适合窗口”的查看倍率；普通预览保持 1。 */
  zoom?: number;
  /** 舞台表层倍率改变后通知布局 overlay 重新测量。 */
  onScaleChange?: (scale: number) => void;
}

export function computeStageFrameScale(container: StageResolution, stage: StageResolution): number {
  if (container.width <= 0 || container.height <= 0 || stage.width <= 0 || stage.height <= 0) {
    return 1;
  }
  return Math.min(container.width / stage.width, container.height / stage.height);
}

export function clampStageFrameZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(2, Math.max(0.5, zoom));
}

export function StageFrame({ stage, children, zoom = 1, onScaleChange }: StageFrameProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [container, setContainer] = useState<StageResolution>({ width: 0, height: 0 });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const update = () => {
      setContainer({ width: element.clientWidth, height: element.clientHeight });
    };
    update();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }

    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fitScale = computeStageFrameScale(container, stage);
  const scale = fitScale * clampStageFrameZoom(zoom);

  useEffect(() => {
    if (container.width > 0 && container.height > 0) onScaleChange?.(scale);
  }, [container.width, container.height, onScaleChange, scale]);

  return (
    <div
      ref={containerRef}
      style={{
        ...outerStyle,
        alignItems: zoom > 1 ? "flex-start" : "center",
        justifyContent: zoom > 1 ? "flex-start" : "center",
      }}
    >
      <div style={{ width: stage.width * scale, height: stage.height * scale, ...scaledSlotStyle }}>
        {/* data-stage-surface：外观面板拖拽 overlay 的舞台锚点（Spec 17 §7）。
            这层带 transform: scale，getBoundingClientRect 即缩放后的舞台视觉盒。 */}
        <div
          data-stage-surface
          style={{
            width: stage.width,
            height: stage.height,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            ...stageSurfaceStyle,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

const outerStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  minWidth: 0,
  minHeight: 0,
  overflow: "auto",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#050608",
};

const scaledSlotStyle: CSSProperties = {
  position: "relative",
  flexShrink: 0,
};

const stageSurfaceStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  top: 0,
  overflow: "hidden",
  background: "#000",
};
