import { useCallback, useEffect, useState } from "react";
import type { RendererManifest } from "@vibegal/engine";
import { rendererSourceFingerprint } from "../../lib/tauri";
import { getRendererDiagnostics, loadRenderer, type RendererDiagnostic } from "../renderers/rendererLoader";
import {
  initializeRendererTrust,
  isProjectRendererTrusted,
  trustProjectRenderer,
} from "../renderers/rendererTrust";

export function useRendererComponent(projectPath: string, rendererId: string) {
  const [renderer, setRenderer] = useState<RendererManifest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadDiagnostics, setLoadDiagnostics] = useState<RendererDiagnostic[]>([]);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [trustCheckPending, setTrustCheckPending] = useState(Boolean(rendererId));
  const trusted = fingerprint != null
    && isProjectRendererTrusted(projectPath, rendererId, fingerprint);

  useEffect(() => {
    let cancelled = false;
    setRenderer(null);
    setLoadError(null);
    setLoadDiagnostics([]);
    setFingerprint(null);

    if (!rendererId) {
      setTrustCheckPending(false);
      setLoadError("未选择界面风格。");
      return;
    }

    setTrustCheckPending(true);
    Promise.all([
      initializeRendererTrust(),
      rendererSourceFingerprint(projectPath, rendererId),
    ])
      .then(([, next]) => {
        if (!cancelled) setFingerprint(next);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setTrustCheckPending(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectPath, rendererId]);

  const trustRenderer = useCallback(async () => {
    if (!fingerprint) return;
    await trustProjectRenderer(projectPath, rendererId, fingerprint);
    // 信任存储不属于 React state；用同值的新字符串触发不到刷新，所以在成功后直接加载。
    setRenderer(null);
    setLoadError(null);
    setLoadDiagnostics([]);
    try {
      setRenderer(await loadRenderer(projectPath, rendererId));
    } catch (error) {
      setLoadDiagnostics(getRendererDiagnostics(error) ?? []);
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, [fingerprint, projectPath, rendererId]);

  useEffect(() => {
    let cancelled = false;
    if (!rendererId || !fingerprint || !trusted) return;

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
  }, [projectPath, rendererId, fingerprint, trusted]);

  return {
    renderer,
    loadError,
    loadDiagnostics,
    trustRequired: Boolean(rendererId) && !trustCheckPending && fingerprint != null && !trusted,
    trustCheckPending,
    trustRenderer,
  };
}
