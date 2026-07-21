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

/// 读取 content/fixtures/*.json（按文件名排序）。
/// 目录缺失 = 空列表（不算问题）；单文件解析失败或不是对象时降级为
/// warn 级 fixture_invalid 项目问题并跳过该文件，不阻塞项目打开。
fn load_project_fixtures(content_root: &ContentRoot) -> (Vec<FixtureEntry>, Vec<ProjectIssue>) {
    let fixtures_dir = content_root.path().join("fixtures");
    if !fixtures_dir.is_dir() {
        return (vec![], vec![]);
    }
    let mut files: Vec<PathBuf> = match fs::read_dir(&fixtures_dir) {
        Ok(entries) => entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| {
                path.is_file() && path.extension().and_then(|ext| ext.to_str()) == Some("json")
            })
            .collect(),
        Err(error) => {
            return (
                vec![],
                vec![fixture_invalid_issue(
                    "content/fixtures",
                    &format!("读取 fixtures 目录失败: {}", error),
                )],
            );
        }
    };
    files.sort();

    let mut fixtures = vec![];
    let mut issues = vec![];
    for path in files {
        let file_name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        let rel_path = format!("content/fixtures/{}", file_name);
        match read_json(&path) {
            Ok(value) if value.is_object() => {
                let title = value
                    .get("title")
                    .and_then(|title| title.as_str())
                    .map(|title| title.to_string());
                fixtures.push(FixtureEntry {
                    path: rel_path,
                    title,
                    value,
                });
            }
            Ok(_) => issues.push(fixture_invalid_issue(&rel_path, "fixture 必须是 JSON 对象")),
            Err(message) => issues.push(fixture_invalid_issue(&rel_path, &message)),
        }
    }
    (fixtures, issues)
}

fn fixture_invalid_issue(file: &str, message: &str) -> ProjectIssue {
    ProjectIssue {
        severity: GraphIssueSeverity::Warn,
        source: "fixture".to_string(),
        code: "fixture_invalid".to_string(),
        message: message.to_string(),
        file: Some(file.to_string()),
        json_path: None,
        node_id: None,
        edge_id: None,
    }
}

pub(crate) fn open_project_inner(path: &str) -> Result<ProjectData, String> {
    let project_root = ProjectRoot::open(Path::new(path))?;
    let project_path = project_root.path();
    let meta = serde_json::from_value::<ProjectMeta>(project_root.read_project_json()?)
        .map_err(|e| format!("解析 gal.project.json 失败: {}", e))?;

    let content_root = project_root.content_root()?;
    let manifest = content_root.read_control_json("manifest.json")?;
    let meta_json = content_root.read_control_json("meta.json")?;
    let variables_path = content_root.path().join("variables.json");
    let variables = if variables_path.is_file() {
        content_root.read_control_json("variables.json")?
    } else {
        serde_json::json!({ "version": 1, "variables": {} })
    };

    let renderer_ids = list_renderer_ids(project_path);
    let project_revision = project_root.revision("gal.project.json")?;
    let (graph, nodes, mut graph_issues) = load_project_graph_data(&content_root)?;
    let graph_revision = project_root.revision("content/graph.json")?;
    let manifest_revision = project_root.revision("content/manifest.json")?;
    let meta_revision = project_root.revision("content/meta.json")?;
    let variables_revision = project_root.revision("content/variables.json")?;
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
    let (fixtures, fixture_issues) = load_project_fixtures(&content_root);

    // 全局聚合：图结构 + 节点内容 + 资产 + manifest 结构问题汇总成一个报告
    let node_issues = validate_node_contents_with_variables(&graph, &nodes, &manifest, &variables);
    let manifest_issues = validate_manifest_structure(&manifest);
    let meta_issues = validate_meta_structure(&meta_json);
    let variable_issues = contracts::validate_schema(contracts::ContractSchemaKind::Variables, &variables)
        .into_iter().map(|issue| ProjectIssue {
            severity: issue.severity, source: "variables".to_string(), code: issue.code,
            message: issue.message, file: Some("content/variables.json".to_string()),
            json_path: Some(issue.json_path), node_id: None, edge_id: None,
        });
    let manifest_node_issues = validate_manifest_node_references(&manifest, &graph);
    let completion_issues = validate_ending_completions(&manifest, &nodes);
    let condition_variable_issues = validate_condition_variables(&variables, &graph, &nodes);
    // 单 skin 收敛（Spec 19 §4.4）：多套 uiSkins 只提示不迁移
    let ui_skin_issues = validate_ui_skin_convergence(&manifest);
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
    project_issues.extend(variable_issues);
    project_issues.extend(manifest_node_issues);
    project_issues.extend(completion_issues);
    project_issues.extend(condition_variable_issues);
    project_issues.extend(ui_skin_issues);
    project_issues.extend(fixture_issues);
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
            variables,
        },
        renderer_ids,
        project_revision,
        graph: Some(graph),
        nodes: Some(nodes),
        graph_revision,
        manifest_revision,
        variables_revision,
        meta_revision,
        node_revisions: Some(node_revisions),
        fixtures: Some(fixtures),
        graph_report: Some(graph_report),
        asset_report: Some(asset_report),
        project_report: Some(project_report),
    })
}

fn validate_manifest_node_references(manifest: &serde_json::Value, graph: &super::super::model::ProjectGraph) -> Vec<ProjectIssue> {
    let nodes = graph.nodes.iter().map(|node| node.id.as_str()).collect::<std::collections::HashSet<_>>();
    let outgoing = graph.edges.iter().map(|edge| edge.from.as_str()).collect::<std::collections::HashSet<_>>();
    let mut issues = vec![];
    for (registry, missing_code) in [("replay", "missing_replay_node_ref"), ("endings", "missing_ending_node_ref")] {
        let Some(entries) = manifest.pointer(&format!("/unlocks/{registry}")).and_then(serde_json::Value::as_object) else { continue };
        for (id, entry) in entries {
            let Some(node_id) = entry.get("nodeId").and_then(serde_json::Value::as_str) else { continue };
            if !nodes.contains(node_id) {
                issues.push(ProjectIssue { severity: GraphIssueSeverity::Error, source: "manifest".to_string(), code: missing_code.to_string(), message: format!("{registry} {id} 引用了不存在的节点 {node_id}"), file: Some("content/manifest.json".to_string()), json_path: Some(format!("$.unlocks.{registry}.{id}.nodeId")), node_id: Some(node_id.to_string()), edge_id: None });
            } else if registry == "endings" && outgoing.contains(node_id) {
                issues.push(ProjectIssue { severity: GraphIssueSeverity::Warn, source: "manifest".to_string(), code: "ending_node_has_outgoing".to_string(), message: format!("结局 {id} 关联的节点仍有出口"), file: Some("content/manifest.json".to_string()), json_path: Some(format!("$.unlocks.endings.{id}.nodeId")), node_id: Some(node_id.to_string()), edge_id: None });
            }
        }
    }
    issues
}

fn validate_ending_completions(manifest: &serde_json::Value, nodes: &[super::super::model::NodeEntry]) -> Vec<ProjectIssue> {
    let registered = manifest.pointer("/unlocks/endings").and_then(serde_json::Value::as_object);
    let mut completion_ids = std::collections::HashSet::new();
    for entry in nodes {
        for instruction in entry.data.as_ref().and_then(serde_json::Value::as_array).into_iter().flatten() {
            if instruction.get("t").and_then(serde_json::Value::as_str) != Some("completeEnding") { continue; }
            let ending_id = instruction.get("endingId").and_then(serde_json::Value::as_str).unwrap_or("");
            completion_ids.insert(ending_id.to_string());
        }
    }
    registered.into_iter().flatten().filter(|(id, _)| !completion_ids.contains(*id)).map(|(id, _)| ProjectIssue { severity: GraphIssueSeverity::Warn, source: "manifest".to_string(), code: "missing_ending_completion".to_string(), message: format!("正式结局 {id} 没有 completeEnding 结算点"), file: Some("content/manifest.json".to_string()), json_path: Some(format!("$.unlocks.endings.{id}")), node_id: None, edge_id: None }).collect()
}

fn validate_condition_variables(
    variables: &serde_json::Value,
    graph: &super::super::model::ProjectGraph,
    nodes: &[super::super::model::NodeEntry],
) -> Vec<ProjectIssue> {
    let declared = variables.get("variables").and_then(serde_json::Value::as_object);
    let write_sites = nodes.iter()
        .flat_map(|entry| entry.data.as_ref().and_then(serde_json::Value::as_array).into_iter().flatten())
        .filter(|instruction| instruction.get("t").and_then(serde_json::Value::as_str) == Some("set"))
        .filter_map(|instruction| instruction.get("key").and_then(serde_json::Value::as_str))
        .collect::<std::collections::HashSet<_>>();
    let mut issues = vec![];
    for (index, edge) in graph.edges.iter().enumerate() {
        if edge.mode != "auto" { continue; }
        let Some(condition) = edge.condition.as_deref().filter(|value| !value.trim().is_empty()) else { continue };
        let Ok(reads) = parse_expression(condition) else { continue };
        for name in reads {
            if name.starts_with("system.")
                || declared.is_some_and(|items| items.contains_key(&name))
                || write_sites.contains(name.as_str())
            { continue; }
            issues.push(ProjectIssue {
                severity: GraphIssueSeverity::Warn,
                source: "variables".to_string(),
                code: "undeclared_variable".to_string(),
                message: format!("条件读取了未声明且没有写入点的变量 {name}"),
                file: Some("content/graph.json".to_string()),
                json_path: Some(format!("$.edges[{index}].condition")),
                node_id: Some(edge.from.clone()),
                edge_id: Some(edge.id.clone()),
            });
        }
    }
    issues
}

fn project_issue_source_order(source: &str) -> u8 {
    match source {
        "graph" => 0,
        "node" => 1,
        "asset" => 2,
        "meta" => 3,
        "manifest" => 4,
        "fixture" => 5,
        _ => 6,
    }
}
use super::super::contracts;
use super::super::fs::{read_json, ContentRoot, ProjectRoot};
use super::super::model::{
    AssetReport, FixtureEntry, GraphIssueSeverity, GraphReport, ProjectContent, ProjectData,
    ProjectIssue, ProjectListItem, ProjectMeta, ProjectReport,
};
use super::super::validation::{
    graph_issue_to_project, validate_assets, validate_graph, validate_manifest_structure,
    parse_expression, validate_meta_structure, validate_node_contents_with_variables,
    validate_ui_skin_convergence,
};
use super::{legacy_chapter_layout_issues, load_project_graph_data};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
