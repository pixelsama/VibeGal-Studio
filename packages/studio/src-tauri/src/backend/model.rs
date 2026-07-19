//! Stable backend DTOs shared by the CLI facade and domain services.

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

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileRevision {
    #[serde(rename = "relPath")]
    pub rel_path: String,
    #[serde(rename = "mtimeMs")]
    pub mtime_ms: f64,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AssetKind {
    Background,
    Character,
    Bgm,
    Sfx,
    Voice,
    Cg,
    Video,
    Font,
    Ui,
    Animation,
    Unknown,
}

impl AssetKind {
    pub(crate) fn from_rel_path(rel: &str) -> Self {
        let lower = rel.replace('\\', "/");
        if lower.starts_with("assets/backgrounds/") {
            Self::Background
        } else if lower.starts_with("assets/characters/") {
            Self::Character
        } else if lower.starts_with("assets/audio/bgm/") {
            Self::Bgm
        } else if lower.starts_with("assets/audio/sfx/") {
            Self::Sfx
        } else if lower.starts_with("assets/audio/voice/") {
            Self::Voice
        } else if lower.starts_with("assets/cg/") {
            Self::Cg
        } else if lower.starts_with("assets/videos/") {
            Self::Video
        } else if lower.starts_with("assets/fonts/") {
            Self::Font
        } else if lower.starts_with("assets/ui/") {
            Self::Ui
        } else if lower.starts_with("assets/atlases/") || lower.starts_with("assets/animations/") {
            Self::Animation
        } else {
            Self::Unknown
        }
    }

    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::Background => "background",
            Self::Character => "character",
            Self::Bgm => "bgm",
            Self::Sfx => "sfx",
            Self::Voice => "voice",
            Self::Cg => "cg",
            Self::Video => "video",
            Self::Font => "font",
            Self::Ui => "ui",
            Self::Animation => "animation",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Serialize, Clone)]
pub struct AssetEntry {
    #[serde(rename = "relPath")]
    pub rel_path: String,
    pub size: u64,
    pub kind: AssetKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision: Option<FileRevision>,
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
    pub mode: String,
    pub label: Option<String>,
    pub condition: Option<String>,
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

/// content/fixtures/*.json 的一个自定义场景 fixture（Spec 17 步骤 5）。
/// loader 只保证单文件「是 JSON 对象」并提取 title；完整结构校验由
/// fixture.schema.json（外部 Agent 自校验）与 snapshot worker 的形状归一化承担。
#[derive(Serialize, Clone)]
pub struct FixtureEntry {
    /// 相对项目根的路径，如 "content/fixtures/dawn-reunion.json"
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// 文件原始 JSON（对象），未经 schema 投影
    pub value: serde_json::Value,
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
pub struct GraphPositionInput {
    pub x: f64,
    pub y: f64,
}

#[derive(Deserialize)]
pub struct GraphPositionPatchInput {
    pub id: String,
    pub position: GraphPositionInput,
}

#[derive(Serialize, Clone)]
pub struct ProjectData {
    pub path: String,
    pub meta: ProjectMeta,
    pub content: ProjectContent,
    #[serde(rename = "rendererIds")]
    pub renderer_ids: Vec<String>,
    #[serde(rename = "projectRevision", skip_serializing_if = "Option::is_none")]
    pub project_revision: Option<FileRevision>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub graph: Option<ProjectGraph>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nodes: Option<Vec<NodeEntry>>,
    #[serde(rename = "graphRevision", skip_serializing_if = "Option::is_none")]
    pub graph_revision: Option<FileRevision>,
    #[serde(rename = "manifestRevision", skip_serializing_if = "Option::is_none")]
    pub manifest_revision: Option<FileRevision>,
    #[serde(rename = "metaRevision", skip_serializing_if = "Option::is_none")]
    pub meta_revision: Option<FileRevision>,
    #[serde(rename = "nodeRevisions", skip_serializing_if = "Option::is_none")]
    pub node_revisions: Option<HashMap<String, Option<FileRevision>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fixtures: Option<Vec<FixtureEntry>>,
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
    System,
    Dark,
    Light,
}

impl Default for ThemeMode {
    fn default() -> Self {
        ThemeMode::System
    }
}

impl<'de> Deserialize<'de> for ThemeMode {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let raw = String::deserialize(deserializer)?;
        Ok(match raw.as_str() {
            "system" => ThemeMode::System,
            "light" => ThemeMode::Light,
            "dark" => ThemeMode::Dark,
            _ => ThemeMode::System,
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
#[serde(rename_all = "camelCase")]
pub struct CliToolStatus {
    pub command: String,
    pub cli_path: String,
    pub link_path: String,
    pub installed: bool,
    pub cli_available: bool,
    pub link_occupied: bool,
    pub in_path: bool,
    pub issue: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct ProjectChangedPayload {
    #[serde(rename = "projectPath")]
    pub project_path: String,
    #[serde(rename = "rendererChanged")]
    pub renderer_changed: bool,
}

impl ProjectChangedPayload {
    pub(crate) fn new(project_path: String, renderer_changed: bool) -> Self {
        Self {
            project_path,
            renderer_changed,
        }
    }

    pub(crate) fn merge(&mut self, other: ProjectChangedPayload) {
        self.renderer_changed |= other.renderer_changed;
    }
}
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
