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
import type { VariableRegistry } from "@vibegal/engine";
import { normalizeManifest } from "./normalizeManifest";

/** 后端原样返回 manifest.json 原文（不套用 schema 默认值），统一补齐缺省注册表后再交给 UI */
function withNormalizedManifest(data: ProjectData): ProjectData {
  if (!data?.content) return data;
  return { ...data, content: { ...data.content, manifest: normalizeManifest(data.content.manifest) } };
}

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

/** 总览导入选择所有可自动分类的资产，再交给 planAssetDrop 统一规划。 */
export async function pickOverviewAssetFiles(): Promise<string[]> {
  const extensions = [...new Set([
    ...ASSET_FILTERS.background.extensions,
    ...ASSET_FILTERS.bgm.extensions,
    ...ASSET_FILTERS.video.extensions,
    ...ASSET_FILTERS.font.extensions,
  ])];
  const selected = await openDialog({
    multiple: true,
    filters: [{ name: "Assets", extensions }],
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
  return withNormalizedManifest(await invoke<ProjectData>("open_project", { path }));
}

export type ProjectTemplate = "blank" | "example";

/** 在指定目录初始化一个新项目（复制默认模板，写 gal.project.json） */
export async function createProject(
  parentDir: string,
  name: string,
  template: ProjectTemplate,
): Promise<ProjectData> {
  return withNormalizedManifest(await invoke<ProjectData>("create_project", {
    parentDir,
    name,
    template,
  }));
}

/** 把指定目录初始化为 VibeGal-Studio 项目（不额外套子目录），然后打开 */
export async function initializeProject(path: string): Promise<ProjectData> {
  return withNormalizedManifest(await invoke<ProjectData>("initialize_project", { path }));
}

function withExpectedRevision<T extends Record<string, unknown>>(
  args: T,
  expectedRevision?: FileRevision | null,
): T & { expectedRevision?: FileRevision | null } {
  return expectedRevision === undefined ? args : { ...args, expectedRevision };
}

/** 把缺失的项目辅助文件补齐；只会由用户显式操作触发，不覆盖已有文件。 */
export async function repairProjectSupportFiles(projectPath: string): Promise<string[]> {
  return invoke<string[]>("repair_project_support_files", { projectPath });
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

/** 计算渲染层完整源码树指纹；用于按「项目路径 + 内容」持久化信任。 */
export async function rendererSourceFingerprint(projectPath: string, rendererId: string): Promise<string> {
  return invoke<string>("renderer_source_fingerprint", { projectPath, rendererId });
}

/** 读取一个界面风格的源码快照及其严格对应的内容指纹。 */
export interface RendererFile {
  path: string;
  content: string;
}

export interface RendererSource {
  files: RendererFile[];
  fingerprint: string;
}

export async function readRendererSource(projectPath: string, rendererId: string): Promise<RendererSource> {
  return invoke<RendererSource>("read_renderer_source", { projectPath, rendererId });
}

/** 读取一个渲染层目录的所有 .ts/.tsx 源码（供前端运行时编译） */
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

/** 保存 content/variables.json，使用独立 revision 防止覆盖外部修改。 */
export async function saveVariables(
  projectPath: string,
  variables: VariableRegistry,
  expectedRevision?: FileRevision | null,
): Promise<FileRevision | null> {
  return invoke<FileRevision | null>("save_variables", withExpectedRevision({ projectPath, variables }, expectedRevision));
}

export interface RenameVariableResult {
  variablesRevision: FileRevision | null;
  graphRevision: FileRevision | null;
  updatedConditions: number;
  updatedEdgeEffects: number;
  updatedNodes: number;
}

/**
 * 重命名故事状态，并改写所有引用。
 *
 * 后端一次性改注册表、图条件和 set 指令：三者各有独立 revision 守卫，前端串行
 * 保存中途失败会留下半改状态（条件指向已不存在的变量）。
 */
export async function renameVariable(
  projectPath: string,
  from: string,
  to: string,
): Promise<RenameVariableResult> {
  return invoke<RenameVariableResult>("rename_variable", { projectPath, from, to });
}

// ──────────────────────────────────────────────
// 应用级设置（非项目级，存到 app config 目录）
// ──────────────────────────────────────────────

export interface AppSettings {
  theme: "system" | "dark" | "light";
  rendererTrust?: Record<string, string>;
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

let appSettingsMutationQueue = Promise.resolve();

/**
 * 串行执行应用设置的 read-modify-write，避免主题与界面风格信任互相覆盖。
 * 每次都从后端读取最新快照，失败不会阻断后续更新。
 */
export function updateAppSettings(
  update: (current: AppSettings) => AppSettings,
): Promise<AppSettings> {
  const operation = appSettingsMutationQueue.then(async () => {
    const current = await loadAppSettings();
    const next = update(current);
    await saveAppSettings(next);
    return next;
  });
  appSettingsMutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

/** 只更新主题，保留同期写入的界面风格信任。 */
export async function saveThemeSetting(theme: AppSettings["theme"]): Promise<void> {
  await updateAppSettings((current) => ({ ...current, theme }));
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
// 游戏构建（后端 game_build.rs 的薄封装）
// ──────────────────────────────────────────────

export type DesktopRuntime = "electron" | "tauri";

interface CommonBuildRequest {
  projectPath: string;
  outDir: string;
  /** 前端生成的构建标识；进度事件与取消命令靠它关联同一次构建 */
  buildId?: string;
  rendererId?: string;
  strict?: boolean;
  allowWarnings?: boolean;
}

export interface WebBuildRequest extends CommonBuildRequest {}

export interface DesktopBuildRequest extends CommonBuildRequest {
  /** 缺省时后端按 electron（兼容模式）处理 */
  runtime?: DesktopRuntime;
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

export interface WebBuildResult extends DesktopBuildResult {
  target: "web";
  runtime?: never;
  mode?: never;
  executable?: never;
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
export type WebBuildOutcome = WebBuildResult | DesktopBuildFailure;
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

export function isWebBuildResult(value: unknown): value is WebBuildResult {
  return isDesktopBuildResult(value) && value.target === "web";
}

/** 发起 Web 游戏构建；失败统一返回结构化结果而不抛异常。 */
export async function buildWebGame(request: WebBuildRequest): Promise<WebBuildOutcome> {
  try {
    const value = await invoke<unknown>("build_web_game", { request });
    if (isWebBuildResult(value)) return value;
    return {
      ok: false,
      code: "desktop_build_invalid_output",
      message: "构建工具返回了无法识别的 Web 结果",
      cliError: null,
    };
  } catch (error) {
    return normalizeDesktopBuildFailure(error);
  }
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

export interface WebSmokeRequest {
  distDir: string;
}

export interface DesktopSmokeRequest extends WebSmokeRequest {
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

export interface WebSmokeResult extends DesktopSmokeResult {
  target: "web";
  runtime?: never;
  mode?: never;
}

export type WebSmokeOutcome = WebSmokeResult | DesktopBuildFailure;
export type DesktopSmokeOutcome = DesktopSmokeResult | DesktopBuildFailure;

function isDesktopSmokeResult(value: unknown): value is DesktopSmokeResult {
  return isRecord(value) && value.ok === true && Array.isArray(value.checks);
}

function isWebSmokeResult(value: unknown): value is WebSmokeResult {
  return isDesktopSmokeResult(value) && value.target === "web";
}

/** 对 Web 构建产物运行静态与浏览器 smoke。 */
export async function smokeWebGame(request: WebSmokeRequest): Promise<WebSmokeOutcome> {
  try {
    const value = await invoke<unknown>("smoke_web_game", { request });
    if (isWebSmokeResult(value)) return value;
    return {
      ok: false,
      code: "desktop_build_invalid_output",
      message: "smoke 工具返回了无法识别的 Web 结果",
      cliError: null,
    };
  } catch (error) {
    return normalizeDesktopBuildFailure(error);
  }
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
