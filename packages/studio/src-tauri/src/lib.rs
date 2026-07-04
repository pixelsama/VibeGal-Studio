// GalStudio Tauri 后端 —— 文件系统操作。
// 所有磁盘读写集中在这里；前端通过 invoke 调用，不直接碰文件系统。

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
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

const MAX_ASSET_PREVIEW_BYTES: u64 = 16 * 1024 * 1024;

const PROJECT_AGENTS_MD: &str = r#"# GalStudio Project Agent Instructions

This directory is a GalStudio project. Treat the project root as the workspace root.

## Writable Project Files

- `content/graph.json` is the script graph entry point.
- `content/nodes/*.json` are node script files. Each node file is an `Instruction[]` JSON array, not an object wrapper.
- `content/manifest.json` defines character, background, and audio ids used by instructions.
- `content/meta.json` stores global playback settings.
- `renderers/<id>/index.tsx` is a renderer layer entry file.

## Script Graph Rules

- Linear stories are represented as graph nodes connected by edges.
- Add a node by writing `content/nodes/<id>.json`, then adding a matching item to `content/graph.json` under `nodes`.
- Node `file` values are relative to `content/`, for example `nodes/start.json`.
- Do not use absolute paths, parent-directory traversal, or Windows drive paths in project data.
- Keep `edge.condition` as `null` unless GalStudio documents branch semantics.

## Legacy Chapter Rules

- Do not create, repair, or read `content/chapters/`.
- Do not add `chapters` to `content/meta.json`.
- Legacy chapter data is unsupported and will appear in the GalStudio project error panel.

## Renderer Rules

- A renderer layer lives in `renderers/<id>/`.
- Its entry file must be `renderers/<id>/index.tsx`.
- Renderer ids should be filesystem-safe plain names.

## Validation

Run this from the project root after edits:

```bash
galstudio-cli validate . --format json
```

The command returns structured JSON issues and a non-zero exit code when the project has errors or warnings.

## Local Reference

- Read `.galstudio/README.md` for project format notes.
- Read `.galstudio/schemas/*.json` for local JSON Schema snapshots.
- Do not casually edit `.galstudio/schemas`; they are generated from the GalStudio product schema.
"#;

const PROJECT_README_MD: &str = r#"# GalStudio Project Format

This project is self-describing for external tools and Agents. You do not need the GalStudio source repository to edit project data.

## Layout

```text
gal.project.json
AGENTS.md
.galstudio/
  README.md
  schemas/
    graph.json
    nodeFile.json
    manifest.json
    meta.json
content/
  manifest.json
  meta.json
  graph.json
  nodes/
    start.json
renderers/
  default/
    index.tsx
```

## Script Data

`content/graph.json` is the required script entry point. Each graph node points to a node file through `nodes[].file`, relative to `content/`.

Node files under `content/nodes/*.json` contain an `Instruction[]` JSON array.

Minimal graph:

```json
{
  "version": 1,
  "entryNodeId": "start",
  "nodes": [
    {
      "id": "start",
      "title": "开始",
      "file": "nodes/start.json",
      "position": { "x": 120, "y": 120 }
    }
  ],
  "edges": []
}
```

Minimal node file:

```json
[
  { "t": "narrate", "text": "新的故事从这里开始。" }
]
```

## Schemas

Local JSON Schema snapshots are in `.galstudio/schemas/`:

- `graph.json` validates `content/graph.json`.
- `nodeFile.json` validates each `content/nodes/*.json` file.
- `manifest.json` validates `content/manifest.json`.
- `meta.json` validates `content/meta.json`.

These files are copied from the GalStudio product at project initialization time.

## Validation

Run from the project root:

```bash
galstudio-cli validate . --format json
```

## Legacy Chapters

Old `content/meta.json` `chapters` entries and `content/chapters/` are not supported. Use `content/graph.json` plus `content/nodes/*.json` instead.
"#;

const PROJECT_SCHEMA_FILES: [(&str, &str); 4] = [
    (
        "graph.json",
        include_str!("../../../../docs/script-graph/schemas/graph.json"),
    ),
    (
        "nodeFile.json",
        include_str!("../../../../docs/script-graph/schemas/nodeFile.json"),
    ),
    (
        "manifest.json",
        include_str!("../../../../docs/script-graph/schemas/manifest.json"),
    ),
    (
        "meta.json",
        include_str!("../../../../docs/script-graph/schemas/meta.json"),
    ),
];

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
pub struct ProjectContent {
    pub manifest: serde_json::Value,
    pub meta: serde_json::Value,
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

/// 资产一致性报告：磁盘文件 ↔ manifest 声明之间的不一致。
/// 复用 GraphIssue（severity/code/message/file/jsonPath），与 graphReport 同构。
#[derive(Serialize, Clone)]
pub struct AssetReport {
    #[serde(rename = "assetIssues")]
    pub asset_issues: Vec<GraphIssue>,
}

/// 全局项目问题：汇总图结构、资产、manifest 三类问题。
/// source 字段标记问题来源（"graph" | "asset" | "manifest"），与前端 ProjectIssueSource 对齐。
/// 全局 StatusPanel 按来源分组展示，绿勾=全项目无问题。
#[derive(Serialize, Clone, Debug)]
pub struct ProjectIssue {
    pub severity: GraphIssueSeverity,
    pub source: String,
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
pub struct ProjectReport {
    #[serde(rename = "projectIssues")]
    pub project_issues: Vec<ProjectIssue>,
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
    #[serde(rename = "assetReport", skip_serializing_if = "Option::is_none")]
    pub asset_report: Option<AssetReport>,
    #[serde(rename = "projectReport", skip_serializing_if = "Option::is_none")]
    pub project_report: Option<ProjectReport>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    Dark,
    Light,
}

impl Default for ThemeMode {
    fn default() -> Self {
        ThemeMode::Dark
    }
}

impl<'de> Deserialize<'de> for ThemeMode {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let raw = String::deserialize(deserializer)?;
        Ok(match raw.as_str() {
            "light" => ThemeMode::Light,
            "dark" => ThemeMode::Dark,
            _ => ThemeMode::Dark,
        })
    }
}

/// 应用级设置（非项目级），持久化到 app config 目录。
/// 新增字段时加 #[serde(default)] 保证向前兼容。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct AppSettings {
    #[serde(default)]
    pub theme: ThemeMode,
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            theme: ThemeMode::default(),
        }
    }
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

    let renderer_ids = list_renderer_ids(&project_path);
    let (graph, nodes, mut graph_issues) = load_project_graph_data(&content_root)?;
    graph_issues.extend(legacy_chapter_layout_issues(&content_root, &meta_json));
    graph_issues.extend(validate_graph(&graph, &nodes));
    let graph_report = GraphReport { graph_issues };
    let asset_report = AssetReport {
        asset_issues: validate_assets(&content_root, &manifest),
    };

    // 全局聚合：图结构 + 资产 + manifest 结构三类问题汇总成一个报告
    let manifest_issues = validate_manifest_structure(&manifest);
    let mut project_issues: Vec<ProjectIssue> = vec![];
    project_issues.extend(
        graph_report
            .graph_issues
            .iter()
            .map(|i| graph_issue_to_project(i, "graph")),
    );
    project_issues.extend(
        asset_report
            .asset_issues
            .iter()
            .map(|i| graph_issue_to_project(i, "asset")),
    );
    project_issues.extend(manifest_issues);
    // 组内排序：error 优先于 warn（source 内稳定）
    project_issues.sort_by_key(|i| (i.source.clone(), i.severity != GraphIssueSeverity::Error));
    let project_report = ProjectReport { project_issues };

    Ok(ProjectData {
        path: project_path.to_string_lossy().into_owned(),
        meta,
        content: ProjectContent {
            manifest,
            meta: meta_json,
        },
        renderer_ids,
        graph: Some(graph),
        nodes: Some(nodes),
        graph_report: Some(graph_report),
        asset_report: Some(asset_report),
        project_report: Some(project_report),
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

// ──────────────────────────────────────────────
// 资产一致性校验（磁盘文件 ↔ manifest 声明）
// ──────────────────────────────────────────────

/// 资产 kind，由 content/assets/ 下的目录前缀推断。
/// 序列化成小写字符串，与前端 AssetKind 对齐。
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AssetKind {
    Background,
    Character,
    Bgm,
    Sfx,
    Voice,
    Unknown,
}

impl AssetKind {
    /// 由 content 根的相对路径（如 "assets/audio/bgm/x.mp3"）推断 kind。
    fn from_rel_path(rel: &str) -> AssetKind {
        let lower = rel.replace('\\', "/");
        if lower.starts_with("assets/backgrounds/") {
            AssetKind::Background
        } else if lower.starts_with("assets/characters/") {
            AssetKind::Character
        } else if lower.starts_with("assets/audio/bgm/") {
            AssetKind::Bgm
        } else if lower.starts_with("assets/audio/sfx/") {
            AssetKind::Sfx
        } else if lower.starts_with("assets/audio/voice/") {
            AssetKind::Voice
        } else {
            AssetKind::Unknown
        }
    }
}

#[derive(Serialize, Clone)]
pub struct AssetEntry {
    /// 相对 content 根的路径，如 "assets/backgrounds/ocean.svg"
    #[serde(rename = "relPath")]
    pub rel_path: String,
    pub size: u64,
    pub kind: AssetKind,
}

/// 递归收集 content/assets/ 下的所有文件。
/// rel 路径相对 content 根（与 manifest 引用路径一致），并归一化斜杠。
fn collect_asset_files(
    content_root: &Path,
    dir: &Path,
    out: &mut Vec<AssetEntry>,
) -> Result<(), String> {
    let entries =
        fs::read_dir(dir).map_err(|e| format!("读取目录失败 {}: {}", dir.display(), e))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_asset_files(content_root, &path, out)?;
        } else {
            let rel = path
                .strip_prefix(content_root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            let kind = AssetKind::from_rel_path(&rel);
            out.push(AssetEntry {
                rel_path: rel,
                size,
                kind,
            });
        }
    }
    Ok(())
}

/// 扫描 content/assets/ 下的所有文件，返回资产清单。
fn list_asset_entries(content_root: &Path) -> Result<Vec<AssetEntry>, String> {
    let assets_dir = content_root.join("assets");
    if !assets_dir.is_dir() {
        return Ok(vec![]);
    }
    let mut entries = vec![];
    collect_asset_files(content_root, &assets_dir, &mut entries)?;
    // 稳定排序：先按 kind，再按路径，便于 UI 展示与测试断言。
    entries.sort_by(|a, b| {
        a.kind
            .as_str()
            .cmp(b.kind.as_str())
            .then_with(|| a.rel_path.cmp(&b.rel_path))
    });
    Ok(entries)
}

impl AssetKind {
    fn as_str(&self) -> &'static str {
        match self {
            AssetKind::Background => "background",
            AssetKind::Character => "character",
            AssetKind::Bgm => "bgm",
            AssetKind::Sfx => "sfx",
            AssetKind::Voice => "voice",
            AssetKind::Unknown => "unknown",
        }
    }
}

/// 收集 manifest 中声明的所有资产路径（相对 content 根）。
/// 返回 (路径, 来源描述)，用于在悬空引用里指明是谁声明的。
fn collect_manifest_asset_paths(manifest: &serde_json::Value) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = vec![];

    // backgrounds: id → path
    if let Some(obj) = manifest.get("backgrounds").and_then(|v| v.as_object()) {
        for (id, path) in obj {
            if let Some(p) = path.as_str() {
                out.push((p.to_string(), format!("backgrounds.{id}")));
            }
        }
    }

    // characters.<id>.sprites.<expr> → path
    if let Some(obj) = manifest.get("characters").and_then(|v| v.as_object()) {
        for (char_id, char_val) in obj {
            if let Some(sprites) = char_val.get("sprites").and_then(|v| v.as_object()) {
                for (expr, path) in sprites {
                    if let Some(p) = path.as_str() {
                        out.push((
                            p.to_string(),
                            format!("characters.{char_id}.sprites.{expr}"),
                        ));
                    }
                }
            }
        }
    }

    // audio.{bgm,sfx,voice}.<id> → path
    if let Some(audio) = manifest.get("audio") {
        for sub in ["bgm", "sfx", "voice"] {
            if let Some(obj) = audio.get(sub).and_then(|v| v.as_object()) {
                for (id, path) in obj {
                    if let Some(p) = path.as_str() {
                        out.push((p.to_string(), format!("audio.{sub}.{id}")));
                    }
                }
            }
        }
    }

    out
}

/// 校验资产一致性：磁盘文件 ↔ manifest 声明。
/// - missing_asset (error)：manifest 声明了但磁盘文件不存在（悬空引用）
/// - orphan_asset (error)：磁盘有文件但 manifest 没登记（剧本引用不到）
/// - duplicate_asset_ref (warn)：同一文件被多个 manifest 条目声明
pub fn validate_assets(content_root: &Path, manifest: &serde_json::Value) -> Vec<GraphIssue> {
    let mut issues = vec![];

    // 磁盘文件集合（路径已归一化为相对 content 根）
    let disk_entries = list_asset_entries(content_root).unwrap_or_default();
    let mut disk_paths: std::collections::HashSet<String> =
        disk_entries.iter().map(|e| e.rel_path.clone()).collect();

    // manifest 声明的路径
    let declared = collect_manifest_asset_paths(manifest);

    // 1. 悬空引用 + 重复声明检测
    let mut seen_path_to_sources: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    for (path, source) in &declared {
        let normalized = path.replace('\\', "/");
        seen_path_to_sources
            .entry(normalized.clone())
            .or_default()
            .push(source.clone());

        if !disk_paths.remove(&normalized) {
            // remove 返回 false：要么根本不存在（悬空），要么该路径已被消费过（重复）
            if !disk_entries.iter().any(|e| e.rel_path == normalized) {
                // 文件确实不在磁盘上
                issues.push(GraphIssue {
                    severity: GraphIssueSeverity::Error,
                    code: "missing_asset".to_string(),
                    message: format!(
                        "manifest 声明了资源但文件不存在：{}（{}）",
                        normalized, source
                    ),
                    file: Some(format!("content/{}", normalized)),
                    json_path: Some(format!("$.{source}")),
                    node_id: None,
                    edge_id: None,
                });
            }
        }
    }

    // 重复声明：同一文件被多个 manifest 条目引用
    for (path, sources) in &seen_path_to_sources {
        if sources.len() > 1 {
            let mut sorted = sources.clone();
            sorted.sort();
            issues.push(GraphIssue {
                severity: GraphIssueSeverity::Warn,
                code: "duplicate_asset_ref".to_string(),
                message: format!(
                    "资源被多个 manifest 条目引用：{}（{}）",
                    path,
                    sorted.join(", ")
                ),
                file: Some(format!("content/{}", path)),
                json_path: None,
                node_id: None,
                edge_id: None,
            });
        }
    }

    // 2. 孤儿文件：disk_paths 经过上面的 remove 后，剩下的就是没被任何 manifest 声明的
    let mut orphans: Vec<String> = disk_paths.into_iter().collect();
    orphans.sort();
    for orphan in orphans {
        issues.push(GraphIssue {
            severity: GraphIssueSeverity::Error,
            code: "orphan_asset".to_string(),
            message: format!("磁盘文件未被 manifest 登记剧本无法引用：{}", orphan),
            file: Some(format!("content/{}", orphan)),
            json_path: None,
            node_id: None,
            edge_id: None,
        });
    }

    issues
}

// ──────────────────────────────────────────────
// manifest 结构校验（对应前端 Zod 的 .strict()）
// 非阻断：不阻止项目加载，问题进 projectReport。
// ──────────────────────────────────────────────

/// 校验 manifest 的结构合法性。与 engine ManifestSchema 的 .strict() 等价。
/// 重点检查 audio 必须是含 bgm/sfx/voice 三子表的对象，
/// 旧 flat audio（audio: { bgm_main: ... }）会被检为 manifest_invalid_audio。
pub fn validate_manifest_structure(manifest: &serde_json::Value) -> Vec<ProjectIssue> {
    let mut issues = vec![];
    let obj = match manifest.as_object() {
        Some(o) => o,
        None => {
            issues.push(ProjectIssue {
                severity: GraphIssueSeverity::Error,
                source: "manifest".to_string(),
                code: "manifest_not_object".to_string(),
                message: "manifest.json 不是一个 JSON 对象".to_string(),
                file: Some("content/manifest.json".to_string()),
                json_path: Some("$".to_string()),
                node_id: None,
                edge_id: None,
            });
            return issues;
        }
    };

    // audio 必须存在且是含 bgm/sfx/voice 三子表的对象
    let audio = match obj.get("audio") {
        Some(a) => a,
        None => {
            issues.push(ProjectIssue {
                severity: GraphIssueSeverity::Error,
                source: "manifest".to_string(),
                code: "manifest_missing_audio".to_string(),
                message: "manifest 缺少 audio 字段".to_string(),
                file: Some("content/manifest.json".to_string()),
                json_path: Some("$.audio".to_string()),
                node_id: None,
                edge_id: None,
            });
            return issues;
        }
    };

    let audio_obj = match audio.as_object() {
        Some(o) => o,
        None => {
            issues.push(ProjectIssue {
                severity: GraphIssueSeverity::Error,
                source: "manifest".to_string(),
                code: "manifest_invalid_audio".to_string(),
                message: "manifest.audio 不是对象".to_string(),
                file: Some("content/manifest.json".to_string()),
                json_path: Some("$.audio".to_string()),
                node_id: None,
                edge_id: None,
            });
            return issues;
        }
    };

    // 三张子表必须存在
    for sub in ["bgm", "sfx", "voice"] {
        if !audio_obj.contains_key(sub) {
            issues.push(ProjectIssue {
                severity: GraphIssueSeverity::Error,
                source: "manifest".to_string(),
                code: "manifest_invalid_audio".to_string(),
                message: format!("manifest.audio 缺少 {sub} 子表"),
                file: Some("content/manifest.json".to_string()),
                json_path: Some(format!("$.audio.{sub}")),
                node_id: None,
                edge_id: None,
            });
        }
    }

    // 未知 key（旧 flat audio 的 id 会落在这里，如 audio.bgm_main）
    let known: std::collections::HashSet<&str> = ["bgm", "sfx", "voice"].iter().copied().collect();
    let mut unknown: Vec<&String> = audio_obj
        .keys()
        .filter(|k| !known.contains(k.as_str()))
        .collect();
    unknown.sort();
    if !unknown.is_empty() {
        issues.push(ProjectIssue {
            severity: GraphIssueSeverity::Error,
            source: "manifest".to_string(),
            code: "manifest_invalid_audio".to_string(),
            message: format!(
                "manifest.audio 含未知字段（可能是旧 flat 格式）：{}",
                unknown
                    .iter()
                    .map(|k| k.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            file: Some("content/manifest.json".to_string()),
            json_path: Some("$.audio".to_string()),
            node_id: None,
            edge_id: None,
        });
    }

    issues
}

/// 把 GraphIssue 映射成 ProjectIssue（补 source 字段，保留 nodeId/edgeId 供 UI 定位）。
fn graph_issue_to_project(issue: &GraphIssue, source: &str) -> ProjectIssue {
    ProjectIssue {
        severity: issue.severity.clone(),
        source: source.to_string(),
        code: issue.code.clone(),
        message: issue.message.clone(),
        file: issue.file.clone(),
        json_path: issue.json_path.clone(),
        node_id: issue.node_id.clone(),
        edge_id: issue.edge_id.clone(),
    }
}

pub fn load_project_graph_data(
    content_root: &Path,
) -> Result<(ProjectGraph, Vec<NodeEntry>, Vec<GraphIssue>), String> {
    let graph_path = content_root.join("graph.json");
    if graph_path.is_file() {
        let (graph, nodes) = load_graph_file(content_root, &graph_path)?;
        Ok((graph, nodes, vec![]))
    } else {
        Ok((empty_project_graph(), vec![], vec![missing_graph_issue()]))
    }
}

fn empty_project_graph() -> ProjectGraph {
    ProjectGraph {
        version: 1,
        entry_node_id: String::new(),
        nodes: vec![],
        edges: vec![],
    }
}

fn missing_graph_issue() -> GraphIssue {
    GraphIssue {
        severity: GraphIssueSeverity::Error,
        code: "missing_graph".to_string(),
        message: "缺少 content/graph.json：GalStudio 项目必须以脚本图作为剧本入口。".to_string(),
        file: Some("content/graph.json".to_string()),
        json_path: Some("$".to_string()),
        node_id: None,
        edge_id: None,
    }
}

fn legacy_chapter_layout_issues(
    content_root: &Path,
    meta_json: &serde_json::Value,
) -> Vec<GraphIssue> {
    if meta_json.get("chapters").is_some() {
        return vec![GraphIssue {
            severity: GraphIssueSeverity::Error,
            code: "legacy_chapters_not_supported".to_string(),
            message:
                "旧章节项目不再兼容：请创建 content/graph.json，并把剧情写入 content/nodes/*.json。"
                    .to_string(),
            file: Some("content/meta.json".to_string()),
            json_path: Some("$.chapters".to_string()),
            node_id: None,
            edge_id: None,
        }];
    }

    if content_root.join("chapters").exists() {
        return vec![GraphIssue {
            severity: GraphIssueSeverity::Error,
            code: "legacy_chapters_not_supported".to_string(),
            message: "旧章节目录不再作为剧本入口：请创建 content/graph.json，并把剧情写入 content/nodes/*.json。".to_string(),
            file: Some("content/chapters".to_string()),
            json_path: None,
            node_id: None,
            edge_id: None,
        }];
    }

    vec![]
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
        },
        node_entries,
    ))
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

    // 创建目录骨架（资源放在 content/assets/，节点放在 content/nodes/）
    fs::create_dir_all(project_path.join("content/nodes"))
        .map_err(|e| format!("创建 content/nodes 失败: {}", e))?;
    fs::create_dir_all(project_path.join("content/assets"))
        .map_err(|e| format!("创建 content/assets 失败: {}", e))?;
    fs::create_dir_all(project_path.join("renderers/default"))
        .map_err(|e| format!("创建 renderers/default 失败: {}", e))?;

    // 写最小 manifest / meta
    let manifest = serde_json::json!({
        "characters": {},
        "backgrounds": {},
        "audio": { "bgm": {}, "sfx": {}, "voice": {} }
    });
    write_json(&project_path.join("content/manifest.json"), &manifest)?;

    let meta = serde_json::json!({
        "title": &name,
        "typingSpeedCps": 30,
        "autoAdvanceMs": 1200,
        "chapterGapMs": 1500
    });
    write_json(&project_path.join("content/meta.json"), &meta)?;

    let graph = serde_json::json!({
        "version": 1,
        "entryNodeId": "start",
        "nodes": [
            {
                "id": "start",
                "title": "开始",
                "file": "nodes/start.json",
                "position": { "x": 120, "y": 120 }
            }
        ],
        "edges": []
    });
    write_json(&project_path.join("content/graph.json"), &graph)?;

    let start_node = serde_json::json!([
        { "t": "narrate", "text": "新的故事从这里开始。" }
    ]);
    write_json(&project_path.join("content/nodes/start.json"), &start_node)?;
    write_project_self_description(project_path)?;

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

// ──────────────────────────────────────────────
// 资产管理命令（list / import / delete / save_manifest）
// 路径一律相对 content 根，与 manifest 引用路径一致。
// ──────────────────────────────────────────────

/// 列出 content/assets/ 下的所有资产文件（递归），含 kind 推断与大小。
#[tauri::command]
fn list_assets(project_path: String) -> Result<Vec<AssetEntry>, String> {
    let project_root = canonical_project_root(Path::new(&project_path))?;
    let content_dir = project_root.join("content");
    let content_root = content_dir
        .canonicalize()
        .map_err(|e| format!("无法定位 content 目录 {}: {}", content_dir.display(), e))?;
    list_asset_entries(&content_root)
}

/// 导入资产：把外部文件拷贝进 content/assets/。
/// - source_abs_path：来自对话框的外部文件绝对路径
/// - dest_rel_path：目标相对 content 根的路径，如 "assets/audio/bgm/battle.mp3"
/// 不静默覆盖已有文件（符合 AGENTS.md 保守用户文件原则）。
#[tauri::command]
fn import_asset(
    project_path: String,
    source_abs_path: String,
    dest_rel_path: String,
) -> Result<(), String> {
    let project_root = canonical_project_root(Path::new(&project_path))?;
    let content_dir = project_root.join("content");
    let content_root = content_dir
        .canonicalize()
        .map_err(|e| format!("无法定位 content 目录 {}: {}", content_dir.display(), e))?;

    // 目标必须在 content 内（防越界）
    let dest = resolve_relative_under(&content_root, &dest_rel_path)?;
    if dest.exists() {
        return Err(format!("目标文件已存在，未覆盖（{}）", dest.display()));
    }

    // 源文件必须存在且可读
    let source = Path::new(&source_abs_path);
    if !source.is_file() {
        return Err(format!("源文件不存在或不可读：{}", source.display()));
    }

    // 建父目录后再校验父目录仍在 content 内（防符号链接逃逸）
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
        ensure_existing_path_within(&content_root, parent)?;
    }

    fs::copy(source, &dest).map_err(|e| {
        format!(
            "拷贝文件失败 ({} → {}): {}",
            source.display(),
            dest.display(),
            e
        )
    })?;
    Ok(())
}

/// 删除 content/ 下的资产文件。路径相对 content 根，幂等（缺失视为已删除）。
/// 注意：此命令只删文件，manifest 条目的移除由 save_manifest 统一负责（单一写入点）。
#[tauri::command]
fn delete_asset(project_path: String, rel_path: String) -> Result<(), String> {
    // 语义与 delete_file 完全一致（都是 content 根相对路径删文件）；
    // 单独命名是为了在前端语义上区分「删资产」与「删节点文件」。
    delete_file(project_path, rel_path)
}

/// 读取 content/ 下的图片资产，返回可直接用于 <img src> 的 data URL。
/// 前端资产缩略图走这个命令，而不是直接把本地磁盘路径暴露给 WebView。
#[tauri::command]
fn read_asset_preview_data_url(project_path: String, rel_path: String) -> Result<String, String> {
    let project_root = canonical_project_root(Path::new(&project_path))?;
    let content_dir = project_root.join("content");
    let content_root = content_dir
        .canonicalize()
        .map_err(|e| format!("无法定位 content 目录 {}: {}", content_dir.display(), e))?;
    let target = resolve_relative_under(&content_root, &rel_path)?;

    let mime = preview_image_mime(&rel_path)
        .ok_or_else(|| format!("不支持预览的图片类型: {}", rel_path))?;
    ensure_existing_path_within(&content_root, &target)?;
    if !target.is_file() {
        return Err(format!("资产文件不存在或不是文件: {}", target.display()));
    }

    let size = fs::metadata(&target)
        .map_err(|e| format!("读取资产信息失败 ({}): {}", target.display(), e))?
        .len();
    if size > MAX_ASSET_PREVIEW_BYTES {
        return Err(format!(
            "资产预览过大（{} bytes），超过 {} bytes",
            size, MAX_ASSET_PREVIEW_BYTES
        ));
    }

    let bytes =
        fs::read(&target).map_err(|e| format!("读取资产预览失败 ({}): {}", target.display(), e))?;
    Ok(format!(
        "data:{};base64,{}",
        mime,
        BASE64_STANDARD.encode(bytes)
    ))
}

fn preview_image_mime(rel_path: &str) -> Option<&'static str> {
    let ext = Path::new(rel_path)
        .extension()
        .and_then(|s| s.to_str())?
        .to_ascii_lowercase();
    match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "svg" => Some("image/svg+xml"),
        "bmp" => Some("image/bmp"),
        _ => None,
    }
}

// ── save_manifest 的输入类型 ──

#[derive(Deserialize, Clone)]
pub struct ManifestCharacterInput {
    pub name: String,
    #[serde(default = "default_color")]
    pub color: String,
    pub sprites: std::collections::HashMap<String, String>,
}

fn default_color() -> String {
    "#ffffff".to_string()
}

#[derive(Deserialize, Clone, Default)]
pub struct ManifestAudioRegistryInput {
    #[serde(default)]
    pub bgm: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub sfx: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub voice: std::collections::HashMap<String, String>,
}

#[derive(Deserialize, Clone)]
pub struct ManifestInput {
    #[serde(default)]
    pub characters: std::collections::HashMap<String, ManifestCharacterInput>,
    #[serde(default)]
    pub backgrounds: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub audio: ManifestAudioRegistryInput,
}

/// 保存 content/manifest.json。镜像 save_graph 的模式：
/// 类型化输入 → 字段校验 → canonical JSON → 写盘。
#[tauri::command]
fn save_manifest(project_path: String, manifest: ManifestInput) -> Result<(), String> {
    let project_root = canonical_project_root(Path::new(&project_path))?;
    let content_dir = project_root.join("content");
    let content_root = content_dir
        .canonicalize()
        .map_err(|e| format!("无法定位 content 目录 {}: {}", content_dir.display(), e))?;

    // 基本校验：角色名不能空
    for (id, char) in &manifest.characters {
        if id.is_empty() {
            return Err("角色 id 不能为空".to_string());
        }
        if char.name.is_empty() {
            return Err(format!("角色 {id} 的 name 不能为空"));
        }
    }

    // 序列化成 canonical JSON（characters/bgs 用 json! 构造保证对象形态）
    let characters: serde_json::Value = {
        let mut map = serde_json::Map::new();
        for (id, char) in &manifest.characters {
            map.insert(
                id.clone(),
                serde_json::json!({
                    "name": char.name,
                    "color": char.color,
                    "sprites": char.sprites,
                }),
            );
        }
        serde_json::Value::Object(map)
    };

    let value = serde_json::json!({
        "characters": characters,
        "backgrounds": manifest.backgrounds,
        "audio": {
            "bgm": manifest.audio.bgm,
            "sfx": manifest.audio.sfx,
            "voice": manifest.audio.voice,
        },
    });

    let manifest_path = content_dir.join("manifest.json");
    if manifest_path.exists() {
        ensure_existing_path_within(&content_root, &manifest_path)?;
    }
    write_json(&manifest_path, &value)
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

fn write_text_file(path: &Path, text: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    fs::write(path, text).map_err(|e| format!("写文件失败 ({}): {}", path.display(), e))
}

fn write_project_self_description(project_path: &Path) -> Result<(), String> {
    write_text_file(&project_path.join("AGENTS.md"), PROJECT_AGENTS_MD)?;
    write_text_file(
        &project_path.join(".galstudio/README.md"),
        PROJECT_README_MD,
    )?;
    for (name, text) in PROJECT_SCHEMA_FILES {
        write_text_file(&project_path.join(".galstudio/schemas").join(name), text)?;
    }
    Ok(())
}

fn default_renderer_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("获取 resource_dir 失败: {}", e))?
        .join("resources/default-renderer"))
}

// ──────────────────────────────────────────────
// 应用级设置（非项目级），存到 app config 目录的 settings.json
// ──────────────────────────────────────────────

fn settings_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_handle
        .path()
        .app_config_dir()
        .map_err(|e| format!("获取 app_config_dir 失败: {}", e))?
        .join("settings.json"))
}

/// 加载应用设置。文件不存在时返回默认值（首次运行）。
#[tauri::command]
fn load_app_settings(app_handle: tauri::AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(&app_handle)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let text = fs::read_to_string(&path)
        .map_err(|e| format!("读取设置失败 ({}): {}", path.display(), e))?;
    serde_json::from_str::<AppSettings>(&text)
        .map_err(|e| format!("解析设置失败 ({}): {}", path.display(), e))
}

/// 保存应用设置。
#[tauri::command]
fn save_app_settings(app_handle: tauri::AppHandle, settings: AppSettings) -> Result<(), String> {
    let path = settings_path(&app_handle)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建设置目录失败: {}", e))?;
    }
    let json =
        serde_json::to_string_pretty(&settings).map_err(|e| format!("序列化设置失败: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("写设置失败 ({}): {}", path.display(), e))
}

fn ensure_initialization_targets_available(
    project_path: &Path,
    default_renderer_dir: &Path,
) -> Result<(), String> {
    for path in [
        project_path.join("gal.project.json"),
        project_path.join("content/manifest.json"),
        project_path.join("content/meta.json"),
        project_path.join("content/graph.json"),
        project_path.join("content/nodes/start.json"),
        project_path.join("AGENTS.md"),
        project_path.join(".galstudio/README.md"),
        project_path.join(".galstudio/schemas/graph.json"),
        project_path.join(".galstudio/schemas/nodeFile.json"),
        project_path.join(".galstudio/schemas/manifest.json"),
        project_path.join(".galstudio/schemas/meta.json"),
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
            list_assets,
            import_asset,
            delete_asset,
            read_asset_preview_data_url,
            save_manifest,
            load_app_settings,
            save_app_settings,
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

    fn write_minimal_project(project: &Path) {
        write_text(
            &project.join("gal.project.json"),
            r#"{"name":"Test","activeRendererId":"default","createdAt":"0"}"#,
        );
        write_text(
            &project.join("content/manifest.json"),
            r#"{"characters":{},"backgrounds":{},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
        );
        write_json(
            &project.join("content/meta.json"),
            &serde_json::json!({
                "title": "Test",
                "typingSpeedCps": 30,
                "autoAdvanceMs": 1200,
                "chapterGapMs": 1500
            }),
        )
        .unwrap();
    }

    fn write_legacy_chapter_project(project: &Path, chapters_value: serde_json::Value) {
        write_minimal_project(project);
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
        write_minimal_project(project);
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
        write_minimal_project(project);
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
        write_minimal_project(&project);
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
        write_minimal_project(&project);
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
        write_minimal_project(&project);

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
        write_minimal_project(&project);
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
        write_minimal_project(&project);
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
    fn open_project_reports_legacy_chapters_without_synthesizing_graph() {
        let root = unique_temp_dir("legacy-chapters-report");
        let project = root.join("project");
        write_legacy_chapter_project(&project, serde_json::json!(["chapters/ch01.json"]));
        write_text(&project.join("content/chapters/ch01.json"), "[]");

        let opened = open_project(project.to_string_lossy().into_owned()).unwrap();
        let graph = opened.graph.unwrap();
        let report = opened
            .project_report
            .expect("open_project 应返回 project_report");

        assert!(graph.nodes.is_empty(), "旧 chapters 不应再被合成图节点");
        assert!(graph.edges.is_empty(), "旧 chapters 不应再被合成图连线");
        let issue = report
            .project_issues
            .iter()
            .find(|issue| issue.source == "graph" && issue.code == "legacy_chapters_not_supported")
            .expect("旧 chapters 应进入全局项目错误");
        assert_eq!(issue.severity, GraphIssueSeverity::Error);
        assert_eq!(issue.file.as_deref(), Some("content/meta.json"));
        assert_eq!(issue.json_path.as_deref(), Some("$.chapters"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn open_project_reports_missing_graph_when_graph_json_is_absent() {
        let root = unique_temp_dir("missing-graph");
        let project = root.join("project");
        write_minimal_project(&project);

        let opened = open_project(project.to_string_lossy().into_owned()).unwrap();
        let graph = opened.graph.unwrap();
        let nodes = opened.nodes.unwrap();
        let report = opened
            .project_report
            .expect("open_project 应返回 project_report");

        assert_eq!(graph.entry_node_id, "");
        assert!(graph.nodes.is_empty());
        assert!(graph.edges.is_empty());
        assert!(nodes.is_empty());
        assert!(
            report
                .project_issues
                .iter()
                .any(|issue| issue.source == "graph" && issue.code == "missing_graph"),
            "缺少 graph.json 应进入项目错误"
        );
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
    fn open_project_does_not_create_graph_json_when_reporting_missing_or_legacy_graph() {
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

        let legacy_project = root.join("legacy-project");
        write_legacy_chapter_project(&legacy_project, serde_json::json!(["chapters/ch01.json"]));
        write_text(&legacy_project.join("content/chapters/ch01.json"), "[]");

        open_project(graph_project.to_string_lossy().into_owned()).unwrap();
        open_project(legacy_project.to_string_lossy().into_owned()).unwrap();

        assert_eq!(
            fs::read_to_string(graph_project.join("content/graph.json")).unwrap(),
            graph_before
        );
        assert!(!legacy_project.join("content/graph.json").exists());
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
    fn open_project_reports_legacy_chapter_paths_without_resolving_them() {
        let root = unique_temp_dir("chapter-escape");
        let project = root.join("project");
        write_legacy_chapter_project(&project, serde_json::json!(["../../outside.json"]));
        write_text(&root.join("outside.json"), "[]");

        let opened = open_project(project.to_string_lossy().into_owned()).unwrap();
        let issues = opened.project_report.unwrap().project_issues;

        assert!(issues.iter().any(|issue| {
            issue.source == "graph" && issue.code == "legacy_chapters_not_supported"
        }));
        assert!(root.join("outside.json").exists());
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
        assert!(project.join("content/graph.json").is_file());
        assert!(project.join("content/nodes/start.json").is_file());
        assert!(!project.join("content/chapters").exists());
        assert!(project.join("content/assets").is_dir());
        assert!(project.join("AGENTS.md").is_file());
        assert!(project.join(".galstudio/README.md").is_file());
        for schema_name in ["graph", "nodeFile", "manifest", "meta"] {
            let schema_path = project.join(format!(".galstudio/schemas/{schema_name}.json"));
            assert!(schema_path.is_file(), "missing schema {}", schema_name);
            let schema: serde_json::Value =
                serde_json::from_str(&fs::read_to_string(schema_path).unwrap()).unwrap();
            assert!(
                schema.get("type").is_some(),
                "schema {} should be valid JSON Schema",
                schema_name
            );
        }
        let graph_schema: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(project.join(".galstudio/schemas/graph.json")).unwrap(),
        )
        .unwrap();
        assert!(graph_schema["properties"].get("entryNodeId").is_some());
        assert!(graph_schema["properties"].get("nodes").is_some());
        let node_schema: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(project.join(".galstudio/schemas/nodeFile.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(node_schema["type"], "array");
        let manifest_schema: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(project.join(".galstudio/schemas/manifest.json")).unwrap(),
        )
        .unwrap();
        assert!(manifest_schema["properties"].get("characters").is_some());
        assert!(manifest_schema["properties"].get("backgrounds").is_some());
        assert!(manifest_schema["properties"].get("audio").is_some());
        let meta_schema: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(project.join(".galstudio/schemas/meta.json")).unwrap(),
        )
        .unwrap();
        assert!(meta_schema["properties"].get("title").is_some());
        assert!(meta_schema["properties"].get("typingSpeedCps").is_some());
        let agent_instructions = fs::read_to_string(project.join("AGENTS.md")).unwrap();
        assert!(agent_instructions.contains("content/graph.json"));
        assert!(agent_instructions.contains("content/nodes/*.json"));
        assert!(agent_instructions.contains("Instruction[]"));
        assert!(agent_instructions.contains("renderers/<id>/index.tsx"));
        assert!(agent_instructions.contains("galstudio-cli validate . --format json"));
        assert!(agent_instructions.contains("content/chapters/"));
        assert_eq!(
            fs::read_to_string(project.join("renderers/default/index.tsx")).unwrap(),
            "export default {};"
        );
        let opened = open_project(project.to_string_lossy().into_owned()).unwrap();
        assert_eq!(opened.meta.name, "Existing Story");
        assert_eq!(opened.renderer_ids, vec!["default".to_string()]);
        let graph = opened.graph.expect("新项目应有 graph.json");
        assert_eq!(graph.entry_node_id, "start");
        assert_eq!(graph.nodes[0].file, "nodes/start.json");
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
    fn initialize_project_root_does_not_overwrite_self_description_files() {
        let root = unique_temp_dir("init-self-description-conflict");
        let renderer_template = root.join("template");
        let project = root.join("story");
        write_text(&renderer_template.join("index.tsx"), "export default {};");
        write_text(&project.join("AGENTS.md"), "keep me");

        let result = initialize_project_root(&project, "story", &renderer_template);

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(project.join("AGENTS.md")).unwrap(),
            "keep me"
        );
        assert!(!project.join("gal.project.json").exists());

        let project_with_schema = root.join("story-with-schema");
        write_text(
            &project_with_schema.join(".galstudio/schemas/graph.json"),
            "{}",
        );

        let result = initialize_project_root(
            &project_with_schema,
            "story-with-schema",
            &renderer_template,
        );

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(project_with_schema.join(".galstudio/schemas/graph.json")).unwrap(),
            "{}"
        );
        assert!(!project_with_schema.join("gal.project.json").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn project_watch_filter_only_accepts_project_data_and_renderer_paths() {
        let root = Path::new("/tmp/story");

        assert_eq!(
            classify_project_watch_path(root, &root.join("content/nodes/start.json")),
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

    // ── 资产命令测试 ──

    /// 写一个 content/assets/ 下有文件的空项目（无图、无章节）。
    fn write_asset_project(project: &Path, manifest_json: &str, asset_files: &[&str]) {
        write_minimal_project(project);
        write_text(&project.join("content/manifest.json"), manifest_json);
        for rel in asset_files {
            write_text(&project.join("content").join(rel), "fake");
        }
    }

    #[test]
    fn list_assets_returns_empty_when_no_assets() {
        let dir = unique_temp_dir("list-assets-empty");
        write_asset_project(
            &dir,
            r#"{"characters":{},"backgrounds":{},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
            &[],
        );

        let entries = list_assets(dir.to_string_lossy().to_string()).unwrap();
        assert!(entries.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_assets_classifies_kind_by_path() {
        let dir = unique_temp_dir("list-assets-kind");
        write_asset_project(
            &dir,
            r#"{"characters":{},"backgrounds":{},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
            &[
                "assets/backgrounds/sky.png",
                "assets/characters/hero_default.png",
                "assets/audio/bgm/theme.mp3",
                "assets/audio/sfx/boom.wav",
                "assets/audio/voice/v01.mp3",
                "assets/misc/unknown.bin",
            ],
        );

        let entries = list_assets(dir.to_string_lossy().to_string()).unwrap();
        let kinds: Vec<_> = entries.iter().map(|e| e.kind.clone()).collect();
        assert!(kinds.contains(&AssetKind::Background));
        assert!(kinds.contains(&AssetKind::Character));
        assert!(kinds.contains(&AssetKind::Bgm));
        assert!(kinds.contains(&AssetKind::Sfx));
        assert!(kinds.contains(&AssetKind::Voice));
        assert!(kinds.contains(&AssetKind::Unknown));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn import_asset_copies_file_and_creates_dirs() {
        let dir = unique_temp_dir("import-asset");
        write_asset_project(
            &dir,
            r#"{"characters":{},"backgrounds":{},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
            &[],
        );
        // 准备一个外部源文件
        let src = dir.join("_src_sample.png");
        write_text(&src, "png-bytes");

        import_asset(
            dir.to_string_lossy().to_string(),
            src.to_string_lossy().to_string(),
            "assets/backgrounds/imported.png".to_string(),
        )
        .unwrap();

        let copied = dir.join("content/assets/backgrounds/imported.png");
        assert!(copied.is_file());
        assert_eq!(fs::read_to_string(&copied).unwrap(), "png-bytes");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn import_asset_rejects_traversal() {
        let dir = unique_temp_dir("import-traversal");
        write_asset_project(
            &dir,
            r#"{"characters":{},"backgrounds":{},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
            &[],
        );
        let src = dir.join("_src.png");
        write_text(&src, "x");

        let result = import_asset(
            dir.to_string_lossy().to_string(),
            src.to_string_lossy().to_string(),
            "../../etc/evil.png".to_string(),
        );
        assert!(result.is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn import_asset_rejects_existing_target() {
        let dir = unique_temp_dir("import-exists");
        write_asset_project(
            &dir,
            r#"{"characters":{},"backgrounds":{},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
            &["assets/backgrounds/exists.png"],
        );
        let src = dir.join("_src.png");
        write_text(&src, "x");

        let result = import_asset(
            dir.to_string_lossy().to_string(),
            src.to_string_lossy().to_string(),
            "assets/backgrounds/exists.png".to_string(),
        );
        assert!(result.is_err(), "不应静默覆盖已有文件");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn delete_asset_is_idempotent() {
        let dir = unique_temp_dir("delete-asset");
        write_asset_project(
            &dir,
            r#"{"characters":{},"backgrounds":{},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
            &["assets/backgrounds/gone.png"],
        );

        delete_asset(
            dir.to_string_lossy().to_string(),
            "assets/backgrounds/gone.png".to_string(),
        )
        .unwrap();
        // 再次删除已不存在的文件也应成功
        delete_asset(
            dir.to_string_lossy().to_string(),
            "assets/backgrounds/gone.png".to_string(),
        )
        .unwrap();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_manifest_roundtrip() {
        let dir = unique_temp_dir("save-manifest");
        write_asset_project(
            &dir,
            r#"{"characters":{},"backgrounds":{},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
            &[],
        );

        let manifest = ManifestInput {
            characters: {
                let mut m = std::collections::HashMap::new();
                m.insert(
                    "hero".to_string(),
                    ManifestCharacterInput {
                        name: "主角".to_string(),
                        color: "#9fc8e3".to_string(),
                        sprites: {
                            let mut s = std::collections::HashMap::new();
                            s.insert(
                                "default".to_string(),
                                "assets/characters/hero.svg".to_string(),
                            );
                            s
                        },
                    },
                );
                m
            },
            backgrounds: {
                let mut m = std::collections::HashMap::new();
                m.insert("sky".to_string(), "assets/backgrounds/sky.png".to_string());
                m
            },
            audio: ManifestAudioRegistryInput {
                bgm: {
                    let mut m = std::collections::HashMap::new();
                    m.insert(
                        "theme".to_string(),
                        "assets/audio/bgm/theme.mp3".to_string(),
                    );
                    m
                },
                sfx: std::collections::HashMap::new(),
                voice: std::collections::HashMap::new(),
            },
        };

        save_manifest(dir.to_string_lossy().to_string(), manifest).unwrap();

        let written = fs::read_to_string(dir.join("content/manifest.json")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&written).unwrap();
        assert_eq!(parsed["characters"]["hero"]["name"], "主角");
        assert_eq!(
            parsed["audio"]["bgm"]["theme"],
            "assets/audio/bgm/theme.mp3"
        );
        // 三张子表都应存在（即使为空）
        assert!(parsed["audio"]["sfx"].is_object());
        assert!(parsed["audio"]["voice"].is_object());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn validate_assets_flags_orphan_and_dangling() {
        let dir = unique_temp_dir("validate-assets");
        // manifest 声明了 sky（存在）和 ghost（不存在）；磁盘上还有一个未登记的 orphan.png
        write_asset_project(
            &dir,
            r#"{"characters":{},"backgrounds":{"sky":"assets/backgrounds/sky.png","ghost":"assets/backgrounds/ghost.png"},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
            &[
                "assets/backgrounds/sky.png",
                "assets/backgrounds/orphan.png",
            ],
        );

        let content_root = dir.join("content").canonicalize().unwrap();
        let manifest = read_json(&dir.join("content/manifest.json")).unwrap();
        let issues = validate_assets(&content_root, &manifest);

        let codes: Vec<_> = issues.iter().map(|i| i.code.as_str()).collect();
        assert!(
            codes.contains(&"missing_asset"),
            "应检出悬空引用 ghost: {codes:?}"
        );
        assert!(
            codes.contains(&"orphan_asset"),
            "应检出孤儿文件 orphan.png: {codes:?}"
        );

        let missing = issues.iter().find(|i| i.code == "missing_asset").unwrap();
        assert_eq!(missing.severity, GraphIssueSeverity::Error);
        let orphan = issues.iter().find(|i| i.code == "orphan_asset").unwrap();
        assert_eq!(orphan.severity, GraphIssueSeverity::Error);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn validate_assets_clean_when_consistent() {
        let dir = unique_temp_dir("validate-assets-clean");
        // 磁盘和 manifest 完全一致 → 无问题
        write_asset_project(
            &dir,
            r##"{"characters":{"hero":{"name":"主角","color":"#fff","sprites":{"default":"assets/characters/hero.svg"}}},"backgrounds":{"sky":"assets/backgrounds/sky.png"},"audio":{"bgm":{"theme":"assets/audio/bgm/theme.mp3"},"sfx":{},"voice":{}}}"##,
            &[
                "assets/characters/hero.svg",
                "assets/backgrounds/sky.png",
                "assets/audio/bgm/theme.mp3",
            ],
        );

        let content_root = dir.join("content").canonicalize().unwrap();
        let manifest = read_json(&dir.join("content/manifest.json")).unwrap();
        let issues = validate_assets(&content_root, &manifest);
        assert!(issues.is_empty(), "一致时应无问题: {issues:?}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn validate_assets_flags_duplicate_ref() {
        let dir = unique_temp_dir("validate-assets-dup");
        // 同一文件被两个 background id 引用
        write_asset_project(
            &dir,
            r#"{"characters":{},"backgrounds":{"a":"assets/backgrounds/sky.png","b":"assets/backgrounds/sky.png"},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
            &["assets/backgrounds/sky.png"],
        );

        let content_root = dir.join("content").canonicalize().unwrap();
        let manifest = read_json(&dir.join("content/manifest.json")).unwrap();
        let issues = validate_assets(&content_root, &manifest);

        let dup = issues.iter().find(|i| i.code == "duplicate_asset_ref");
        assert!(dup.is_some(), "应检出重复引用: {issues:?}");
        assert_eq!(dup.unwrap().severity, GraphIssueSeverity::Warn);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn open_project_includes_asset_report() {
        let dir = unique_temp_dir("open-asset-report");
        write_asset_project(
            &dir,
            r#"{"characters":{},"backgrounds":{},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
            &["assets/backgrounds/orphan.png"],
        );

        let data = open_project_inner(dir.to_string_lossy().as_ref()).unwrap();
        let report = data.asset_report.expect("open_project 应返回 asset_report");
        // orphan.png 没在 manifest 登记 → 应有 orphan_asset 问题
        assert!(report.asset_issues.iter().any(|i| i.code == "orphan_asset"));
        let _ = fs::remove_dir_all(&dir);
    }

    // ── 全局报告聚合 + manifest 结构校验测试 ──

    #[test]
    fn validate_manifest_structure_flags_flat_audio() {
        // 旧 flat audio：audio: { bgm_main: ... }，缺少 bgm/sfx/voice 子表
        let manifest = serde_json::json!({
            "characters": {},
            "backgrounds": {},
            "audio": { "bgm_main": "x.mp3" }
        });
        let issues = validate_manifest_structure(&manifest);
        let codes: Vec<_> = issues.iter().map(|i| i.code.as_str()).collect();
        assert!(
            codes.iter().all(|c| *c == "manifest_invalid_audio"),
            "应检出 audio 结构错误: {codes:?}"
        );
        assert_eq!(issues[0].source, "manifest");
        assert_eq!(issues[0].severity, GraphIssueSeverity::Error);
    }

    #[test]
    fn validate_manifest_structure_clean_for_new_format() {
        let manifest = serde_json::json!({
            "characters": {},
            "backgrounds": {},
            "audio": { "bgm": {}, "sfx": {}, "voice": {} }
        });
        let issues = validate_manifest_structure(&manifest);
        assert!(issues.is_empty(), "新格式应无结构问题: {issues:?}");
    }

    #[test]
    fn open_project_aggregates_project_report() {
        let dir = unique_temp_dir("aggregate-report");
        // 制造三类问题：
        // - graph: 入口指向不存在节点（missing_entry_node, error）
        // - asset: 孤儿文件（orphan_asset, error）
        // - manifest: 格式正确（无问题）
        write_asset_project(
            &dir,
            r#"{"characters":{},"backgrounds":{},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
            &["assets/backgrounds/orphan.png"],
        );
        write_text(
            &dir.join("content/graph.json"),
            r#"{"version":1,"entryNodeId":"ghost","nodes":[{"id":"a","title":"A","file":"nodes/a.json","position":{"x":0,"y":0}}],"edges":[]}"#,
        );
        write_text(&dir.join("content/nodes/a.json"), "[]");

        let data = open_project_inner(dir.to_string_lossy().as_ref()).unwrap();
        let report = data
            .project_report
            .expect("open_project 应返回 project_report");

        let sources: Vec<_> = report
            .project_issues
            .iter()
            .map(|i| i.source.as_str())
            .collect();
        assert!(sources.contains(&"graph"), "应含图结构问题: {sources:?}");
        assert!(sources.contains(&"asset"), "应含资产问题: {sources:?}");
        // manifest 格式正确 → 不应有 manifest source
        assert!(!sources.contains(&"manifest"), "manifest 正确时不应有问题");

        // 每个 issue 都应有 source 字段
        assert!(report.project_issues.iter().all(|i| !i.source.is_empty()));
        let graph_issue = report
            .project_issues
            .iter()
            .find(|i| i.source == "graph" && i.code == "missing_entry_node")
            .expect("应保留 missing_entry_node");
        assert_eq!(graph_issue.node_id.as_deref(), Some("ghost"));
        assert_eq!(graph_issue.edge_id, None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn open_project_report_includes_manifest_error() {
        let dir = unique_temp_dir("report-manifest-err");
        // 旧 flat audio manifest → manifest 结构错误应进 project_report
        write_asset_project(
            &dir,
            r#"{"characters":{},"backgrounds":{},"audio":{"bgm_main":"x.mp3"}}"#,
            &[],
        );

        let data = open_project_inner(dir.to_string_lossy().as_ref()).unwrap();
        let report = data.project_report.expect("应有 project_report");
        assert!(
            report
                .project_issues
                .iter()
                .any(|i| i.source == "manifest" && i.code == "manifest_invalid_audio"),
            "应含 manifest 结构错误: {:?}",
            report
                .project_issues
                .iter()
                .map(|i| &i.code)
                .collect::<Vec<_>>()
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_asset_preview_data_url_reads_image_under_content() {
        let dir = unique_temp_dir("asset-preview-data-url");
        write_asset_project(
            &dir,
            r#"{"characters":{},"backgrounds":{"sky":"assets/backgrounds/sky.png"},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
            &["assets/backgrounds/sky.png"],
        );

        let data_url = read_asset_preview_data_url(
            dir.to_string_lossy().to_string(),
            "assets/backgrounds/sky.png".to_string(),
        )
        .unwrap();

        assert!(data_url.starts_with("data:image/png;base64,"));
        assert!(data_url.ends_with("ZmFrZQ=="));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_asset_preview_data_url_rejects_path_traversal() {
        let dir = unique_temp_dir("asset-preview-traversal");
        write_asset_project(
            &dir,
            r#"{"characters":{},"backgrounds":{},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
            &[],
        );

        let result = read_asset_preview_data_url(
            dir.to_string_lossy().to_string(),
            "../gal.project.json".to_string(),
        );

        assert!(result.is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    // ── 应用设置（AppSettings）测试 ──

    #[test]
    fn app_settings_defaults_to_dark() {
        let s = AppSettings::default();
        assert_eq!(s.theme, ThemeMode::Dark);
    }

    #[test]
    fn app_settings_serde_roundtrip_preserves_theme() {
        let s = AppSettings {
            theme: ThemeMode::Light,
        };
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains(r#""theme":"light""#));
        // 反序列化回来应一致
        let back: AppSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(back, s);
    }

    #[test]
    fn app_settings_deserialize_missing_theme_uses_default() {
        // 旧版/部分设置文件缺 theme 字段时应回退到默认 dark
        let back: AppSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(back.theme, ThemeMode::Dark);
    }

    #[test]
    fn app_settings_deserialize_unknown_theme_uses_default() {
        let back: AppSettings = serde_json::from_str(r#"{"theme":"solarized"}"#).unwrap();
        assert_eq!(back.theme, ThemeMode::Dark);
    }
}
