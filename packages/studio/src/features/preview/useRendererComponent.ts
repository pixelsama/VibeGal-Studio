import { useCallback, useEffect, useState } from "react";
import type { RendererManifest } from "@vibegal/engine";
import { getRendererDiagnostics, loadRenderer, type RendererDiagnostic } from "../renderers/rendererLoader";
import { isProjectRendererTrusted, trustProjectRenderer } from "../renderers/rendererTrust";

export function useRendererComponent(projectPath: string, rendererId: string) {
  const [renderer, setRenderer] = useState<RendererManifest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadDiagnostics, setLoadDiagnostics] = useState<RendererDiagnostic[]>([]);
  const [trusted, setTrusted] = useState(() => isProjectRendererTrusted(projectPath));

  const trustRenderer = useCallback(() => {
    trustProjectRenderer(projectPath);
    setTrusted(true);
  }, [projectPath]);

  useEffect(() => {
    setTrusted(isProjectRendererTrusted(projectPath));
  }, [projectPath]);

  useEffect(() => {
    let cancelled = false;
    setRenderer(null);
    setLoadError(null);
    setLoadDiagnostics([]);

    if (!rendererId) {
      setLoadError("未选择渲染层。");
      return;
    }
    if (!trusted) return;

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
  }, [projectPath, rendererId, trusted]);

  return {
    renderer,
    loadError,
    loadDiagnostics,
    trustRequired: Boolean(rendererId) && !trusted,
    trustRenderer,
  };
}
