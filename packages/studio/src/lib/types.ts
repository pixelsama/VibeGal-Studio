/**
 * 项目相关类型 —— studio 与 Rust 后端之间的数据契约。
 */

/** gal.project.json 的结构 */
export interface ProjectMeta {
  name: string;
  activeRendererId: string;
  createdAt: string;
}

/** 列表里的一项（轻量，不含剧本数据） */
export interface ProjectListItem {
  /** 项目根目录的绝对路径 */
  path: string;
  meta: ProjectMeta;
}

/** 打开项目后拿到的完整数据 */
export interface ProjectData {
  path: string;
  meta: ProjectMeta;
  content: {
    manifest: unknown;
    meta: unknown;
    chapters: { relPath: string; data: unknown }[];
  };
  /** 项目内可用的渲染层 id 列表（= renderers/ 子目录名） */
  rendererIds: string[];
}
