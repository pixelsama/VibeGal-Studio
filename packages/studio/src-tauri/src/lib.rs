// GalStudio Tauri 后端 —— 文件系统操作。
// 所有磁盘读写集中在这里；前端通过 invoke 调用，不直接碰文件系统。

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::{
    mpsc::{self, RecvTimeoutError, Sender},
    Mutex,
};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

#[derive(Serialize, Deserialize, Clone)]
pub struct ProjectMeta {
    pub name: String,
    #[serde(rename = "activeRendererId")]
    pub active_renderer_id: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Serialize, Clone)]
pub struct ProjectListItem {
    pub path: String,
    pub meta: ProjectMeta,
}

#[derive(Serialize, Clone)]
pub struct ChapterEntry {
    #[serde(rename = "relPath")]
    pub rel_path: String,
    pub data: serde_json::Value,
}

#[derive(Serialize, Clone)]
pub struct ProjectContent {
    pub manifest: serde_json::Value,
    pub meta: serde_json::Value,
    pub chapters: Vec<ChapterEntry>,
}

#[derive(Serialize, Clone)]
pub struct GraphPosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Serialize, Clone)]
pub struct GraphNode {
    pub id: String,
    pub title: String,
    pub file: String,
    pub position: GraphPosition,
}

#[derive(Serialize, Clone)]
pub struct GraphEdge {
    pub id: String,
    pub from: String,
    pub to: String,
    pub condition: serde_json::Value,
}

#[derive(Serialize, Clone)]
pub struct ProjectGraph {
    pub version: u32,
    #[serde(rename = "entryNodeId")]
    pub entry_node_id: String,
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub synthetic: bool,
}

#[derive(Serialize, Clone)]
pub struct NodeEntry {
    #[serde(rename = "relPath")]
    pub rel_path: String,
    pub data: Option<serde_json::Value>,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum GraphIssueSeverity {
    #[serde(rename = "error")]
    Error,
    #[serde(rename = "warn")]
    Warn,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct GraphIssue {
    pub severity: GraphIssueSeverity,
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    #[serde(rename = "jsonPath", skip_serializing_if = "Option::is_none")]
    pub json_path: Option<String>,
    #[serde(rename = "nodeId", skip_serializing_if = "Option::is_none")]
    pub node_id: Option<String>,
    #[serde(rename = "edgeId", skip_serializing_if = "Option::is_none")]
    pub edge_id: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct GraphReport {
    #[serde(rename = "graphIssues")]
    pub graph_issues: Vec<GraphIssue>,
}

#[derive(Deserialize)]
pub struct ProjectGraphInput {
    pub version: u32,
    #[serde(rename = "entryNodeId")]
    pub entry_node_id: String,
    pub nodes: Vec<GraphNodeInput>,
    pub edges: Vec<GraphEdgeInput>,
}

#[derive(Deserialize)]
pub struct GraphNodeInput {
    pub id: String,
    pub title: String,
    pub file: String,
    pub position: GraphPositionInput,
}

#[derive(Deserialize)]
pub struct GraphPositionInput {
    pub x: f64,
    pub y: f64,
}

#[derive(Deserialize)]
pub struct GraphEdgeInput {
    pub id: String,
    pub from: String,
    pub to: String,
    pub condition: serde_json::Value,
}

#[derive(Serialize, Clone)]
pub struct ProjectData {
    pub path: String,
    pub meta: ProjectMeta,
    pub content: ProjectContent,
    #[serde(rename = "rendererIds")]
    pub renderer_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub graph: Option<ProjectGraph>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nodes: Option<Vec<NodeEntry>>,
    #[serde(rename = "graphReport", skip_serializing_if = "Option::is_none")]
    pub graph_report: Option<GraphReport>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct ProjectChangedPayload {
    #[serde(rename = "projectPath")]
    pub project_path: String,
    #[serde(rename = "rendererChanged")]
    pub renderer_changed: bool,
}

impl ProjectChangedPayload {
    fn new(project_path: String, renderer_changed: bool) -> Self {
        Self {
            project_path,
            renderer_changed,
        }
    }

    fn merge(&mut self, other: ProjectChangedPayload) {
        self.renderer_changed |= other.renderer_changed;
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProjectWatchKind {
    ProjectMeta,
    Content,
    Renderer,
}

#[derive(Default)]
struct ProjectDebounceState {
    pending: Option<ProjectChangedPayload>,
    last_event_at: Option<Instant>,
}

impl ProjectDebounceState {
    fn record(&mut self, payload: ProjectChangedPayload, now: Instant) {
        match &mut self.pending {
            Some(pending) => pending.merge(payload),
            None => self.pending = Some(payload),
        }
        self.last_event_at = Some(now);
    }

    fn due(&mut self, now: Instant, delay: Duration) -> Option<ProjectChangedPayload> {
        let last_event_at = self.last_event_at?;
        if now.duration_since(last_event_at) < delay {
            return None;
        }
        self.last_event_at = None;
        self.pending.take()
    }
}

enum WatchSignal {
    Changed { renderer_changed: bool },
    Stop,
}

struct ProjectWatchHandle {
    _watcher: RecommendedWatcher,
    stop_tx: Sender<WatchSignal>,
}

#[derive(Default)]
struct ProjectWatchers {
    active: Mutex<HashMap<String, ProjectWatchHandle>>,
}

const PROJECT_CHANGED_EVENT: &str = "project_changed";
const PROJECT_WATCH_DEBOUNCE: Duration = Duration::from_millis(300);
const GRAPH_LAYOUT_COLS: usize = 3;
const GRAPH_LAYOUT_GAP_X: f64 = 260.0;
const GRAPH_LAYOUT_GAP_Y: f64 = 160.0;
const GRAPH_LAYOUT_MARGIN: f64 = 80.0;

pub fn read_project_meta(project_path: &Path) -> Result<ProjectMeta, String> {
    let meta_file = project_path.join("gal.project.json");
    let text = fs::read_to_string(&meta_file).map_err(|e| {
        format!(
            "读取 gal.project.json 失败 ({}): {}",
            meta_file.display(),
            e
        )
    })?;
    serde_json::from_str::<ProjectMeta>(&text)
        .map_err(|e| format!("解析 gal.project.json 失败: {}", e))
}

/// 列出工作区目录下的所有项目（含 gal.project.json 的直接子目录）
#[tauri::command]
fn list_projects(workspace_dir: String) -> Result<Vec<ProjectListItem>, String> {
    let root = Path::new(&workspace_dir);
    if !root.is_dir() {
        return Ok(vec![]);
    }
    let mut items = vec![];
    let entries = fs::read_dir(root).map_err(|e| format!("读取目录失败: {}", e))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() && path.join("gal.project.json").exists() {
            if let Ok(meta) = read_project_meta(&path) {
                items.push(ProjectListItem {
                    path: path.to_string_lossy().into_owned(),
                    meta,
                });
            }
        }
    }
    Ok(items)
}

/// 读取项目内 renderers/ 子目录名
fn list_renderer_ids(project_path: &Path) -> Vec<String> {
    let renderers_dir = project_path.join("renderers");
    if !renderers_dir.is_dir() {
        return vec![];
    }
    let mut ids = vec![];
    if let Ok(entries) = fs::read_dir(&renderers_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            // 一个渲染层 = 含 index.tsx 的子目录
            if p.is_dir() && p.join("index.tsx").exists() {
                if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                    ids.push(name.to_string());
                }
            }
        }
    }
    ids
}

/// 打开项目：读 gal.project.json + content + 渲染层列表
#[tauri::command]
fn open_project(path: String) -> Result<ProjectData, String> {
    open_project_inner(&path)
}

/// 供 CLI 直接调用的项目打开入口（无 #[tauri::command] 宏，可跨 crate 调）。
pub fn open_project_for_cli(path: &str) -> Result<ProjectData, String> {
    open_project_inner(path)
}

fn open_project_inner(path: &str) -> Result<ProjectData, String> {
    let project_path = canonical_project_root(Path::new(path))?;
    let meta = read_project_meta(&project_path)?;

    let content_dir = project_path.join("content");
    let content_root = content_dir
        .canonicalize()
        .map_err(|e| format!("无法定位 content 目录 {}: {}", content_dir.display(), e))?;
    let manifest = read_json(&content_dir.join("manifest.json"))?;
    let meta_json = read_json(&content_dir.join("meta.json"))?;

    // 章节加载顺序：优先遵循 meta.chapters 契约（决定加载哪些 + 顺序）；
    // 仅当 meta 没声明 chapters 时，才 fallback 到扫描 chapters/ 目录。
    let mut chapters = vec![];
    let meta_chapters: Vec<String> = meta_json
        .get("chapters")
        .and_then(|c| c.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    if !meta_chapters.is_empty() {
        // 按 meta 声明的顺序逐个读取（meta 里写的是相对 content 根的路径，如 "chapters/ch01.json"）
        for rel in &meta_chapters {
            let path = resolve_relative_under(&content_root, rel)?;
            if path.exists() {
                let data = read_json(&path)?;
                chapters.push(ChapterEntry {
                    rel_path: rel.clone(),
                    data,
                });
            } else {
                log::warn!("meta.chapters 声明了 {} 但文件不存在，已跳过", rel);
            }
        }
    } else {
        // fallback：扫描 chapters/ 目录（草稿/废弃文件也会被载入，仅为兼容）
        let chapters_dir = content_dir.join("chapters");
        if chapters_dir.is_dir() {
            if let Ok(entries) = fs::read_dir(&chapters_dir) {
                let mut paths: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
                paths.sort();
                for p in paths {
                    if p.extension().and_then(|e| e.to_str()) == Some("json") {
                        let rel = p
                            .strip_prefix(&content_root)
                            .unwrap_or(&p)
                            .to_string_lossy()
                            .replace('\\', "/");
                        let data = read_json(&p)?;
                        chapters.push(ChapterEntry {
                            rel_path: rel,
                            data,
                        });
                    }
                }
            }
        }
    }

    let renderer_ids = list_renderer_ids(&project_path);
    let (graph, nodes) = load_project_graph_data(&content_root, &chapters)?;
    let graph_report = GraphReport {
        graph_issues: validate_graph(&graph, &nodes),
    };

    Ok(ProjectData {
        path: project_path.to_string_lossy().into_owned(),
        meta,
        content: ProjectContent {
            manifest,
            meta: meta_json,
            chapters,
        },
        renderer_ids,
        graph: Some(graph),
        nodes: Some(nodes),
        graph_report: Some(graph_report),
    })
}

pub fn validate_graph(graph: &ProjectGraph, nodes_data: &[NodeEntry]) -> Vec<GraphIssue> {
    let mut issues = vec![];
    let mut seen_node_ids = HashSet::new();
    let mut duplicate_node_ids = HashSet::new();

    for node in &graph.nodes {
        if !seen_node_ids.insert(node.id.clone()) {
            duplicate_node_ids.insert(node.id.clone());
        }
    }
    let mut duplicate_node_ids = duplicate_node_ids.into_iter().collect::<Vec<_>>();
    duplicate_node_ids.sort();
    for node_id in duplicate_node_ids {
        issues.push(GraphIssue {
            severity: GraphIssueSeverity::Error,
            code: "duplicate_node_id".to_string(),
            message: format!("节点 id 重复：{node_id}"),
            file: Some("content/graph.json".to_string()),
            json_path: Some("$.nodes".to_string()),
            node_id: Some(node_id),
            edge_id: None,
        });
    }

    for (index, node) in graph.nodes.iter().enumerate() {
        let missing_file = nodes_data
            .get(index)
            .map(|entry| entry.data.is_none())
            .unwrap_or(true);
        if missing_file {
            issues.push(GraphIssue {
                severity: GraphIssueSeverity::Warn,
                code: "missing_node_file".to_string(),
                message: format!("节点「{}」的文件 {} 不存在", node.title, node.file),
                file: Some(format!("content/{}", node.file)),
                json_path: Some(format!("$.nodes[{index}].file")),
                node_id: Some(node.id.clone()),
                edge_id: None,
            });
        }
    }

    if graph.entry_node_id.is_empty() {
        if !graph.nodes.is_empty() {
            issues.push(GraphIssue {
                severity: GraphIssueSeverity::Warn,
                code: "empty_entry".to_string(),
                message: "未设置入口节点".to_string(),
                file: Some("content/graph.json".to_string()),
                json_path: Some("$.entryNodeId".to_string()),
                node_id: None,
                edge_id: None,
            });
        }
    } else if !seen_node_ids.contains(&graph.entry_node_id) {
        issues.push(GraphIssue {
            severity: GraphIssueSeverity::Error,
            code: "missing_entry_node".to_string(),
            message: format!("入口节点 {} 不存在", graph.entry_node_id),
            file: Some("content/graph.json".to_string()),
            json_path: Some("$.entryNodeId".to_string()),
            node_id: Some(graph.entry_node_id.clone()),
            edge_id: None,
        });
    }

    let mut seen_edge_ids = HashSet::new();
    let mut duplicate_edge_ids = HashSet::new();
    for (index, edge) in graph.edges.iter().enumerate() {
        if !seen_edge_ids.insert(edge.id.clone()) {
            duplicate_edge_ids.insert(edge.id.clone());
        }

        let mut missing = vec![];
        if !seen_node_ids.contains(&edge.from) {
            missing.push(edge.from.as_str());
        }
        if !seen_node_ids.contains(&edge.to) && edge.to != edge.from {
            missing.push(edge.to.as_str());
        }
        if !missing.is_empty() {
            issues.push(GraphIssue {
                severity: GraphIssueSeverity::Warn,
                code: "dangling_edge".to_string(),
                message: format!(
                    "边的端点不存在：edge {} 引用了缺失节点 {}",
                    edge.id,
                    missing.join(", ")
                ),
                file: Some("content/graph.json".to_string()),
                json_path: Some(format!("$.edges[{index}]")),
                node_id: None,
                edge_id: Some(edge.id.clone()),
            });
        }
    }
    let mut duplicate_edge_ids = duplicate_edge_ids.into_iter().collect::<Vec<_>>();
    duplicate_edge_ids.sort();
    for edge_id in duplicate_edge_ids {
        issues.push(GraphIssue {
            severity: GraphIssueSeverity::Warn,
            code: "duplicate_edge_id".to_string(),
            message: format!("边 id 重复：{edge_id}"),
            file: Some("content/graph.json".to_string()),
            json_path: Some("$.edges".to_string()),
            node_id: None,
            edge_id: Some(edge_id),
        });
    }

    issues
}

pub fn load_project_graph_data(
    content_root: &Path,
    chapters: &[ChapterEntry],
) -> Result<(ProjectGraph, Vec<NodeEntry>), String> {
    let graph_path = content_root.join("graph.json");
    if graph_path.is_file() {
        load_graph_file(content_root, &graph_path)
    } else {
        Ok(synthesize_graph_from_chapters(chapters))
    }
}

fn load_graph_file(
    content_root: &Path,
    graph_path: &Path,
) -> Result<(ProjectGraph, Vec<NodeEntry>), String> {
    let graph_raw = read_json(graph_path)?;
    let version = graph_raw
        .get("version")
        .and_then(|value| value.as_u64())
        .unwrap_or(1) as u32;
    let entry_node_id = required_string(&graph_raw, "entryNodeId")?.to_string();

    let mut graph_nodes = vec![];
    if let Some(nodes_raw) = graph_raw.get("nodes") {
        let nodes_array = nodes_raw
            .as_array()
            .ok_or_else(|| "graph.json 的 nodes 必须是数组".to_string())?;
        for node_raw in nodes_array {
            let id = required_string_field(node_raw, "id", "nodes[].id")?;
            if id.is_empty() {
                return Err("graph.json 的 nodes[].id 不能为空".to_string());
            }
            let file = required_string_field(node_raw, "file", "nodes[].file")?;
            let title = node_raw
                .get("title")
                .and_then(|value| value.as_str())
                .unwrap_or(id)
                .to_string();
            let position = node_raw.get("position");
            let x = position
                .and_then(|value| value.get("x"))
                .and_then(|value| value.as_f64())
                .unwrap_or(0.0);
            let y = position
                .and_then(|value| value.get("y"))
                .and_then(|value| value.as_f64())
                .unwrap_or(0.0);
            graph_nodes.push(GraphNode {
                id: id.to_string(),
                title,
                file: file.to_string(),
                position: GraphPosition { x, y },
            });
        }
    }

    let mut graph_edges = vec![];
    if let Some(edges_raw) = graph_raw.get("edges") {
        let edges_array = edges_raw
            .as_array()
            .ok_or_else(|| "graph.json 的 edges 必须是数组".to_string())?;
        for edge_raw in edges_array {
            graph_edges.push(GraphEdge {
                id: required_string_field(edge_raw, "id", "edges[].id")?.to_string(),
                from: required_string_field(edge_raw, "from", "edges[].from")?.to_string(),
                to: required_string_field(edge_raw, "to", "edges[].to")?.to_string(),
                condition: edge_raw
                    .get("condition")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null),
            });
        }
    }

    let mut node_entries = vec![];
    for node in &graph_nodes {
        let node_path = resolve_relative_under(content_root, &node.file)?;
        let data = if node_path.exists() {
            Some(read_json(&node_path)?)
        } else {
            log::warn!("节点 {} 的文件 {} 不存在，已跳过", node.id, node.file);
            None
        };
        node_entries.push(NodeEntry {
            rel_path: node.file.clone(),
            data,
        });
    }

    Ok((
        ProjectGraph {
            version,
            entry_node_id,
            nodes: graph_nodes,
            edges: graph_edges,
            synthetic: false,
        },
        node_entries,
    ))
}

fn synthesize_graph_from_chapters(chapters: &[ChapterEntry]) -> (ProjectGraph, Vec<NodeEntry>) {
    let mut used_ids = HashSet::new();
    let mut graph_nodes = vec![];
    let mut graph_edges = vec![];
    let mut prev_id: Option<String> = None;

    for (index, chapter) in chapters.iter().enumerate() {
        let stem = Path::new(&chapter.rel_path)
            .file_stem()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .unwrap_or("chapter");
        let id = ensure_unique_graph_id(stem, &mut used_ids);
        let position = auto_layout_graph_position(index);

        if let Some(prev) = prev_id {
            graph_edges.push(GraphEdge {
                id: format!("{}__{}", prev, id),
                from: prev,
                to: id.clone(),
                condition: serde_json::Value::Null,
            });
        }
        prev_id = Some(id.clone());

        graph_nodes.push(GraphNode {
            id,
            title: stem.to_string(),
            file: chapter.rel_path.clone(),
            position,
        });
    }

    let entry_node_id = graph_nodes
        .first()
        .map(|node| node.id.clone())
        .unwrap_or_default();
    let node_entries = chapters
        .iter()
        .map(|chapter| NodeEntry {
            rel_path: chapter.rel_path.clone(),
            data: Some(chapter.data.clone()),
        })
        .collect();

    (
        ProjectGraph {
            version: 1,
            entry_node_id,
            nodes: graph_nodes,
            edges: graph_edges,
            synthetic: true,
        },
        node_entries,
    )
}

fn required_string<'a>(value: &'a serde_json::Value, field: &str) -> Result<&'a str, String> {
    required_string_field(value, field, field)
}

fn required_string_field<'a>(
    value: &'a serde_json::Value,
    key: &str,
    label: &str,
) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(|field_value| field_value.as_str())
        .ok_or_else(|| format!("graph.json 缺少必填字段 {}", label))
}

fn ensure_unique_graph_id(base: &str, used: &mut HashSet<String>) -> String {
    let mut candidate = base.to_string();
    let mut suffix = 2;
    while used.contains(&candidate) {
        candidate = format!("{}_{}", base, suffix);
        suffix += 1;
    }
    used.insert(candidate.clone());
    candidate
}

fn auto_layout_graph_position(index: usize) -> GraphPosition {
    let row = index / GRAPH_LAYOUT_COLS;
    let col = index % GRAPH_LAYOUT_COLS;
    GraphPosition {
        x: GRAPH_LAYOUT_MARGIN + col as f64 * GRAPH_LAYOUT_GAP_X,
        y: GRAPH_LAYOUT_MARGIN + row as f64 * GRAPH_LAYOUT_GAP_Y,
    }
}

/// 在 parent_dir 下创建新项目：建目录结构 + 复制默认渲染层模板 + 写 gal.project.json
#[tauri::command]
fn create_project(
    parent_dir: String,
    name: String,
    app_handle: tauri::AppHandle,
) -> Result<ProjectData, String> {
    // 校验项目名：只允许文件名片段，禁止路径分隔符与 ..
    validate_plain_name(&name, "项目名")?;
    let parent_root = Path::new(&parent_dir)
        .canonicalize()
        .map_err(|e| format!("无法定位父目录 {}: {}", parent_dir, e))?;
    let project_path = parent_root.join(&name);
    if project_path.exists() {
        return Err(format!("目录已存在: {}", project_path.display()));
    }

    let default_renderer_dir = default_renderer_dir(&app_handle)?;
    initialize_project_root(&project_path, &name, &default_renderer_dir)?;

    // 重新读出来返回
    open_project(project_path.to_string_lossy().into_owned())
}

/// 把用户选择的当前目录初始化为 GalStudio 项目。
#[tauri::command]
fn initialize_project(path: String, app_handle: tauri::AppHandle) -> Result<ProjectData, String> {
    let project_path = Path::new(&path)
        .canonicalize()
        .map_err(|e| format!("无法定位项目目录 {}: {}", path, e))?;
    if !project_path.is_dir() {
        return Err(format!("项目路径不是目录: {}", project_path.display()));
    }
    if project_path.join("gal.project.json").is_file() {
        return open_project(project_path.to_string_lossy().into_owned());
    }

    let name = project_path
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| !n.is_empty())
        .unwrap_or("GalStudio Project")
        .to_string();
    let default_renderer_dir = default_renderer_dir(&app_handle)?;
    initialize_project_root(&project_path, &name, &default_renderer_dir)?;
    open_project(project_path.to_string_lossy().into_owned())
}

/// 监听项目目录内的数据/渲染层变化，debounce 后向前端发 project_changed 事件。
#[tauri::command]
fn watch_project(
    project_path: String,
    app_handle: tauri::AppHandle,
    watchers: tauri::State<'_, ProjectWatchers>,
) -> Result<(), String> {
    let root = canonical_project_root(Path::new(&project_path))?;
    let root_key = root.to_string_lossy().into_owned();

    let mut active = watchers
        .active
        .lock()
        .map_err(|_| "项目监听器状态已损坏".to_string())?;
    if active.contains_key(&root_key) {
        return Ok(());
    }

    let (tx, rx) = mpsc::channel::<WatchSignal>();
    let event_tx = tx.clone();
    let event_root = root.clone();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
        let Ok(event) = result else {
            return;
        };
        let mut relevant = false;
        let mut renderer_changed = false;
        for path in event.paths {
            match classify_project_watch_path(&event_root, &path) {
                Some(ProjectWatchKind::Renderer) => {
                    relevant = true;
                    renderer_changed = true;
                }
                Some(ProjectWatchKind::Content | ProjectWatchKind::ProjectMeta) => {
                    relevant = true;
                }
                None => {}
            }
        }
        if relevant {
            let _ = event_tx.send(WatchSignal::Changed { renderer_changed });
        }
    })
    .map_err(|e| format!("创建项目监听器失败: {}", e))?;

    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| format!("监听项目目录失败 {}: {}", root.display(), e))?;

    let worker_root = root_key.clone();
    std::thread::spawn(move || run_project_watch_debouncer(app_handle, worker_root, rx));

    active.insert(
        root_key,
        ProjectWatchHandle {
            _watcher: watcher,
            stop_tx: tx,
        },
    );
    Ok(())
}

#[tauri::command]
fn unwatch_project(
    project_path: String,
    watchers: tauri::State<'_, ProjectWatchers>,
) -> Result<(), String> {
    let root = Path::new(&project_path)
        .canonicalize()
        .map_err(|e| format!("无法定位项目目录 {}: {}", project_path, e))?;
    let root_key = root.to_string_lossy().into_owned();
    let mut active = watchers
        .active
        .lock()
        .map_err(|_| "项目监听器状态已损坏".to_string())?;
    if let Some(handle) = active.remove(&root_key) {
        let _ = handle.stop_tx.send(WatchSignal::Stop);
    }
    Ok(())
}

fn initialize_project_root(
    project_path: &Path,
    name: &str,
    default_renderer_dir: &Path,
) -> Result<(), String> {
    ensure_initialization_targets_available(project_path, default_renderer_dir)?;

    // 创建目录骨架（资源放在 content/assets/，与 manifest 的相对路径解析契约一致）
    fs::create_dir_all(project_path.join("content/chapters"))
        .map_err(|e| format!("创建 content/chapters 失败: {}", e))?;
    fs::create_dir_all(project_path.join("content/assets"))
        .map_err(|e| format!("创建 content/assets 失败: {}", e))?;
    fs::create_dir_all(project_path.join("renderers/default"))
        .map_err(|e| format!("创建 renderers/default 失败: {}", e))?;

    // 写最小 manifest / meta
    let manifest = serde_json::json!({
        "characters": {},
        "backgrounds": {},
        "audio": {}
    });
    write_json(&project_path.join("content/manifest.json"), &manifest)?;

    let meta = serde_json::json!({
        "title": &name,
        "chapters": [],
        "typingSpeedCps": 30,
        "autoAdvanceMs": 1200,
        "chapterGapMs": 1500
    });
    write_json(&project_path.join("content/meta.json"), &meta)?;

    // 复制默认渲染层模板（从打包的 app resource）
    copy_dir_all(
        default_renderer_dir,
        &project_path.join("renderers/default"),
    )
    .map_err(|e| format!("复制渲染层模板失败: {}", e))?;

    let project_meta = ProjectMeta {
        name: name.to_string(),
        active_renderer_id: "default".to_string(),
        created_at: chrono_now(),
    };
    write_json(
        &project_path.join("gal.project.json"),
        &serde_json::to_value(&project_meta).unwrap(),
    )?;

    Ok(())
}

/// 保存单个文件（相对项目根的路径）。校验目标必须在项目目录内。
#[tauri::command]
fn save_file(project_path: String, rel_path: String, content: String) -> Result<(), String> {
    let project_root = canonical_project_root(Path::new(&project_path))?;
    let safe_target = resolve_relative_under(&project_root, &rel_path)?;
    if let Some(parent) = safe_target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
        ensure_existing_path_within(&project_root, parent)?;
    }
    if safe_target.exists() {
        ensure_existing_path_within(&project_root, &safe_target)?;
    }
    fs::write(&safe_target, content)
        .map_err(|e| format!("写文件失败 ({}): {}", safe_target.display(), e))
}

/// 保存 content/graph.json。节点文件生命周期由 save_file/delete_file 单独管理。
#[tauri::command]
fn save_graph(project_path: String, graph: ProjectGraphInput) -> Result<(), String> {
    let project_root = canonical_project_root(Path::new(&project_path))?;
    let content_dir = project_root.join("content");
    let content_root = content_dir
        .canonicalize()
        .map_err(|e| format!("无法定位 content 目录 {}: {}", content_dir.display(), e))?;

    for (index, node) in graph.nodes.iter().enumerate() {
        if node.id.is_empty() {
            return Err(format!("graph.nodes[{index}].id 不能为空"));
        }
        if node.file.is_empty() {
            return Err(format!("graph.nodes[{index}].file 不能为空"));
        }
        let node_path = resolve_relative_under(&content_root, &node.file)?;
        if node_path.exists() {
            ensure_existing_path_within(&content_root, &node_path)?;
        }
    }
    for (index, edge) in graph.edges.iter().enumerate() {
        if edge.id.is_empty() {
            return Err(format!("graph.edges[{index}].id 不能为空"));
        }
        if edge.from.is_empty() {
            return Err(format!("graph.edges[{index}].from 不能为空"));
        }
        if edge.to.is_empty() {
            return Err(format!("graph.edges[{index}].to 不能为空"));
        }
    }

    let value = serde_json::json!({
        "version": graph.version,
        "entryNodeId": graph.entry_node_id,
        "nodes": graph.nodes.iter().map(|node| {
            serde_json::json!({
                "id": node.id,
                "title": node.title,
                "file": node.file,
                "position": {
                    "x": node.position.x,
                    "y": node.position.y,
                },
            })
        }).collect::<Vec<_>>(),
        "edges": graph.edges.iter().map(|edge| {
            serde_json::json!({
                "id": edge.id,
                "from": edge.from,
                "to": edge.to,
                "condition": edge.condition,
            })
        }).collect::<Vec<_>>(),
    });
    let graph_path = content_dir.join("graph.json");
    if graph_path.exists() {
        ensure_existing_path_within(&content_root, &graph_path)?;
    }
    write_json(&graph_path, &value)
}

/// 删除 content/ 下的单个文件。路径相对 content 根，缺失视为已删除。
#[tauri::command]
fn delete_file(project_path: String, rel_path: String) -> Result<(), String> {
    let project_root = canonical_project_root(Path::new(&project_path))?;
    let content_dir = project_root.join("content");
    let content_root = content_dir
        .canonicalize()
        .map_err(|e| format!("无法定位 content 目录 {}: {}", content_dir.display(), e))?;
    let target = resolve_relative_under(&content_root, &rel_path)?;
    if target.exists() {
        ensure_existing_path_within(&content_root, &target)?;
        fs::remove_file(&target)
            .map_err(|e| format!("删除文件失败 ({}): {}", target.display(), e))?;
    }
    Ok(())
}

/// 读取一个渲染层目录下的所有源码文件（.ts/.tsx），供前端运行时编译。
/// 返回 { 相对路径: 源码 } 的列表。递归读取。
#[tauri::command]
fn read_renderer_files(
    project_path: String,
    renderer_id: String,
) -> Result<Vec<RendererFile>, String> {
    let project_root = canonical_project_root(Path::new(&project_path))?;
    validate_plain_name(&renderer_id, "渲染层 id")?;
    let renderer_dir = resolve_relative_under(&project_root, &format!("renderers/{renderer_id}"))?;
    ensure_existing_path_within(&project_root, &renderer_dir)?;

    let mut files = vec![];
    collect_source_files(&renderer_dir, &renderer_dir, &mut files)?;
    Ok(files)
}

#[derive(Serialize, Clone)]
pub struct RendererFile {
    /// 相对渲染层目录的路径（如 "index.tsx"、"Stage.tsx"），用作模块标识
    pub path: String,
    pub content: String,
}

/// 递归收集目录下所有 .ts/.tsx 文件
fn collect_source_files(
    base: &Path,
    dir: &Path,
    out: &mut Vec<RendererFile>,
) -> Result<(), String> {
    let entries =
        fs::read_dir(dir).map_err(|e| format!("读取目录失败 {}: {}", dir.display(), e))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_source_files(base, &path, out)?;
        } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            if ext == "ts" || ext == "tsx" {
                let rel = path
                    .strip_prefix(base)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/");
                let content = fs::read_to_string(&path)
                    .map_err(|e| format!("读取文件失败 {}: {}", path.display(), e))?;
                out.push(RendererFile { path: rel, content });
            }
        }
    }
    Ok(())
}

/// 更新 gal.project.json
#[tauri::command]
fn save_project_meta(project_path: String, meta: ProjectMeta) -> Result<(), String> {
    let project_root = canonical_project_root(Path::new(&project_path))?;
    write_json(
        &project_root.join("gal.project.json"),
        &serde_json::to_value(&meta).unwrap(),
    )
}

// ── 工具函数 ──────────────────────────────────────

pub fn canonical_project_root(project_path: &Path) -> Result<PathBuf, String> {
    let root = project_path
        .canonicalize()
        .map_err(|e| format!("无法定位项目目录 {}: {}", project_path.display(), e))?;
    if !root.is_dir() {
        return Err(format!("项目路径不是目录: {}", root.display()));
    }
    if !root.join("gal.project.json").is_file() {
        return Err(format!(
            "不是 GalStudio 项目目录（缺少 gal.project.json）: {}",
            root.display()
        ));
    }
    Ok(root)
}

fn validate_plain_name(name: &str, label: &str) -> Result<(), String> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name == ".."
        || name == "."
        || name.contains('\0')
    {
        return Err(format!("非法{}: {:?}", label, name));
    }
    Ok(())
}

fn safe_relative_path(rel: &str) -> Result<PathBuf, String> {
    if rel.is_empty() || rel.contains('\0') {
        return Err(format!("非法相对路径: {:?}", rel));
    }
    let path = Path::new(rel);
    if path.is_absolute() {
        return Err(format!("禁止绝对路径: {}", rel));
    }

    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!("路径越界：{}", rel));
            }
        }
    }
    if out.as_os_str().is_empty() {
        return Err(format!("非法相对路径: {:?}", rel));
    }
    Ok(out)
}

fn resolve_relative_under(base_canon: &Path, rel: &str) -> Result<PathBuf, String> {
    Ok(base_canon.join(safe_relative_path(rel)?))
}

fn ensure_existing_path_within(base_canon: &Path, target: &Path) -> Result<(), String> {
    let target_canon = target
        .canonicalize()
        .map_err(|e| format!("无法定位路径 {}: {}", target.display(), e))?;
    if !target_canon.starts_with(base_canon) {
        return Err(format!(
            "路径越界：{} 不在项目目录 {} 内（可能的路径穿越攻击）",
            target.display(),
            base_canon.display()
        ));
    }
    Ok(())
}

fn run_project_watch_debouncer(
    app_handle: tauri::AppHandle,
    project_path: String,
    rx: mpsc::Receiver<WatchSignal>,
) {
    let mut state = ProjectDebounceState::default();
    loop {
        let timeout = state
            .last_event_at
            .map(|last_event_at| {
                let elapsed = Instant::now().duration_since(last_event_at);
                PROJECT_WATCH_DEBOUNCE.saturating_sub(elapsed)
            })
            .unwrap_or(PROJECT_WATCH_DEBOUNCE);

        match rx.recv_timeout(timeout) {
            Ok(WatchSignal::Changed { renderer_changed }) => {
                state.record(
                    ProjectChangedPayload::new(project_path.clone(), renderer_changed),
                    Instant::now(),
                );
            }
            Ok(WatchSignal::Stop) | Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => {
                if let Some(payload) = state.due(Instant::now(), PROJECT_WATCH_DEBOUNCE) {
                    let _ = app_handle.emit(PROJECT_CHANGED_EVENT, payload);
                }
            }
        }
    }
}

fn classify_project_watch_path(root: &Path, path: &Path) -> Option<ProjectWatchKind> {
    let rel = path.strip_prefix(root).ok()?;
    let mut normal_components = rel.components().filter_map(|component| match component {
        Component::Normal(part) => part.to_str(),
        _ => None,
    });
    let first = normal_components.next()?;

    if matches!(first, ".git" | "node_modules" | "dist" | "target") {
        return None;
    }
    if first == "gal.project.json" {
        return Some(ProjectWatchKind::ProjectMeta);
    }
    if first == "content" {
        return Some(ProjectWatchKind::Content);
    }
    if first == "renderers" {
        return Some(ProjectWatchKind::Renderer);
    }
    None
}

fn read_json(path: &Path) -> Result<serde_json::Value, String> {
    let text =
        fs::read_to_string(path).map_err(|e| format!("读取失败 ({}): {}", path.display(), e))?;
    serde_json::from_str(&text).map_err(|e| format!("解析 JSON 失败 ({}): {}", path.display(), e))
}

fn write_json(path: &Path, value: &serde_json::Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    let text = serde_json::to_string_pretty(value).map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(path, text).map_err(|e| format!("写文件失败 ({}): {}", path.display(), e))
}

fn default_renderer_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("获取 resource_dir 失败: {}", e))?
        .join("resources/default-renderer"))
}

fn ensure_initialization_targets_available(
    project_path: &Path,
    default_renderer_dir: &Path,
) -> Result<(), String> {
    for path in [
        project_path.join("gal.project.json"),
        project_path.join("content/manifest.json"),
        project_path.join("content/meta.json"),
    ] {
        ensure_can_create_file(&path)?;
    }
    ensure_copy_targets_available(
        default_renderer_dir,
        &project_path.join("renderers/default"),
    )
}

fn ensure_can_create_file(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Err(format!("初始化会覆盖已有文件，已取消: {}", path.display()));
    }
    Ok(())
}

fn ensure_copy_targets_available(src: &Path, dst: &Path) -> Result<(), String> {
    let entries =
        fs::read_dir(src).map_err(|e| format!("读取目录失败 {}: {}", src.display(), e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
        let ty = entry
            .file_type()
            .map_err(|e| format!("读取文件类型失败: {}", e))?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            ensure_copy_targets_available(&from, &to)?;
        } else {
            ensure_can_create_file(&to)?;
        }
    }
    Ok(())
}

fn chrono_now() -> String {
    // 简单的 RFC3339 风格时间戳，避免引入 chrono 依赖
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{}", secs)
}

/// 递归复制目录
fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&from, &to)?;
        } else {
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ProjectWatchers::default())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_projects,
            open_project,
            create_project,
            initialize_project,
            watch_project,
            unwatch_project,
            save_file,
            save_graph,
            delete_file,
            save_project_meta,
            read_renderer_files,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("galstudio-{name}-{stamp}"))
    }

    fn write_text(path: &Path, text: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, text).unwrap();
    }

    fn write_minimal_project(project: &Path, chapters_value: serde_json::Value) {
        write_text(
            &project.join("gal.project.json"),
            r#"{"name":"Test","activeRendererId":"default","createdAt":"0"}"#,
        );
        write_text(
            &project.join("content/manifest.json"),
            r#"{"characters":{},"backgrounds":{},"audio":{}}"#,
        );
        write_json(
            &project.join("content/meta.json"),
            &serde_json::json!({
                "title": "Test",
                "chapters": chapters_value,
                "typingSpeedCps": 30,
                "autoAdvanceMs": 1200,
                "chapterGapMs": 1500
            }),
        )
        .unwrap();
    }

    fn write_graph_project(
        project: &Path,
        graph_json: serde_json::Value,
        nodes: &[(&str, serde_json::Value)],
    ) {
        write_minimal_project(project, serde_json::json!([]));
        write_json(&project.join("content/graph.json"), &graph_json).unwrap();
        for (rel_path, data) in nodes {
            write_json(&project.join("content").join(rel_path), data).unwrap();
        }
    }

    fn write_graph_project_with_files(
        project: &Path,
        graph_json: serde_json::Value,
        node_files: &[(&str, &str)],
    ) {
        write_minimal_project(project, serde_json::json!([]));
        write_json(&project.join("content/graph.json"), &graph_json).unwrap();
        for (rel_path, text) in node_files {
            write_text(&project.join("content").join(rel_path), text);
        }
    }

    fn graph_input(node_file: &str, title: &str) -> ProjectGraphInput {
        ProjectGraphInput {
            version: 1,
            entry_node_id: "prologue".to_string(),
            nodes: vec![
                GraphNodeInput {
                    id: "prologue".to_string(),
                    title: title.to_string(),
                    file: node_file.to_string(),
                    position: GraphPositionInput { x: 120.0, y: 180.0 },
                },
                GraphNodeInput {
                    id: "ending".to_string(),
                    title: "Ending".to_string(),
                    file: "nodes/ending.json".to_string(),
                    position: GraphPositionInput { x: 380.0, y: 180.0 },
                },
            ],
            edges: vec![GraphEdgeInput {
                id: "prologue__ending".to_string(),
                from: "prologue".to_string(),
                to: "ending".to_string(),
                condition: serde_json::Value::Null,
            }],
        }
    }

    fn graph_node(id: &str, file: &str) -> GraphNode {
        GraphNode {
            id: id.to_string(),
            title: id.to_string(),
            file: file.to_string(),
            position: GraphPosition { x: 0.0, y: 0.0 },
        }
    }

    fn graph_edge(id: &str, from: &str, to: &str) -> GraphEdge {
        GraphEdge {
            id: id.to_string(),
            from: from.to_string(),
            to: to.to_string(),
            condition: serde_json::Value::Null,
        }
    }

    fn valid_project_graph() -> ProjectGraph {
        ProjectGraph {
            version: 1,
            entry_node_id: "prologue".to_string(),
            nodes: vec![
                graph_node("prologue", "nodes/prologue.json"),
                graph_node("ending", "nodes/ending.json"),
            ],
            edges: vec![graph_edge("prologue__ending", "prologue", "ending")],
            synthetic: false,
        }
    }

    fn present_node_entries(graph: &ProjectGraph) -> Vec<NodeEntry> {
        graph
            .nodes
            .iter()
            .map(|node| NodeEntry {
                rel_path: node.file.clone(),
                data: Some(serde_json::json!([])),
            })
            .collect()
    }

    #[test]
    fn validate_graph_flags_dangling_edge() {
        let mut graph = valid_project_graph();
        graph.edges = vec![graph_edge("prologue__missing", "prologue", "missing")];
        let entries = present_node_entries(&graph);

        let issues = validate_graph(&graph, &entries);

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].code, "dangling_edge");
        assert_eq!(issues[0].severity, GraphIssueSeverity::Warn);
        assert_eq!(issues[0].edge_id.as_deref(), Some("prologue__missing"));
        assert_eq!(issues[0].file.as_deref(), Some("content/graph.json"));
        assert_eq!(issues[0].json_path.as_deref(), Some("$.edges[0]"));
        assert!(issues[0].message.contains("missing"));
    }

    #[test]
    fn validate_graph_flags_missing_node_file() {
        let graph = valid_project_graph();
        let entries = vec![
            NodeEntry {
                rel_path: "nodes/prologue.json".to_string(),
                data: Some(serde_json::json!([])),
            },
            NodeEntry {
                rel_path: "nodes/ending.json".to_string(),
                data: None,
            },
        ];

        let issues = validate_graph(&graph, &entries);

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].code, "missing_node_file");
        assert_eq!(issues[0].severity, GraphIssueSeverity::Warn);
        assert_eq!(issues[0].node_id.as_deref(), Some("ending"));
        assert_eq!(issues[0].file.as_deref(), Some("content/nodes/ending.json"));
        assert_eq!(issues[0].json_path.as_deref(), Some("$.nodes[1].file"));
        assert!(issues[0].message.contains("nodes/ending.json"));
    }

    #[test]
    fn validate_graph_flags_duplicate_node_ids() {
        let mut graph = valid_project_graph();
        graph
            .nodes
            .push(graph_node("prologue", "nodes/prologue-copy.json"));
        let entries = present_node_entries(&graph);

        let issues = validate_graph(&graph, &entries);

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].code, "duplicate_node_id");
        assert_eq!(issues[0].severity, GraphIssueSeverity::Error);
        assert_eq!(issues[0].node_id.as_deref(), Some("prologue"));
    }

    #[test]
    fn validate_graph_flags_missing_entry_node() {
        let mut graph = valid_project_graph();
        graph.entry_node_id = "missing-entry".to_string();
        let entries = present_node_entries(&graph);

        let issues = validate_graph(&graph, &entries);

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].code, "missing_entry_node");
        assert_eq!(issues[0].severity, GraphIssueSeverity::Error);
        assert_eq!(issues[0].node_id.as_deref(), Some("missing-entry"));
    }

    #[test]
    fn validate_graph_flags_empty_entry_when_nodes_exist() {
        let mut graph = valid_project_graph();
        graph.entry_node_id = "".to_string();
        let entries = present_node_entries(&graph);

        let issues = validate_graph(&graph, &entries);

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].code, "empty_entry");
        assert_eq!(issues[0].severity, GraphIssueSeverity::Warn);
    }

    #[test]
    fn validate_graph_flags_duplicate_edge_id() {
        let mut graph = valid_project_graph();
        graph
            .edges
            .push(graph_edge("prologue__ending", "ending", "prologue"));
        let entries = present_node_entries(&graph);

        let issues = validate_graph(&graph, &entries);

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].code, "duplicate_edge_id");
        assert_eq!(issues[0].severity, GraphIssueSeverity::Warn);
        assert_eq!(issues[0].edge_id.as_deref(), Some("prologue__ending"));
    }

    #[test]
    fn validate_graph_clean_graph_has_no_issues() {
        let graph = valid_project_graph();
        let entries = present_node_entries(&graph);

        let issues = validate_graph(&graph, &entries);

        assert!(issues.is_empty());
    }

    #[test]
    fn save_graph_writes_graph_json() {
        let root = unique_temp_dir("save-graph");
        let project = root.join("project");
        write_minimal_project(&project, serde_json::json!([]));
        write_text(&project.join("content/nodes/prologue.json"), "[]");
        write_text(&project.join("content/nodes/ending.json"), "[]");

        save_graph(
            project.to_string_lossy().into_owned(),
            graph_input("nodes/prologue.json", "Prologue"),
        )
        .unwrap();

        let graph_text = fs::read_to_string(project.join("content/graph.json")).unwrap();
        let graph: serde_json::Value = serde_json::from_str(&graph_text).unwrap();
        assert!(graph_text.contains('\n'));
        assert_eq!(graph["entryNodeId"], "prologue");
        assert_eq!(graph["nodes"][0]["title"], "Prologue");
        assert_eq!(graph["edges"][0]["id"], "prologue__ending");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn save_graph_overwrites_existing_graph_json() {
        let root = unique_temp_dir("save-graph-overwrite");
        let project = root.join("project");
        write_graph_project_with_files(
            &project,
            serde_json::json!({
                "version": 1,
                "entryNodeId": "old",
                "nodes": [{ "id": "old", "title": "Old", "file": "nodes/old.json", "position": { "x": 0, "y": 0 } }],
                "edges": []
            }),
            &[("nodes/prologue.json", "[]"), ("nodes/ending.json", "[]")],
        );

        save_graph(
            project.to_string_lossy().into_owned(),
            graph_input("nodes/prologue.json", "Fresh"),
        )
        .unwrap();

        let graph: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(project.join("content/graph.json")).unwrap())
                .unwrap();
        assert_eq!(graph["entryNodeId"], "prologue");
        assert_eq!(graph["nodes"][0]["title"], "Fresh");
        assert_ne!(graph["entryNodeId"], "old");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn save_graph_rejects_untrusted_project_root() {
        let root = unique_temp_dir("save-graph-untrusted");
        fs::create_dir_all(&root).unwrap();

        let result = save_graph(
            root.to_string_lossy().into_owned(),
            graph_input("nodes/prologue.json", "Nope"),
        );

        assert!(result.is_err());
        assert!(!root.join("content/graph.json").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn save_graph_rejects_node_file_outside_content_dir() {
        let root = unique_temp_dir("save-graph-escape");
        let project = root.join("project");
        write_graph_project_with_files(
            &project,
            serde_json::json!({
                "version": 1,
                "entryNodeId": "kept",
                "nodes": [{ "id": "kept", "title": "Kept", "file": "nodes/kept.json", "position": { "x": 0, "y": 0 } }],
                "edges": []
            }),
            &[("nodes/kept.json", "[]")],
        );
        let before = fs::read_to_string(project.join("content/graph.json")).unwrap();

        let result = save_graph(
            project.to_string_lossy().into_owned(),
            graph_input("../../outside.json", "Escape"),
        );

        assert!(result.is_err());
        assert!(result.err().unwrap().contains("路径越界"));
        assert_eq!(
            fs::read_to_string(project.join("content/graph.json")).unwrap(),
            before
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn delete_file_removes_target_under_content() {
        let root = unique_temp_dir("delete-file");
        let project = root.join("project");
        write_minimal_project(&project, serde_json::json!([]));
        let target = project.join("content/nodes/a.json");
        write_text(&target, "[]");

        delete_file(
            project.to_string_lossy().into_owned(),
            "nodes/a.json".to_string(),
        )
        .unwrap();

        assert!(!target.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn delete_file_is_idempotent_for_missing_file() {
        let root = unique_temp_dir("delete-file-missing");
        let project = root.join("project");
        write_minimal_project(&project, serde_json::json!([]));

        let result = delete_file(
            project.to_string_lossy().into_owned(),
            "nodes/missing.json".to_string(),
        );

        assert!(result.is_ok());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn delete_file_rejects_path_traversal() {
        let root = unique_temp_dir("delete-file-escape");
        let project = root.join("project");
        write_minimal_project(&project, serde_json::json!([]));
        write_text(&root.join("outside.json"), "keep");

        let result = delete_file(
            project.to_string_lossy().into_owned(),
            "../../outside.json".to_string(),
        );

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(root.join("outside.json")).unwrap(),
            "keep"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn delete_file_rejects_untrusted_project_root() {
        let root = unique_temp_dir("delete-file-untrusted");
        fs::create_dir_all(&root).unwrap();

        let result = delete_file(
            root.to_string_lossy().into_owned(),
            "nodes/a.json".to_string(),
        );

        assert!(result.is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn save_graph_then_open_project_roundtrip() {
        let root = unique_temp_dir("save-graph-roundtrip");
        let project = root.join("project");
        write_minimal_project(&project, serde_json::json!([]));
        write_text(
            &project.join("content/nodes/prologue.json"),
            r#"[{"t":"wait","ms":1}]"#,
        );
        write_text(
            &project.join("content/nodes/ending.json"),
            r#"[{"t":"wait","ms":2}]"#,
        );

        save_graph(
            project.to_string_lossy().into_owned(),
            graph_input("nodes/prologue.json", "Prologue"),
        )
        .unwrap();

        let opened = open_project(project.to_string_lossy().into_owned()).unwrap();
        let graph = opened.graph.unwrap();
        assert!(!graph.synthetic);
        assert_eq!(graph.entry_node_id, "prologue");
        assert_eq!(graph.nodes.len(), 2);
        assert_eq!(graph.nodes[0].file, "nodes/prologue.json");
        assert_eq!(graph.nodes[0].position.x, 120.0);
        assert_eq!(graph.edges[0].id, "prologue__ending");
        assert_eq!(opened.nodes.unwrap().len(), 2);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn open_project_loads_graph_when_present() {
        let root = unique_temp_dir("graph-present");
        let project = root.join("project");
        write_graph_project(
            &project,
            serde_json::json!({
                "version": 1,
                "entryNodeId": "prologue",
                "nodes": [
                    {
                        "id": "prologue",
                        "title": "Prologue",
                        "file": "nodes/prologue.json",
                        "position": { "x": 120.0, "y": 180.0 }
                    },
                    {
                        "id": "first_meeting",
                        "title": "First Meeting",
                        "file": "nodes/first_meeting.json",
                        "position": { "x": 380.0, "y": 180.0 }
                    }
                ],
                "edges": [
                    {
                        "id": "prologue__first_meeting",
                        "from": "prologue",
                        "to": "first_meeting",
                        "condition": null
                    }
                ]
            }),
            &[
                (
                    "nodes/prologue.json",
                    serde_json::json!([{ "t": "narrate", "text": "Start" }]),
                ),
                (
                    "nodes/first_meeting.json",
                    serde_json::json!([{ "t": "say", "who": "hero", "text": "Hi" }]),
                ),
            ],
        );

        let opened = open_project(project.to_string_lossy().into_owned()).unwrap();
        let graph = opened.graph.unwrap();
        let nodes = opened.nodes.unwrap();

        assert!(!graph.synthetic);
        assert_eq!(graph.entry_node_id, "prologue");
        assert_eq!(graph.nodes.len(), 2);
        assert_eq!(graph.edges.len(), 1);
        assert_eq!(nodes.len(), 2);
        assert_eq!(nodes[0].rel_path, "nodes/prologue.json");
        assert!(nodes[0].data.is_some());
        assert_eq!(nodes[1].rel_path, "nodes/first_meeting.json");
        assert!(nodes[1].data.is_some());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn open_project_synthesizes_linear_graph_from_chapters() {
        let root = unique_temp_dir("synthetic-linear");
        let project = root.join("project");
        write_minimal_project(
            &project,
            serde_json::json!([
                "chapters/ch01.json",
                "chapters/ch02.json",
                "chapters/ch03.json"
            ]),
        );
        write_text(
            &project.join("content/chapters/ch01.json"),
            r#"[{"t":"wait","ms":1}]"#,
        );
        write_text(
            &project.join("content/chapters/ch02.json"),
            r#"[{"t":"wait","ms":2}]"#,
        );
        write_text(
            &project.join("content/chapters/ch03.json"),
            r#"[{"t":"wait","ms":3}]"#,
        );

        let opened = open_project(project.to_string_lossy().into_owned()).unwrap();
        let graph = opened.graph.unwrap();
        let nodes = opened.nodes.unwrap();

        assert!(graph.synthetic);
        assert_eq!(graph.version, 1);
        assert_eq!(graph.entry_node_id, "ch01");
        assert_eq!(
            graph
                .nodes
                .iter()
                .map(|node| node.id.as_str())
                .collect::<Vec<_>>(),
            vec!["ch01", "ch02", "ch03"]
        );
        assert_eq!(
            graph
                .edges
                .iter()
                .map(|edge| (edge.id.as_str(), edge.from.as_str(), edge.to.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("ch01__ch02", "ch01", "ch02"),
                ("ch02__ch03", "ch02", "ch03")
            ]
        );
        assert_eq!(nodes.len(), 3);
        assert!(nodes.iter().all(|node| node.data.is_some()));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn open_project_synthesizes_graph_even_when_no_chapters() {
        let root = unique_temp_dir("synthetic-empty");
        let project = root.join("project");
        write_minimal_project(&project, serde_json::json!([]));

        let opened = open_project(project.to_string_lossy().into_owned()).unwrap();
        let graph = opened.graph.unwrap();
        let nodes = opened.nodes.unwrap();

        assert!(graph.synthetic);
        assert_eq!(graph.entry_node_id, "");
        assert!(graph.nodes.is_empty());
        assert!(graph.edges.is_empty());
        assert!(nodes.is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn open_project_rejects_graph_node_file_outside_content_dir() {
        let root = unique_temp_dir("graph-escape");
        let project = root.join("project");
        write_graph_project(
            &project,
            serde_json::json!({
                "version": 1,
                "entryNodeId": "escape",
                "nodes": [
                    {
                        "id": "escape",
                        "title": "Escape",
                        "file": "../../outside.json",
                        "position": { "x": 0, "y": 0 }
                    }
                ],
                "edges": []
            }),
            &[],
        );
        write_text(&root.join("outside.json"), "[]");

        let result = open_project(project.to_string_lossy().into_owned());

        assert!(result.is_err());
        assert!(result.err().unwrap().contains("路径越界"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn open_project_skips_missing_node_file_with_warning() {
        let root = unique_temp_dir("graph-missing-node");
        let project = root.join("project");
        write_graph_project(
            &project,
            serde_json::json!({
                "version": 1,
                "entryNodeId": "present",
                "nodes": [
                    {
                        "id": "present",
                        "title": "Present",
                        "file": "nodes/present.json",
                        "position": { "x": 0, "y": 0 }
                    },
                    {
                        "id": "missing",
                        "title": "Missing",
                        "file": "nodes/missing.json",
                        "position": { "x": 260, "y": 0 }
                    }
                ],
                "edges": []
            }),
            &[(
                "nodes/present.json",
                serde_json::json!([{ "t": "narrate", "text": "Here" }]),
            )],
        );

        let opened = open_project(project.to_string_lossy().into_owned()).unwrap();
        let nodes = opened.nodes.unwrap();

        assert_eq!(nodes.len(), 2);
        assert_eq!(nodes[0].rel_path, "nodes/present.json");
        assert!(nodes[0].data.is_some());
        assert_eq!(nodes[1].rel_path, "nodes/missing.json");
        assert!(nodes[1].data.is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn open_project_includes_graph_report() {
        let root = unique_temp_dir("graph-report");
        let project = root.join("project");
        write_graph_project(
            &project,
            serde_json::json!({
                "version": 1,
                "entryNodeId": "prologue",
                "nodes": [
                    {
                        "id": "prologue",
                        "title": "Prologue",
                        "file": "nodes/prologue.json",
                        "position": { "x": 0, "y": 0 }
                    }
                ],
                "edges": []
            }),
            &[("nodes/prologue.json", serde_json::json!([]))],
        );

        let opened = open_project(project.to_string_lossy().into_owned()).unwrap();
        let report = opened.graph_report.unwrap();

        assert!(report.graph_issues.is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn validate_graph_does_not_block_loading() {
        let root = unique_temp_dir("graph-report-error");
        let project = root.join("project");
        write_graph_project(
            &project,
            serde_json::json!({
                "version": 1,
                "entryNodeId": "missing-entry",
                "nodes": [
                    {
                        "id": "prologue",
                        "title": "Prologue",
                        "file": "nodes/prologue.json",
                        "position": { "x": 0, "y": 0 }
                    }
                ],
                "edges": []
            }),
            &[("nodes/prologue.json", serde_json::json!([]))],
        );

        let opened = open_project(project.to_string_lossy().into_owned()).unwrap();
        let issues = opened.graph_report.unwrap().graph_issues;

        assert!(issues.iter().any(|issue| {
            issue.code == "missing_entry_node" && issue.severity == GraphIssueSeverity::Error
        }));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn open_project_rejects_graph_json_without_entry_node_id() {
        let root = unique_temp_dir("graph-no-entry");
        let project = root.join("project");
        write_graph_project(
            &project,
            serde_json::json!({
                "version": 1,
                "nodes": [
                    {
                        "id": "prologue",
                        "title": "Prologue",
                        "file": "nodes/prologue.json",
                        "position": { "x": 0, "y": 0 }
                    }
                ],
                "edges": []
            }),
            &[("nodes/prologue.json", serde_json::json!([]))],
        );

        let result = open_project(project.to_string_lossy().into_owned());

        assert!(result.is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn synthesized_graph_assigns_unique_node_ids() {
        let root = unique_temp_dir("synthetic-unique");
        let project = root.join("project");
        write_minimal_project(
            &project,
            serde_json::json!(["chapters/a/ch01.json", "chapters/b/ch01.json"]),
        );
        write_text(&project.join("content/chapters/a/ch01.json"), "[]");
        write_text(&project.join("content/chapters/b/ch01.json"), "[]");

        let opened = open_project(project.to_string_lossy().into_owned()).unwrap();
        let graph = opened.graph.unwrap();

        assert_eq!(graph.nodes[0].id, "ch01");
        assert_eq!(graph.nodes[1].id, "ch01_2");
        assert_eq!(graph.edges[0].id, "ch01__ch01_2");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn synthesized_graph_auto_layout_is_deterministic() {
        let root = unique_temp_dir("synthetic-layout");
        let project = root.join("project");
        write_minimal_project(
            &project,
            serde_json::json!([
                "chapters/ch01.json",
                "chapters/ch02.json",
                "chapters/ch03.json",
                "chapters/ch04.json"
            ]),
        );
        for chapter in ["ch01", "ch02", "ch03", "ch04"] {
            write_text(
                &project.join(format!("content/chapters/{chapter}.json")),
                "[]",
            );
        }

        let opened = open_project(project.to_string_lossy().into_owned()).unwrap();
        let graph = opened.graph.unwrap();

        assert_eq!(graph.nodes[0].position.x, 80.0);
        assert_eq!(graph.nodes[0].position.y, 80.0);
        assert_eq!(graph.nodes[2].position.x, 600.0);
        assert_eq!(graph.nodes[2].position.y, 80.0);
        assert_eq!(graph.nodes[3].position.x, 80.0);
        assert_eq!(graph.nodes[3].position.y, 240.0);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn open_project_graph_mode_does_not_mutate_disk() {
        let root = unique_temp_dir("graph-no-mutate");
        let graph_project = root.join("graph-project");
        write_graph_project(
            &graph_project,
            serde_json::json!({
                "version": 1,
                "entryNodeId": "prologue",
                "nodes": [
                    {
                        "id": "prologue",
                        "title": "Prologue",
                        "file": "nodes/prologue.json",
                        "position": { "x": 0, "y": 0 }
                    }
                ],
                "edges": []
            }),
            &[("nodes/prologue.json", serde_json::json!([]))],
        );
        let graph_before = fs::read_to_string(graph_project.join("content/graph.json")).unwrap();

        let synthetic_project = root.join("synthetic-project");
        write_minimal_project(
            &synthetic_project,
            serde_json::json!(["chapters/ch01.json"]),
        );
        write_text(&synthetic_project.join("content/chapters/ch01.json"), "[]");

        open_project(graph_project.to_string_lossy().into_owned()).unwrap();
        open_project(synthetic_project.to_string_lossy().into_owned()).unwrap();

        assert_eq!(
            fs::read_to_string(graph_project.join("content/graph.json")).unwrap(),
            graph_before
        );
        assert!(!synthetic_project.join("content/graph.json").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn save_file_rejects_untrusted_project_root() {
        let dir = unique_temp_dir("untrusted-root");
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("owned.txt");

        let result = save_file(
            dir.to_string_lossy().into_owned(),
            "owned.txt".to_string(),
            "nope".to_string(),
        );

        assert!(result.is_err());
        assert!(!target.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn open_project_rejects_meta_chapter_paths_outside_content_dir() {
        let root = unique_temp_dir("chapter-escape");
        let project = root.join("project");
        write_minimal_project(&project, serde_json::json!(["../../outside.json"]));
        write_text(&root.join("outside.json"), "[]");

        let result = open_project(project.to_string_lossy().into_owned());

        assert!(result.is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn initialize_project_root_adds_project_files_to_selected_directory() {
        let root = unique_temp_dir("init-root");
        let renderer_template = root.join("template");
        let project = root.join("Existing Story");
        write_text(&renderer_template.join("index.tsx"), "export default {};");
        fs::create_dir_all(&project).unwrap();

        initialize_project_root(&project, "Existing Story", &renderer_template).unwrap();

        assert!(project.join("gal.project.json").is_file());
        assert!(project.join("content/manifest.json").is_file());
        assert!(project.join("content/meta.json").is_file());
        assert!(project.join("content/chapters").is_dir());
        assert!(project.join("content/assets").is_dir());
        assert_eq!(
            fs::read_to_string(project.join("renderers/default/index.tsx")).unwrap(),
            "export default {};"
        );
        let opened = open_project(project.to_string_lossy().into_owned()).unwrap();
        assert_eq!(opened.meta.name, "Existing Story");
        assert_eq!(opened.renderer_ids, vec!["default".to_string()]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn initialize_project_root_does_not_overwrite_existing_files() {
        let root = unique_temp_dir("init-conflict");
        let renderer_template = root.join("template");
        let project = root.join("story");
        write_text(&renderer_template.join("index.tsx"), "export default {};");
        write_text(&project.join("content/meta.json"), "keep me");

        let result = initialize_project_root(&project, "story", &renderer_template);

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(project.join("content/meta.json")).unwrap(),
            "keep me"
        );
        assert!(!project.join("gal.project.json").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn project_watch_filter_only_accepts_project_data_and_renderer_paths() {
        let root = Path::new("/tmp/story");

        assert_eq!(
            classify_project_watch_path(root, &root.join("content/chapters/ch01.json")),
            Some(ProjectWatchKind::Content)
        );
        assert_eq!(
            classify_project_watch_path(root, &root.join("renderers/default/index.tsx")),
            Some(ProjectWatchKind::Renderer)
        );
        assert_eq!(
            classify_project_watch_path(root, &root.join("gal.project.json")),
            Some(ProjectWatchKind::ProjectMeta)
        );
        assert_eq!(
            classify_project_watch_path(root, &root.join("node_modules/pkg/index.js")),
            None
        );
        assert_eq!(
            classify_project_watch_path(root, &root.join("README.md")),
            None
        );
    }

    #[test]
    fn debounce_state_coalesces_changes_until_quiet_window() {
        let root = "/tmp/story".to_string();
        let mut state = ProjectDebounceState::default();
        let start = std::time::Instant::now();
        let delay = std::time::Duration::from_millis(250);

        state.record(ProjectChangedPayload::new(root.clone(), false), start);
        assert_eq!(
            state.due(start + std::time::Duration::from_millis(249), delay),
            None
        );

        state.record(
            ProjectChangedPayload::new(root.clone(), true),
            start + std::time::Duration::from_millis(100),
        );
        assert_eq!(
            state.due(start + std::time::Duration::from_millis(300), delay),
            None
        );

        let payload = state
            .due(start + std::time::Duration::from_millis(351), delay)
            .unwrap();
        assert_eq!(payload.project_path, root);
        assert!(payload.renderer_changed);
        assert_eq!(
            state.due(start + std::time::Duration::from_millis(700), delay),
            None
        );
    }
}
