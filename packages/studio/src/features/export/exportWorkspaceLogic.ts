import type {
  DesktopBuildFailure,
  DesktopBuildPreflight,
  DesktopRuntime,
} from "../../lib/tauri";
import type { ProjectIssue } from "../../lib/types";
import type { ExportTarget } from "../../lib/exportPrefs";
import { translateZhCN, type StudioTranslator } from "../../lib/i18n";
import type { DesktopBuildState } from "./buildStore";

export function defaultWebOutDir(projectPath: string): string {
  return `${projectPath}/dist/web`;
}

/** 默认桌面输出目录：<项目>/dist/desktop-<runtime>。dist 首级目录已被 watcher 忽略 */
export function defaultDesktopOutDir(projectPath: string, runtime: DesktopRuntime): string {
  return `${projectPath}/dist/desktop-${runtime}`;
}

function normalizePathForCheck(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isAbsolutePath(normalized: string): boolean {
  return normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized);
}

function isFilesystemRoot(normalized: string): boolean {
  return normalized === "" || /^[A-Za-z]:$/.test(normalized);
}

/**
 * 输出目录前端预校验，镜像 CLI ensure_export_out_dir_safe 的规则
 * （后端仍会兜底；这里只为尽早给出中文提示）。
 */
export function validateDesktopOutDir(
  projectPath: string,
  outDir: string,
  t: StudioTranslator = translateZhCN,
): string | null {
  const trimmed = outDir.trim();
  if (!trimmed) return t("export.outDir.empty");
  const out = normalizePathForCheck(trimmed);
  if (isFilesystemRoot(out)) return t("export.outDir.root");
  if (!isAbsolutePath(out)) return t("export.outDir.absolute");

  const root = normalizePathForCheck(projectPath);
  if (out === root || root.startsWith(`${out}/`)) {
    return t("export.outDir.project");
  }
  for (const protectedDir of ["content", "renderers", ".galstudio"]) {
    const prefix = `${root}/${protectedDir}`;
    if (out === prefix || out.startsWith(`${prefix}/`)) {
      return t("export.outDir.source", { directory: protectedDir });
    }
  }
  return null;
}

/** 预检报告里会真正阻止构建的硬性问题；Electron 未缓存只提示（会自动下载） */
export function preflightBlockReason(
  report: DesktopBuildPreflight | null,
  target: ExportTarget,
  runtime: DesktopRuntime,
  t: StudioTranslator = translateZhCN,
): string | null {
  if (!report) return null;
  if (!report.cliAvailable) return t("export.block.cli");
  if (report.error) return t("export.block.environment");
  if (report.node && !report.node.available) return t("export.block.node");
  if (report.exporter && !report.exporter.webWorker) {
    return t("export.block.webWorker");
  }
  if (target === "desktop" && report.exporter && !report.exporter.desktopWorker) {
    return t("export.block.desktopWorker");
  }
  if (target === "desktop" && runtime === "tauri" && report.tauriPlayer && !report.tauriPlayer.available) {
    return t("export.block.tauriPlayer");
  }
  return null;
}

export const DESKTOP_BUILD_STEPS = ["validate", "web-build", "desktop-package"] as const;
export const WEB_BUILD_STEPS = ["validate", "web-build"] as const;

export function buildStepLabel(step: string, t: StudioTranslator = translateZhCN): string {
  if (step === "validate") return t("export.step.validate");
  if (step === "web-build") return t("export.step.web");
  if (step === "desktop-package") return t("export.step.desktop");
  return step;
}

export type BuildStepStatus = "done" | "active" | "pending";

export function buildStepStatus(step: string, state: DesktopBuildState): BuildStepStatus {
  if (state.completedSteps.includes(step)) return "done";
  if (state.progress?.step === step) return "active";
  return "pending";
}

export function smokeCheckLabel(check: string, t: StudioTranslator = translateZhCN): string {
  const keys = {
    index: "export.smoke.index",
    gameManifest: "export.smoke.gameManifest",
    runtime: "export.smoke.runtime",
    content: "export.smoke.content",
    assets: "export.smoke.assets",
    basePath: "export.smoke.basePath",
    browserBehavior: "export.smoke.browserBehavior",
    desktopManifest: "export.smoke.desktopManifest",
    desktopExecutable: "export.smoke.desktopExecutable",
    webPayload: "export.smoke.webPayload",
    desktopBehavior: "export.smoke.desktopBehavior",
    advance: "export.smoke.advance",
    saveRoundTrip: "export.smoke.saveRoundTrip",
    mediaLoad: "export.smoke.mediaLoad",
  } as const;
  const key = keys[check as keyof typeof keys];
  return key ? t(key) : check;
}

export interface BuildFailurePresentation {
  title: string;
  hint: string | null;
}

/** 把结构化失败映射为对用户友好的标题与引导 */
export function buildFailurePresentation(
  failure: DesktopBuildFailure,
  t: StudioTranslator = translateZhCN,
): BuildFailurePresentation {
  switch (failure.code) {
    case "desktop_cli_unavailable":
      return { title: t("export.failure.cliUnavailable"), hint: t("export.failure.cliUnavailableHint") };
    case "desktop_build_spawn_failed":
      return { title: t("export.failure.spawn"), hint: null };
    case "desktop_build_invalid_output":
      return { title: t("export.failure.invalidOutput"), hint: t("export.failure.invalidOutputHint") };
    case "desktop_build_task_failed":
      return { title: t("export.failure.task"), hint: null };
    case "desktop_build_in_progress":
      return { title: t("export.failure.inProgress"), hint: null };
    case "desktop_build_cancelled":
      return { title: t("export.failure.cancelled"), hint: null };
    case "desktop_build_failed":
      return cliFailurePresentation(failure, t);
    default:
      return { title: t("export.failure.generic"), hint: null };
  }
}

function cliFailurePresentation(failure: DesktopBuildFailure, t: StudioTranslator): BuildFailurePresentation {
  switch (failure.cliError?.code) {
    case "validation_failed":
    case "build_validation_failed":
      return { title: t("export.failure.validation"), hint: t("export.failure.validationHint") };
    case "build_path_error":
      return { title: t("export.failure.path"), hint: t("export.failure.pathHint") };
    case "desktop_worker_unavailable":
      return { title: t("export.failure.desktopWorker"), hint: t("export.failure.installHint") };
    case "desktop_tauri_player_unavailable":
      return { title: t("export.failure.tauriPlayer"), hint: t("export.failure.tauriPlayerHint") };
    case "desktop_worker_failed":
      return { title: t("export.failure.desktopPackage"), hint: t("export.failure.desktopPackageHint") };
    case "desktop_worker_invalid_output":
      return { title: t("export.failure.workerOutput"), hint: t("export.failure.workerOutputHint") };
    case "desktop_base_path_unsupported":
      return { title: t("export.failure.basePath"), hint: null };
    case "renderer_compile_failed":
      return { title: t("export.failure.renderer"), hint: t("export.failure.rendererHint") };
    default:
      return { title: t("export.failure.generic"), hint: null };
  }
}

/** 与 Workspace.tsx 的 projectIssueSourceLabel 保持一致（这里独立一份避免循环依赖） */
export function exportIssueSourceLabel(source: string, t: StudioTranslator = translateZhCN): string {
  if (source === "graph") return t("export.source.graph");
  if (source === "node") return t("export.source.node");
  if (source === "asset") return t("export.source.asset");
  if (source === "meta") return t("export.source.meta");
  if (source === "manifest") return t("export.source.manifest");
  return source;
}

/** 按 source 分组，保持首次出现顺序 */
export function groupIssuesBySource(issues: ProjectIssue[]): [string, ProjectIssue[]][] {
  const groups = new Map<string, ProjectIssue[]>();
  for (const issue of issues) {
    const list = groups.get(issue.source) ?? [];
    list.push(issue);
    groups.set(issue.source, list);
  }
  return [...groups.entries()];
}

export function formatElapsedSeconds(startedAt: number, now: number): number {
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

export const RUNTIME_OPTIONS: {
  id: DesktopRuntime;
  nameKey: "export.runtime.electron" | "export.runtime.tauri";
  badgeKey: "export.runtime.electronBadge" | "export.runtime.tauriBadge";
  descriptionKey: "export.runtime.electronDescription" | "export.runtime.tauriDescription";
}[] = [
  {
    id: "electron",
    nameKey: "export.runtime.electron",
    badgeKey: "export.runtime.electronBadge",
    descriptionKey: "export.runtime.electronDescription",
  },
  {
    id: "tauri",
    nameKey: "export.runtime.tauri",
    badgeKey: "export.runtime.tauriBadge",
    descriptionKey: "export.runtime.tauriDescription",
  },
];
