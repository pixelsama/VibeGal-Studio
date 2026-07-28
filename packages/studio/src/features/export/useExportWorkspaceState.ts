import { useEffect, useMemo, useState } from "react";
import type { DesktopBuildPreflight, DesktopRuntime } from "../../lib/tauri";
import type { ProjectData } from "../../lib/types";
import { useStudioI18n } from "../../lib/i18n";
import { loadExportPrefs, saveExportPrefs, type ExportPrefs, type ExportTarget } from "../../lib/exportPrefs";
import { useDesktopBuildState } from "./buildStore";
import {
  defaultDesktopOutDir,
  defaultWebOutDir,
  formatElapsedSeconds,
  preflightBlockReason,
  validateDesktopOutDir,
} from "./exportWorkspaceLogic";

interface UseExportWorkspaceStateOptions {
  project: ProjectData;
  loadPreflight: () => Promise<DesktopBuildPreflight>;
}

export function useExportWorkspaceState({ project, loadPreflight }: UseExportWorkspaceStateOptions) {
  const { t } = useStudioI18n();
  const initialPrefs = useMemo(() => loadExportPrefs(project.path), [project.path]);
  const [target, setTarget] = useState<ExportTarget>(initialPrefs.target);
  const [runtime, setRuntime] = useState<DesktopRuntime>(initialPrefs.runtime);
  const [webCustomOutDir, setWebCustomOutDir] = useState(initialPrefs.webCustomOutDir);
  const [desktopCustomOutDir, setDesktopCustomOutDir] = useState(initialPrefs.desktopCustomOutDir);
  const [rendererId, setRendererId] = useState(initialPrefs.rendererId);
  const [strict, setStrict] = useState(initialPrefs.strict);
  const [allowWarnings, setAllowWarnings] = useState(initialPrefs.allowWarnings);
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const buildState = useDesktopBuildState(project.path);
  const building = buildState.phase === "building";
  const [preflight, setPreflight] = useState<DesktopBuildPreflight | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);

  async function refreshPreflight() {
    setPreflightLoading(true);
    try {
      setPreflight(await loadPreflight());
    } finally {
      setPreflightLoading(false);
    }
  }

  useEffect(() => {
    let disposed = false;
    setPreflightLoading(true);
    void loadPreflight()
      .then((report) => {
        if (!disposed) setPreflight(report);
      })
      .finally(() => {
        if (!disposed) setPreflightLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [loadPreflight]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!building) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [building]);

  const persistPrefs = (patch: Partial<ExportPrefs>) => {
    const next = { target, runtime, webCustomOutDir, desktopCustomOutDir, rendererId, strict, allowWarnings, ...patch };
    saveExportPrefs(project.path, next);
  };

  function changeTarget(next: ExportTarget) {
    setTarget(next);
    persistPrefs({ target: next });
  }

  function changeRuntime(next: DesktopRuntime) {
    setRuntime(next);
    persistPrefs({ runtime: next });
  }

  function changeRenderer(next: string) {
    setRendererId(next);
    persistPrefs({ rendererId: next });
  }

  function changeOutDir(next: string) {
    if (target === "web") {
      setWebCustomOutDir(next);
      persistPrefs({ webCustomOutDir: next });
    } else {
      setDesktopCustomOutDir(next);
      persistPrefs({ desktopCustomOutDir: next });
    }
  }

  function changeStrict(next: boolean) {
    setStrict(next);
    persistPrefs({ strict: next });
  }

  function changeAllowWarnings(next: boolean) {
    setAllowWarnings(next);
    persistPrefs({ allowWarnings: next });
  }

  const customOutDir = target === "web" ? webCustomOutDir : desktopCustomOutDir;
  const effectiveOutDir = customOutDir.trim()
    ? customOutDir
    : target === "web"
      ? defaultWebOutDir(project.path)
      : defaultDesktopOutDir(project.path, runtime);
  const effectiveRendererId = rendererId || project.meta.activeRendererId || project.rendererIds[0] || "";
  const outDirError = validateDesktopOutDir(project.path, effectiveOutDir, t);
  const blockReason = preflightBlockReason(preflight, target, runtime, t);
  const statusText = building
    ? t("export.status.building", { seconds: formatElapsedSeconds(buildState.startedAt ?? now, now) })
    : buildState.phase === "success"
      ? t("export.status.success")
      : buildState.phase === "failure"
        ? t("export.status.failure")
        : buildState.phase === "cancelled"
          ? t("export.status.cancelled")
          : null;

  return {
    target,
    runtime,
    strict,
    allowWarnings,
    copied,
    actionError,
    buildState,
    building,
    preflight,
    preflightLoading,
    customOutDir,
    effectiveOutDir,
    effectiveRendererId,
    outDirError,
    blockReason,
    statusText,
    refreshPreflight,
    changeTarget,
    changeRuntime,
    changeRenderer,
    changeOutDir,
    changeStrict,
    changeAllowWarnings,
    setCopied,
    setActionError,
  };
}
