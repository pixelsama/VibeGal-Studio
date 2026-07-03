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

/** 图节点（graph.json 中的一项） */
export interface GraphNode {
  id: string;
  title: string;
  /** 相对 content 根，如 "nodes/prologue.json" */
  file: string;
  position: { x: number; y: number };
}

/** 图边 */
export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  condition: unknown | null;
}

/** 完整图 */
export interface ProjectGraph {
  version: number;
  entryNodeId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** true = 内存从 chapters 合成，graph.json 不存在 */
  synthetic?: boolean;
}

/** 单个节点的指令数据（open_project 已读好的） */
export interface NodeEntry {
  /** = graph node 的 file */
  relPath: string;
  /** null = 文件缺失/读取失败 */
  data: unknown | null;
}

export type GraphIssueSeverity = "error" | "warn";

export interface GraphIssue {
  severity: GraphIssueSeverity;
  code: string;
  message: string;
  file?: string;
  jsonPath?: string;
  nodeId?: string;
  edgeId?: string;
}

export interface GraphReport {
  graphIssues: GraphIssue[];
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
  /** 图结构；合成模式下 synthetic=true */
  graph?: ProjectGraph;
  /** 各节点的指令数据（按 graph.nodes 的 file 读取） */
  nodes?: NodeEntry[];
  /** 图结构一致性报告；问题不阻断项目加载 */
  graphReport?: GraphReport;
}
