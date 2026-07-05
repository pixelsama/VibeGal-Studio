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

export interface FileRevision {
  relPath: string;
  mtimeMs: number;
  size: number;
  sha256?: string;
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
  mode?: "linear" | "choice" | "auto";
  label?: string | null;
  condition: string | null;
}

/** 完整图 */
export interface ProjectGraph {
  version: number;
  entryNodeId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphPositionPatch {
  id: string;
  position: { x: number; y: number };
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

/**
 * 资产一致性报告：磁盘文件 ↔ manifest 声明之间的不一致。
 * 复用 GraphIssue 结构（severity/code/message/file/jsonPath），与 graphReport 同构。
 */
export interface AssetReport {
  assetIssues: GraphIssue[];
}

// ──────────────────────────────────────────────
// 全局项目报告：图结构 + 资产 + manifest 三类问题汇总。
// 驱动 Workspace 级的全局 StatusPanel（绿勾=全项目无问题）。
// ──────────────────────────────────────────────

/** 问题来源，决定全局面板的分组 */
export type ProjectIssueSource = "graph" | "node" | "asset" | "manifest" | "meta";

export interface ProjectIssue {
  severity: GraphIssueSeverity;
  /** 问题来源，全局面板按此分组 */
  source: ProjectIssueSource;
  code: string;
  message: string;
  file?: string;
  jsonPath?: string;
  nodeId?: string;
  edgeId?: string;
}

export interface ProjectReport {
  projectIssues: ProjectIssue[];
}

export interface GraphIssueFocusRequest {
  requestId: number;
  nodeId?: string;
  edgeId?: string;
  jsonPath?: string;
}

// ──────────────────────────────────────────────
// manifest 数据模型（与 engine 的 ManifestSchema 对齐）
// ──────────────────────────────────────────────

export interface ManifestCharacter {
  name: string;
  color: string;
  /** expr → 路径（相对 content 根） */
  sprites: Record<string, string>;
}

/** audio 拆成 bgm/sfx/voice 三张子表，与 Bgm/Sfx/Voice 指令一一对应 */
export interface ManifestAudio {
  bgm: Record<string, string>;
  sfx: Record<string, string>;
  voice: Record<string, string>;
}

export interface Manifest {
  characters: Record<string, ManifestCharacter>;
  backgrounds: Record<string, string>;
  audio: ManifestAudio;
}

/** 空的 manifest 常量，用于渲染层 props 的回退值（保持 audio 三子表结构合法）。 */
export const EMPTY_MANIFEST: Manifest = {
  characters: {},
  backgrounds: {},
  audio: { bgm: {}, sfx: {}, voice: {} },
};

// ──────────────────────────────────────────────
// 资产扫描结果（list_assets 命令返回）
// ──────────────────────────────────────────────

/** 资产 kind，由 content/assets/ 下的目录前缀推断（与 Rust AssetKind 对齐） */
export type AssetKind =
  | "background"
  | "character"
  | "bgm"
  | "sfx"
  | "voice"
  | "unknown";

export interface AssetEntry {
  /** 相对 content 根的路径，如 "assets/backgrounds/ocean.svg" */
  relPath: string;
  /** 文件字节数 */
  size: number;
  kind: AssetKind;
  revision?: FileRevision;
}

/** 打开项目后拿到的完整数据 */
export interface ProjectData {
  path: string;
  meta: ProjectMeta;
  content: {
    /** manifest.json，结构由 engine 的 ManifestSchema 定义；这里窄化为 Manifest */
    manifest: Manifest;
    meta: unknown;
  };
  /** 项目内可用的渲染层 id 列表（= renderers/ 子目录名） */
  rendererIds: string[];
  /** gal.project.json 的 revision，用于渲染层切换等项目级写入冲突检测 */
  projectRevision?: FileRevision;
  /** 图结构；项目剧本入口来自 content/graph.json */
  graph?: ProjectGraph;
  /** 各节点的指令数据（按 graph.nodes 的 file 读取） */
  nodes?: NodeEntry[];
  graphRevision?: FileRevision;
  manifestRevision?: FileRevision;
  /** content/meta.json 的 revision，用于项目全局设置写入冲突检测 */
  metaRevision?: FileRevision;
  nodeRevisions?: Record<string, FileRevision | null>;
  /** 图结构一致性报告；问题不阻断项目加载 */
  graphReport?: GraphReport;
  /** 资产一致性报告；问题不阻断项目加载 */
  assetReport?: AssetReport;
  /** 全局聚合报告（图结构+资产+manifest）；驱动 Workspace 级 StatusPanel */
  projectReport?: ProjectReport;
}
