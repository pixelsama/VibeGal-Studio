//! Project discovery and aggregate loading.

pub fn read_project_meta(project_path: &Path) -> Result<ProjectMeta, String> {
    let project_root = ProjectRoot::open(project_path)?;
    let value = project_root.read_project_json()?;
    serde_json::from_value::<ProjectMeta>(value)
        .map_err(|e| format!("解析 gal.project.json 失败: {}", e))
}

/// 列出工作区目录下的所有项目（含 gal.project.json 的直接子目录）
pub(crate) fn list_projects(workspace_dir: String) -> Result<Vec<ProjectListItem>, String> {
    let root = Path::new(&workspace_dir);
    if !root.is_dir() {
        return Ok(vec![]);
    }
    let workspace_root = root
        .canonicalize()
        .map_err(|e| format!("无法定位工作区目录 {}: {}", root.display(), e))?;
    let mut items = vec![];
    let entries = fs::read_dir(&workspace_root).map_err(|e| format!("读取目录失败: {}", e))?;
    for entry_result in entries {
        let Ok(entry) = entry_result else {
            continue;
        };
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() || !file_type.is_dir() {
            continue;
        }
        let path = entry.path();
        let Ok(project_root) = ProjectRoot::open(&path) else {
            continue;
        };
        if project_root.path().parent() != Some(workspace_root.as_path()) {
            continue;
        }
        let Ok(value) = project_root.read_project_json() else {
            continue;
        };
        let Ok(meta) = serde_json::from_value::<ProjectMeta>(value) else {
            continue;
        };
        items.push(ProjectListItem {
            path: project_root.path().to_string_lossy().into_owned(),
            meta,
        });
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

/// 供 CLI 直接调用的项目打开入口，可跨 crate 调用。
pub(crate) fn open_project_for_cli(path: &str) -> Result<ProjectData, String> {
    open_project_inner(path)
}

pub(crate) fn open_project_inner(path: &str) -> Result<ProjectData, String> {
    let project_root = ProjectRoot::open(Path::new(path))?;
    let project_path = project_root.path();
    let meta = serde_json::from_value::<ProjectMeta>(project_root.read_project_json()?)
        .map_err(|e| format!("解析 gal.project.json 失败: {}", e))?;

    let content_root = project_root.content_root()?;
    let manifest = content_root.read_control_json("manifest.json")?;
    let meta_json = content_root.read_control_json("meta.json")?;

    let renderer_ids = list_renderer_ids(project_path);
    let project_revision = project_root.revision("gal.project.json")?;
    let (graph, nodes, mut graph_issues) = load_project_graph_data(&content_root)?;
    let graph_revision = project_root.revision("content/graph.json")?;
    let manifest_revision = project_root.revision("content/manifest.json")?;
    let meta_revision = project_root.revision("content/meta.json")?;
    let mut node_revisions = HashMap::new();
    for node in &nodes {
        node_revisions.insert(
            node.rel_path.clone(),
            project_root.revision(&format!("content/{}", node.rel_path))?,
        );
    }
    graph_issues.extend(legacy_chapter_layout_issues(&content_root, &meta_json));
    graph_issues.extend(validate_graph(&graph, &nodes));
    let graph_report = GraphReport { graph_issues };
    let asset_issues = match super::list_asset_entries(&content_root) {
        Ok(entries) => validate_assets(&entries, &manifest),
        Err(message) => vec![super::super::model::GraphIssue {
            severity: GraphIssueSeverity::Error,
            code: "unsafe_asset_path".to_string(),
            message,
            file: Some("content/assets".to_string()),
            json_path: None,
            node_id: None,
            edge_id: None,
        }],
    };
    let asset_report = AssetReport { asset_issues };

    // 全局聚合：图结构 + 节点内容 + 资产 + manifest 结构问题汇总成一个报告
    let node_issues = validate_node_contents(&graph, &nodes, &manifest);
    let manifest_issues = validate_manifest_structure(&manifest);
    let meta_issues = validate_meta_structure(&meta_json);
    let mut project_issues: Vec<ProjectIssue> = vec![];
    project_issues.extend(
        graph_report
            .graph_issues
            .iter()
            .map(|i| graph_issue_to_project(i, "graph")),
    );
    project_issues.extend(node_issues);
    project_issues.extend(
        asset_report
            .asset_issues
            .iter()
            .map(|i| graph_issue_to_project(i, "asset")),
    );
    project_issues.extend(manifest_issues);
    project_issues.extend(meta_issues);
    project_issues.sort_by(|a, b| {
        (
            project_issue_source_order(&a.source),
            a.severity != GraphIssueSeverity::Error,
            a.file.as_deref().unwrap_or(""),
            a.json_path.as_deref().unwrap_or(""),
        )
            .cmp(&(
                project_issue_source_order(&b.source),
                b.severity != GraphIssueSeverity::Error,
                b.file.as_deref().unwrap_or(""),
                b.json_path.as_deref().unwrap_or(""),
            ))
    });
    let project_report = ProjectReport { project_issues };

    Ok(ProjectData {
        path: project_path.to_string_lossy().into_owned(),
        meta,
        content: ProjectContent {
            manifest,
            meta: meta_json,
        },
        renderer_ids,
        project_revision,
        graph: Some(graph),
        nodes: Some(nodes),
        graph_revision,
        manifest_revision,
        meta_revision,
        node_revisions: Some(node_revisions),
        graph_report: Some(graph_report),
        asset_report: Some(asset_report),
        project_report: Some(project_report),
    })
}

fn project_issue_source_order(source: &str) -> u8 {
    match source {
        "graph" => 0,
        "node" => 1,
        "asset" => 2,
        "meta" => 3,
        "manifest" => 4,
        _ => 5,
    }
}
use super::super::fs::ProjectRoot;
use super::super::model::{
    AssetReport, GraphIssueSeverity, GraphReport, ProjectContent, ProjectData, ProjectIssue,
    ProjectListItem, ProjectMeta, ProjectReport,
};
use super::super::validation::{
    graph_issue_to_project, validate_assets, validate_graph, validate_manifest_structure,
    validate_meta_structure, validate_node_contents,
};
use super::{legacy_chapter_layout_issues, load_project_graph_data};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
