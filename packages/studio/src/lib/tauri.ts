/**
 * Tauri 后端命令的封装。
 *
 * 前端不直接读写文件系统，全部走 Rust 后端的 #[tauri::command]。
 * 这样权限、路径校验、错误处理都集中在 Rust 侧，前端只拿结构化结果。
 */
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type {
  AssetEntry,
  AssetKind,
  FileRevision,
  GraphPositionPatch,
  Manifest,
  ProjectData,
  ProjectGraph,
  ProjectIssue,
  ProjectListItem,
  SaveNodeResult,
  ProjectMeta,
} from "./types";

/** 弹出「选择文件夹」对话框，返回用户选的绝对路径 */
export async function pickDirectory(): Promise<string | null> {
  const selected = await openDialog({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
}

/** 按资产 kind 选择对应的文件类型过滤器（用于导入对话框） */
const ASSET_FILTERS: Record<Exclude<AssetKind, "unknown">, { name: string; extensions: string[] }> = {
  background: { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp"] },
  character: { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp"] },
  bgm: { name: "Audio", extensions: ["mp3", "wav", "ogg", "flac", "m4a", "aac"] },
  sfx: { name: "Audio", extensions: ["mp3", "wav", "ogg", "flac", "m4a", "aac"] },
  voice: { name: "Audio", extensions: ["mp3", "wav", "ogg", "flac", "m4a", "aac"] },
  cg: { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp"] },
  video: { name: "Video", extensions: ["mp4", "webm", "mov", "mkv"] },
  font: { name: "Fonts", extensions: ["ttf", "otf", "woff", "woff2"] },
  ui: { name: "UI Assets", extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp", "json", "css"] },
  animation: { name: "Animation Atlases", extensions: ["png", "jpg", "jpeg", "webp", "json"] },
};

/**
 * 弹出「选择文件」对话框，按 kind 过滤扩展名，可多选。
 * 返回用户选中的绝对路径列表（取消则空数组）。
 */
export async function pickAssetFiles(kind: Exclude<AssetKind, "unknown">): Promise<string[]> {
  const selected = await openDialog({
    multiple: true,
    filters: [ASSET_FILTERS[kind]],
  });
  if (selected === null) return [];
  return Array.isArray(selected) ? selected : [selected];
}

/** 扫描某个工作区目录下的所有项目（含 gal.project.json 的子目录） */
export async function listProjects(workspaceDir: string): Promise<ProjectListItem[]> {
  return invoke<ProjectListItem[]>("list_projects", { workspaceDir });
}

/** 打开项目：读取 gal.project.json + content + 渲染层列表 */
export async function openProject(path: string): Promise<ProjectData> {
  return invoke<ProjectData>("open_project", { path });
}

/** 在指定目录初始化一个新项目（复制默认模板，写 gal.project.json） */
export async function createProject(parentDir: string, name: string): Promise<ProjectData> {
  return invoke<ProjectData>("create_project", { parentDir, name });
}

/** 把指定目录初始化为 VibeGal-Studio 项目（不额外套子目录），然后打开 */
export async function initializeProject(path: string): Promise<ProjectData> {
  return invoke<ProjectData>("initialize_project", { path });
}

function withExpectedRevision<T extends Record<string, unknown>>(
  args: T,
  expectedRevision?: FileRevision | null,
): T & { expectedRevision?: FileRevision | null } {
  return expectedRevision === undefined ? args : { ...args, expectedRevision };
}

/** 开始监听项目目录变化，后端会 debounce 后发 project_changed 事件 */
export async function watchProject(projectPath: string): Promise<void> {
  await invoke("watch_project", { projectPath });
}

/** 停止监听项目目录变化 */
export async function unwatchProject(projectPath: string): Promise<void> {
  await invoke("unwatch_project", { projectPath });
}

/** 保存单个文件（相对项目根的路径） */
export async function saveFile(
  projectPath: string,
  relPath: string,
  content: string,
  expectedRevision?: FileRevision | null,
): Promise<FileRevision | null> {
  return invoke<FileRevision | null>("save_file", withExpectedRevision({ projectPath, relPath, content }, expectedRevision));
}

/** 保存 graph 引用的节点，并在后端补齐缺失的 story-point ID。 */
export async function saveNode(
  projectPath: string,
  nodeFile: string,
  instructions: unknown[],
  expectedRevision?: FileRevision | null,
): Promise<SaveNodeResult> {
  return invoke<SaveNodeResult>(
    "save_node",
    withExpectedRevision({ projectPath, nodeFile, instructions }, expectedRevision),
  );
}

/** 保存图结构到 content/graph.json */
export async function saveGraph(
  projectPath: string,
  graph: ProjectGraph,
  expectedRevision?: FileRevision | null,
): Promise<FileRevision | null> {
  return invoke<FileRevision | null>("save_graph", withExpectedRevision({ projectPath, graph }, expectedRevision));
}

/** 只保存图节点 position patch，避免拖拽覆盖外部新增节点/边 */
export async function saveGraphPositions(
  projectPath: string,
  updates: GraphPositionPatch[],
  expectedRevision?: FileRevision | null,
): Promise<FileRevision | null> {
  return invoke<FileRevision | null>("save_graph_positions", withExpectedRevision({ projectPath, updates }, expectedRevision));
}

/** 删除 content/ 下的单个文件（relPath 相对 content 根） */
export async function deleteFile(
  projectPath: string,
  relPath: string,
  expectedRevision?: FileRevision | null,
): Promise<void> {
  await invoke("delete_file", withExpectedRevision({ projectPath, relPath }, expectedRevision));
}

/** 更新 gal.project.json（用于持久化 activeRendererId 等） */
export async function saveProjectMeta(
  projectPath: string,
  meta: ProjectMeta,
  expectedRevision?: FileRevision | null,
): Promise<FileRevision | null> {
  return invoke<FileRevision | null>("save_project_meta", withExpectedRevision({ projectPath, meta }, expectedRevision));
}

/** 读取一个渲染层目录的所有 .ts/.tsx 源码（供前端运行时编译） */
export interface RendererFile {
  path: string;
  content: string;
}
export async function readRendererFiles(projectPath: string, rendererId: string): Promise<RendererFile[]> {
  return invoke<RendererFile[]>("read_renderer_files", { projectPath, rendererId });
}

export async function createRenderer(projectPath: string, rendererId: string, templateId = "default"): Promise<void> {
  await invoke("create_renderer", { projectPath, rendererId, templateId });
}

export async function duplicateRenderer(projectPath: string, sourceId: string, newId: string): Promise<void> {
  await invoke("duplicate_renderer", { projectPath, sourceId, newId });
}

export async function renameRenderer(projectPath: string, oldId: string, newId: string): Promise<void> {
  await invoke("rename_renderer", { projectPath, oldId, newId });
}

export async function deleteRenderer(projectPath: string, rendererId: string): Promise<void> {
  await invoke("delete_renderer", { projectPath, rendererId });
}

// ──────────────────────────────────────────────
// 资产管理
// ──────────────────────────────────────────────

/** 列出 content/assets/ 下的所有资产文件（递归扫描，含 kind 推断与大小） */
export async function listAssets(projectPath: string): Promise<AssetEntry[]> {
  return invoke<AssetEntry[]>("list_assets", { projectPath });
}

/**
 * 导入资产：把外部文件拷贝进 content/assets/。
 * - sourceAbsPath：对话框返回的外部文件绝对路径
 * - destRelPath：目标相对 content 根的路径（前端按 kind 拼好子目录）
 * 目标已存在时会报错（后端不静默覆盖）。
 */
export async function importAsset(
  projectPath: string,
  sourceAbsPath: string,
  destRelPath: string,
): Promise<void> {
  await invoke("import_asset", { projectPath, sourceAbsPath, destRelPath });
}

/** 删除 content/ 下的资产文件（relPath 相对 content 根，幂等）。只删文件，不改 manifest。 */
export async function deleteAsset(
  projectPath: string,
  relPath: string,
  expectedRevision?: FileRevision | null,
): Promise<void> {
  await invoke("delete_asset", withExpectedRevision({ projectPath, relPath }, expectedRevision));
}

/** 读取 content/ 下的图片资产预览，返回 data URL（后端校验路径不越界）。 */
export async function readAssetPreviewDataUrl(projectPath: string, relPath: string): Promise<string> {
  return invoke<string>("read_asset_preview_data_url", { projectPath, relPath });
}

/** 保存 content/manifest.json（整体覆盖，类型化输入） */
export async function saveManifest(
  projectPath: string,
  manifest: Manifest,
  expectedRevision?: FileRevision | null,
): Promise<FileRevision | null> {
  return invoke<FileRevision | null>("save_manifest", withExpectedRevision({ projectPath, manifest }, expectedRevision));
}

// ──────────────────────────────────────────────
// 应用级设置（非项目级，存到 app config 目录）
// ──────────────────────────────────────────────

export interface AppSettings {
  theme: "system" | "dark" | "light";
}

export interface CliToolStatus {
  command: string;
  cliPath: string;
  linkPath: string;
  installed: boolean;
  cliAvailable: boolean;
  linkOccupied: boolean;
  inPath: boolean;
  issue: string | null;
}

/** 加载应用设置；文件不存在（首次运行）时后端返回默认值（system）。 */
export async function loadAppSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("load_app_settings");
}

/** 保存应用设置。 */
export async function saveAppSettings(settings: AppSettings): Promise<void> {
  await invoke("save_app_settings", { settings });
}

/** 检查 vibegal-cli 是否已通过 VibeGal-Studio 管理的 symlink 安装到 PATH。 */
export async function getCliToolStatus(): Promise<CliToolStatus> {
  return invoke<CliToolStatus>("cli_tool_status");
}

/** 显式安装 vibegal-cli 命令行链接。 */
export async function installCliTool(): Promise<CliToolStatus> {
  return invoke<CliToolStatus>("install_cli_tool");
}

/** 卸载 VibeGal-Studio 管理的 vibegal-cli 命令行链接。 */
export async function uninstallCliTool(): Promise<CliToolStatus> {
  return invoke<CliToolStatus>("uninstall_cli_tool");
}

// ──────────────────────────────────────────────
// 桌面游戏构建（后端 game_build.rs 的薄封装）
// ──────────────────────────────────────────────

export type DesktopRuntime = "electron" | "tauri";

export interface DesktopBuildRequest {
  projectPath: string;
  outDir: string;
  /** 缺省时后端按 electron（兼容模式）处理 */
  runtime?: DesktopRuntime;
  /** 前端生成的构建标识；进度事件与取消命令靠它关联同一次构建 */
  buildId?: string;
  rendererId?: string;
  strict?: boolean;
  allowWarnings?: boolean;
}

/** CLI 桌面构建成功的结构化结果（对应 CLI BuildOutput，ok 恒为 true） */
export interface DesktopBuildResult {
  ok: true;
  target: string;
  outDir: string;
  rendererId: string;
  runtime?: DesktopRuntime;
  mode?: "compatible" | "lightweight";
  executable?: string;
  artifacts: string[];
  warnings: ProjectIssue[];
}

/** CLI 渲染层诊断条目（BuildError.diagnostics 的元素） */
export interface DesktopBuildDiagnostic {
  severity?: "error" | "warn";
  code?: string;
  message: string;
  step?: string;
  file?: string;
  line?: number;
  column?: number;
}

/** CLI 写到 stderr 的结构化构建错误（BuildError），随失败一起返回 */
export interface DesktopCliError {
  code?: string;
  message?: string;
  step?: string;
  file?: string;
  rendererId?: string;
  line?: number;
  column?: number;
  diagnostics?: DesktopBuildDiagnostic[];
  issues?: ProjectIssue[];
}

/** 构建失败的结构化结果（对应后端 DesktopBuildFailure，ok 恒为 false） */
export interface DesktopBuildFailure {
  ok: false;
  code: string;
  message: string;
  cliError?: DesktopCliError | null;
}

/** 构建结果判别联合：用 ok 字段区分成功与失败 */
export type DesktopBuildOutcome = DesktopBuildResult | DesktopBuildFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** invoke 的 reject 值是序列化后的普通对象而非 Error，这里统一规范化为 DesktopBuildFailure */
export function normalizeDesktopBuildFailure(error: unknown): DesktopBuildFailure {
  if (isRecord(error) && typeof error.code === "string" && typeof error.message === "string") {
    return {
      ok: false,
      code: error.code,
      message: error.message,
      cliError: isRecord(error.cliError) ? (error.cliError as DesktopCliError) : null,
    };
  }
  return {
    ok: false,
    code: "desktop_build_unknown",
    message: error instanceof Error ? error.message : String(error),
    cliError: null,
  };
}

export function isDesktopBuildResult(value: unknown): value is DesktopBuildResult {
  return isRecord(value) && value.ok === true && typeof value.outDir === "string";
}

/**
 * 发起桌面游戏构建。构建失败（含项目校验不通过）是预期内结果，
 * 因此本函数不抛异常，统一以 DesktopBuildOutcome 返回；只有完全无法
 * 归类的错误才会被包装成 code = "desktop_build_unknown" 的失败。
 */
export async function buildDesktopGame(request: DesktopBuildRequest): Promise<DesktopBuildOutcome> {
  try {
    const value = await invoke<unknown>("build_desktop_game", { request });
    if (isDesktopBuildResult(value)) return value;
    return {
      ok: false,
      code: "desktop_build_invalid_output",
      message: "构建工具返回了无法识别的结果",
      cliError: null,
    };
  } catch (error) {
    return normalizeDesktopBuildFailure(error);
  }
}

// ──────────────────────────────────────────────
// 构建进度事件 / 取消 / 环境预检 / smoke / 系统交互
// ──────────────────────────────────────────────

/** 后端转发的构建进度事件名（game_build.rs 的 DESKTOP_BUILD_PROGRESS_EVENT） */
export const DESKTOP_BUILD_PROGRESS_EVENT = "desktop_build_progress";

/** 构建进度事件载荷（camelCase，与后端 DesktopBuildProgress 一致） */
export interface DesktopBuildProgressPayload {
  buildId: string;
  projectPath: string;
  /** validate | web-build | desktop-package */
  step: string;
  /** start | done */
  phase: string;
  message: string;
  percent: number | null;
}

/** 取消正在进行的构建。后端找不到该构建时会 reject DesktopBuildFailure 对象。 */
export async function cancelDesktopGameBuild(buildId: string): Promise<void> {
  await invoke("cancel_desktop_game_build", { buildId });
}

/** doctor 预检报告（对应 CLI DoctorOutput + 后端注入的 cliAvailable） */
export interface DesktopBuildPreflight {
  ok: boolean;
  cliAvailable: boolean;
  node?: {
    available: boolean;
    version: string | null;
    source: string | null;
    path: string | null;
  };
  electron?: {
    cached: boolean;
    version: string;
    overridePath: string | null;
  };
  tauriPlayer?: {
    available: boolean;
    path: string | null;
  };
  exporter?: {
    webWorker: boolean;
    desktopWorker: boolean;
  };
  /** doctor 进程本身失败时的错误说明（前端展示用） */
  error?: string;
}

/**
 * 构建环境预检。CLI 缺失时返回 { ok: false, cliAvailable: false }（不是异常）；
 * doctor 进程失败也不抛异常，在 error 字段里带回说明。
 */
export async function desktopBuildPreflight(): Promise<DesktopBuildPreflight> {
  try {
    const value = await invoke<DesktopBuildPreflight>("desktop_build_preflight");
    return value;
  } catch (error) {
    const failure = normalizeDesktopBuildFailure(error);
    return { ok: false, cliAvailable: true, error: failure.message };
  }
}

export interface DesktopSmokeRequest {
  distDir: string;
  /** 缺省时后端按 electron 处理 */
  runtime?: DesktopRuntime;
}

/** 桌面 smoke 成功结果（对应 CLI SmokeOutput，ok 恒为 true） */
export interface DesktopSmokeResult {
  ok: true;
  target: string;
  distDir: string;
  basePath: string;
  runtime?: DesktopRuntime;
  mode?: "compatible" | "lightweight";
  checks: string[];
}

export type DesktopSmokeOutcome = DesktopSmokeResult | DesktopBuildFailure;

function isDesktopSmokeResult(value: unknown): value is DesktopSmokeResult {
  return isRecord(value) && value.ok === true && Array.isArray(value.checks);
}

/**
 * 对构建产物运行桌面 smoke（会真实启动游戏窗口，最长约 30 秒）。
 * 与构建一样，失败以 DesktopSmokeOutcome 返回而不抛异常。
 */
export async function smokeDesktopGame(request: DesktopSmokeRequest): Promise<DesktopSmokeOutcome> {
  try {
    const value = await invoke<unknown>("smoke_desktop_game", { request });
    if (isDesktopSmokeResult(value)) return value;
    return {
      ok: false,
      code: "desktop_build_invalid_output",
      message: "smoke 工具返回了无法识别的结果",
      cliError: null,
    };
  } catch (error) {
    return normalizeDesktopBuildFailure(error);
  }
}

/** 在系统文件管理器中显示路径（目录或文件均可）。失败时 reject 中文字符串。 */
export async function revealPath(path: string): Promise<void> {
  await invoke("reveal_path", { path });
}

/** 运行构建产物（executable 取构建成功结果里的绝对路径）。失败时 reject 中文字符串。 */
export async function runDesktopGame(executable: string): Promise<void> {
  await invoke("run_desktop_game", { executable });
}
