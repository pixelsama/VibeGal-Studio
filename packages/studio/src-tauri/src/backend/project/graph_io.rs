//! Graph and node-file loading under a validated content root.

pub fn load_project_graph_data(
    content_root: &ContentRoot,
) -> Result<(ProjectGraph, Vec<NodeEntry>, Vec<GraphIssue>), String> {
    let graph_path = content_root.resolve("graph.json")?;
    if !graph_path.is_file() {
        return Ok((empty_project_graph(), vec![], vec![missing_graph_issue()]));
    }

    // A syntactically valid but contract-invalid graph is a project issue, not an
    // unreadable-project error. Keep Studio/CLI usable with a safe empty view.
    let graph_raw = content_root.read_control_json("graph.json")?;
    let violations = contracts::validate_schema(contracts::ContractSchemaKind::Graph, &graph_raw);
    if !violations.is_empty() {
        let issues = violations
            .into_iter()
            .map(|violation| GraphIssue {
                severity: violation.severity,
                code: violation.code,
                message: violation.message,
                file: Some("content/graph.json".to_string()),
                json_path: Some(violation.json_path),
                node_id: None,
                edge_id: None,
            })
            .collect();
        return Ok((empty_project_graph(), vec![], issues));
    }

    let mut graph_projection = graph_raw.clone();
    contracts::apply_schema_defaults(
        &mut graph_projection,
        contracts::schema(contracts::ContractSchemaKind::Graph),
    );
    let (graph, nodes) = project_graph_from_valid_json(content_root, &graph_projection)?;
    Ok((graph, nodes, vec![]))
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
        message: "缺少 content/graph.json：VibeGal-Studio 项目必须以脚本图作为剧本入口。"
            .to_string(),
        file: Some("content/graph.json".to_string()),
        json_path: Some("$".to_string()),
        node_id: None,
        edge_id: None,
    }
}

pub(crate) fn legacy_chapter_layout_issues(
    content_root: &ContentRoot,
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

    if content_root.path().join("chapters").exists() {
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

fn project_graph_from_valid_json(
    content_root: &ContentRoot,
    graph_raw: &serde_json::Value,
) -> Result<(ProjectGraph, Vec<NodeEntry>), String> {
    // The embedded schema has validated structure and populated projection defaults.
    let version = graph_raw
        .get("version")
        .and_then(serde_json::Value::as_u64)
        .expect("graph projection has defaulted version") as u32;
    let entry_node_id = graph_raw
        .get("entryNodeId")
        .and_then(serde_json::Value::as_str)
        .expect("validated graph requires entryNodeId")
        .to_string();

    let graph_nodes = graph_raw
        .get("nodes")
        .and_then(serde_json::Value::as_array)
        .map(|nodes| {
            nodes
                .iter()
                .map(|node| {
                    let id = node["id"].as_str().expect("validated graph node id");
                    let position = &node["position"];
                    GraphNode {
                        id: id.to_string(),
                        title: node
                            .get("title")
                            .and_then(serde_json::Value::as_str)
                            .unwrap_or(id)
                            .to_string(),
                        file: node["file"]
                            .as_str()
                            .expect("validated graph node file")
                            .to_string(),
                        position: GraphPosition {
                            x: position
                                .get("x")
                                .and_then(serde_json::Value::as_f64)
                                .expect("graph projection has defaulted position.x"),
                            y: position
                                .get("y")
                                .and_then(serde_json::Value::as_f64)
                                .expect("graph projection has defaulted position.y"),
                        },
                    }
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let graph_edges = graph_raw
        .get("edges")
        .and_then(serde_json::Value::as_array)
        .map(|edges| {
            edges
                .iter()
                .map(|edge| GraphEdge {
                    id: edge["id"]
                        .as_str()
                        .expect("validated graph edge id")
                        .to_string(),
                    from: edge["from"]
                        .as_str()
                        .expect("validated graph edge from")
                        .to_string(),
                    to: edge["to"]
                        .as_str()
                        .expect("validated graph edge to")
                        .to_string(),
                    mode: edge
                        .get("mode")
                        .and_then(serde_json::Value::as_str)
                        .expect("graph projection has defaulted edge mode")
                        .to_string(),
                    label: edge
                        .get("label")
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_string),
                    condition: edge
                        .get("condition")
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_string),
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let mut node_entries = vec![];
    for node in &graph_nodes {
        let node_path = content_root.resolve(&node.file)?;
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
use super::super::contracts;
use super::super::fs::{read_json, ContentRoot};
use super::super::model::{
    GraphEdge, GraphIssue, GraphIssueSeverity, GraphNode, GraphPosition, NodeEntry, ProjectGraph,
};
