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
  Manifest,
  ProjectData,
  ProjectGraph,
  ProjectListItem,
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

/** 把指定目录初始化为 GalStudio 项目（不额外套子目录），然后打开 */
export async function initializeProject(path: string): Promise<ProjectData> {
  return invoke<ProjectData>("initialize_project", { path });
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
export async function saveFile(projectPath: string, relPath: string, content: string): Promise<void> {
  await invoke("save_file", { projectPath, relPath, content });
}

/** 保存图结构到 content/graph.json */
export async function saveGraph(projectPath: string, graph: ProjectGraph): Promise<void> {
  const { synthetic: _synthetic, ...payload } = graph;
  await invoke("save_graph", { projectPath, graph: payload });
}

/** 删除 content/ 下的单个文件（relPath 相对 content 根） */
export async function deleteFile(projectPath: string, relPath: string): Promise<void> {
  await invoke("delete_file", { projectPath, relPath });
}

/** 更新 gal.project.json（用于持久化 activeRendererId 等） */
export async function saveProjectMeta(projectPath: string, meta: ProjectMeta): Promise<void> {
  await invoke("save_project_meta", { projectPath, meta });
}

/** 读取一个渲染层目录的所有 .ts/.tsx 源码（供前端运行时编译） */
export interface RendererFile {
  path: string;
  content: string;
}
export async function readRendererFiles(projectPath: string, rendererId: string): Promise<RendererFile[]> {
  return invoke<RendererFile[]>("read_renderer_files", { projectPath, rendererId });
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
export async function deleteAsset(projectPath: string, relPath: string): Promise<void> {
  await invoke("delete_asset", { projectPath, relPath });
}

/** 读取 content/ 下的图片资产预览，返回 data URL（后端校验路径不越界）。 */
export async function readAssetPreviewDataUrl(projectPath: string, relPath: string): Promise<string> {
  return invoke<string>("read_asset_preview_data_url", { projectPath, relPath });
}

/** 保存 content/manifest.json（整体覆盖，类型化输入） */
export async function saveManifest(projectPath: string, manifest: Manifest): Promise<void> {
  await invoke("save_manifest", { projectPath, manifest });
}
