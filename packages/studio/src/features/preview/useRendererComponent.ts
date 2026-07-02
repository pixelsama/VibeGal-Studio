import { useEffect, useState } from "react";
import type { RendererManifest } from "@galstudio/engine";
import { loadRenderer } from "../renderers/rendererLoader";

export function useRendererComponent(projectPath: string, rendererId: string) {
  const [renderer, setRenderer] = useState<RendererManifest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRenderer(null);
    setLoadError(null);

    if (!rendererId) {
      setLoadError("未选择渲染层。");
      return;
    }

    loadRenderer(projectPath, rendererId)
      .then((manifest) => {
        if (!cancelled) setRenderer(manifest);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [projectPath, rendererId]);

  return { renderer, loadError };
}
