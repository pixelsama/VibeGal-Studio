import { useEffect, useState } from "react";
import type { RendererManifest } from "@galstudio/engine";
import { getRendererDiagnostics, loadRenderer, type RendererDiagnostic } from "../renderers/rendererLoader";

export function useRendererComponent(projectPath: string, rendererId: string) {
  const [renderer, setRenderer] = useState<RendererManifest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadDiagnostics, setLoadDiagnostics] = useState<RendererDiagnostic[]>([]);

  useEffect(() => {
    let cancelled = false;
    setRenderer(null);
    setLoadError(null);
    setLoadDiagnostics([]);

    if (!rendererId) {
      setLoadError("未选择渲染层。");
      return;
    }

    loadRenderer(projectPath, rendererId)
      .then((manifest) => {
        if (!cancelled) setRenderer(manifest);
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadDiagnostics(getRendererDiagnostics(error) ?? []);
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectPath, rendererId]);

  return { renderer, loadError, loadDiagnostics };
}
