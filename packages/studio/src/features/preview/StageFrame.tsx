import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { StageResolution } from "../../lib/projectMeta";

interface StageFrameProps {
  stage: StageResolution;
  children: ReactNode;
}

export function computeStageFrameScale(container: StageResolution, stage: StageResolution): number {
  if (container.width <= 0 || container.height <= 0 || stage.width <= 0 || stage.height <= 0) {
    return 1;
  }
  return Math.min(container.width / stage.width, container.height / stage.height);
}

export function StageFrame({ stage, children }: StageFrameProps) {
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

  const scale = computeStageFrameScale(container, stage);

  return (
    <div ref={containerRef} style={outerStyle}>
      <div style={{ width: stage.width * scale, height: stage.height * scale, ...scaledSlotStyle }}>
        <div
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
  overflow: "hidden",
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
