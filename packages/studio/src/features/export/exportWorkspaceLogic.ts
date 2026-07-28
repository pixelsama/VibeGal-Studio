import type {
  DesktopBuildFailure,
  DesktopBuildPreflight,
  DesktopRuntime,
} from "../../lib/tauri";
import type { ProjectIssue } from "../../lib/types";
import type { ExportTarget } from "../../lib/exportPrefs";
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
export function validateDesktopOutDir(projectPath: string, outDir: string): string | null {
  const trimmed = outDir.trim();
  if (!trimmed) return "请选择输出目录";
  const out = normalizePathForCheck(trimmed);
  if (isFilesystemRoot(out)) return "输出目录不能是文件系统根目录";
  if (!isAbsolutePath(out)) return "输出目录需要是绝对路径";

  const root = normalizePathForCheck(projectPath);
  if (out === root || root.startsWith(`${out}/`)) {
    return "输出目录不能是项目根目录或其上级目录";
  }
  for (const protectedDir of ["content", "renderers", ".galstudio"]) {
    const prefix = `${root}/${protectedDir}`;
    if (out === prefix || out.startsWith(`${prefix}/`)) {
      return `输出目录不能位于项目源目录 ${protectedDir}/ 内`;
    }
  }
  return null;
}

/** 预检报告里会真正阻止构建的硬性问题；Electron 未缓存只提示（会自动下载） */
export function preflightBlockReason(
  report: DesktopBuildPreflight | null,
  target: ExportTarget,
  runtime: DesktopRuntime,
): string | null {
  if (!report) return null;
  if (!report.cliAvailable) return "找不到随应用分发的 vibegal-cli，无法构建";
  if (report.error) return "环境检查失败，无法构建";
  if (report.node && !report.node.available) return "未找到 Node.js，无法构建";
  if (report.exporter && !report.exporter.webWorker) {
    return "Web 打包组件缺失，无法构建";
  }
  if (target === "desktop" && report.exporter && !report.exporter.desktopWorker) {
    return "桌面打包组件缺失，无法构建";
  }
  if (target === "desktop" && runtime === "tauri" && report.tauriPlayer && !report.tauriPlayer.available) {
    return "找不到 Tauri 轻量 Player，无法以轻量模式构建";
  }
  return null;
}

export const DESKTOP_BUILD_STEPS = ["validate", "web-build", "desktop-package"] as const;
export const WEB_BUILD_STEPS = ["validate", "web-build"] as const;

export function buildStepLabel(step: string): string {
  if (step === "validate") return "校验项目";
  if (step === "web-build") return "构建 Web 产物";
  if (step === "desktop-package") return "打包桌面运行时";
  return step;
}

export type BuildStepStatus = "done" | "active" | "pending";

export function buildStepStatus(step: string, state: DesktopBuildState): BuildStepStatus {
  if (state.completedSteps.includes(step)) return "done";
  if (state.progress?.step === step) return "active";
  return "pending";
}

export function smokeCheckLabel(check: string): string {
  const labels: Record<string, string> = {
    index: "入口页面",
    gameManifest: "游戏清单",
    runtime: "运行时",
    content: "故事内容",
    assets: "资产",
    basePath: "部署路径",
    browserBehavior: "浏览器行为",
    desktopManifest: "桌面清单",
    desktopExecutable: "可执行文件",
    webPayload: "Web 产物",
    desktopBehavior: "桌面行为",
    advance: "播放推进",
    saveRoundTrip: "存档读写",
    mediaLoad: "媒体加载",
  };
  return labels[check] ?? check;
}

export interface BuildFailurePresentation {
  title: string;
  hint: string | null;
}

/** 把结构化失败映射为对用户友好的中文标题与引导 */
export function buildFailurePresentation(failure: DesktopBuildFailure): BuildFailurePresentation {
  switch (failure.code) {
    case "desktop_cli_unavailable":
      return { title: "找不到随应用分发的 vibegal-cli", hint: "请通过正式安装的 VibeGal-Studio 运行，或检查安装是否完整。" };
    case "desktop_build_spawn_failed":
      return { title: "无法启动构建进程", hint: null };
    case "desktop_build_invalid_output":
      return { title: "构建工具返回了无法解析的结果", hint: "应用与 CLI 版本可能不匹配，请更新 VibeGal-Studio。" };
    case "desktop_build_task_failed":
      return { title: "构建任务异常结束", hint: null };
    case "desktop_build_in_progress":
      return { title: "已有构建正在进行中", hint: null };
    case "desktop_build_cancelled":
      return { title: "构建已取消", hint: null };
    case "desktop_build_failed":
      return cliFailurePresentation(failure);
    default:
      return { title: "构建失败", hint: null };
  }
}

function cliFailurePresentation(failure: DesktopBuildFailure): BuildFailurePresentation {
  switch (failure.cliError?.code) {
    case "validation_failed":
    case "build_validation_failed":
      return { title: "项目校验未通过", hint: "请根据下方问题列表修复后重试；仅警告时可在高级选项中允许警告。" };
    case "build_path_error":
      return { title: "输出目录不合法", hint: "输出目录不能是项目根目录或其上级，也不能位于 content/、renderers/、.galstudio/ 内。" };
    case "desktop_worker_unavailable":
      return { title: "找不到桌面打包组件", hint: "应用安装不完整，请重新安装 VibeGal-Studio。" };
    case "desktop_tauri_player_unavailable":
      return { title: "找不到 Tauri 轻量 Player", hint: "应用安装不完整，或检查 VIBEGAL_TAURI_PLAYER 配置。" };
    case "desktop_worker_failed":
      return { title: "桌面打包失败", hint: "桌面构建需要系统安装 Node.js（或配置 VIBEGAL_NODE 环境变量）。" };
    case "desktop_worker_invalid_output":
      return { title: "桌面打包组件返回了无法解析的结果", hint: "应用与打包组件版本可能不匹配。" };
    case "desktop_base_path_unsupported":
      return { title: "桌面构建不支持自定义 base path", hint: null };
    case "renderer_compile_failed":
      return { title: "界面风格编译失败", hint: "请根据下方诊断修复界面风格代码后重试。" };
    default:
      return { title: "构建失败", hint: null };
  }
}

/** 与 Workspace.tsx 的 projectIssueSourceLabel 保持一致（这里独立一份避免循环依赖） */
export function exportIssueSourceLabel(source: string): string {
  if (source === "graph") return "图结构";
  if (source === "node") return "节点内容";
  if (source === "asset") return "资产";
  if (source === "meta") return "项目设置";
  if (source === "manifest") return "资源登记表";
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

export const RUNTIME_OPTIONS: { id: DesktopRuntime; name: string; badge: string; description: string }[] = [
  {
    id: "electron",
    name: "Electron 兼容模式",
    badge: "默认",
    description: "内置固定 Chromium，跨机器表现一致。首次构建需下载运行时（约 100MB），之后复用本地缓存。",
  },
  {
    id: "tauri",
    name: "Tauri 轻量模式",
    badge: "轻量",
    description: "使用系统网页引擎，产物体积更小；引擎版本随操作系统更新，不同机器表现可能有差异。",
  },
];
