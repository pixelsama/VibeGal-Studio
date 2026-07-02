/**
 * Tauri 后端命令的封装。
 *
 * 前端不直接读写文件系统，全部走 Rust 后端的 #[tauri::command]。
 * 这样权限、路径校验、错误处理都集中在 Rust 侧，前端只拿结构化结果。
 */
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { ProjectData, ProjectListItem, ProjectMeta } from "./types";

/** 弹出「选择文件夹」对话框，返回用户选的绝对路径 */
export async function pickDirectory(): Promise<string | null> {
  const selected = await openDialog({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
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

/** 保存单个文件（相对项目根的路径） */
export async function saveFile(projectPath: string, relPath: string, content: string): Promise<void> {
  await invoke("save_file", { projectPath, relPath, content });
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
