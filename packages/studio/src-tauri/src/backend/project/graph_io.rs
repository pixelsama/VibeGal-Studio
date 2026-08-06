//! Graph and node-file loading under a validated content root.

/// CLI/full project loading composes the graph index with every node body.
#[allow(dead_code)]
pub fn load_project_graph_data(
    content_root: &ContentRoot,
) -> Result<(ProjectGraph, Vec<NodeEntry>, Vec<GraphIssue>), String> {
    let (graph, graph_issues) = load_project_graph(content_root)?;
    let nodes = load_node_entries(content_root, &graph)?;
    Ok((graph, nodes, graph_issues))
}

/// 只读取 graph.json。Studio 首屏走这个入口，避免 1000 个节点正文阻塞工作台。
pub fn load_project_graph(
    content_root: &ContentRoot,
) -> Result<(ProjectGraph, Vec<GraphIssue>), String> {
    let graph_path = content_root.resolve("graph.json")?;
    if !graph_path.is_file() {
        return Ok((empty_project_graph(), vec![missing_graph_issue()]));
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
        return Ok((empty_project_graph(), issues));
    }

    let mut graph_projection = graph_raw.clone();
    contracts::apply_schema_defaults(
        &mut graph_projection,
        contracts::schema(contracts::ContractSchemaKind::Graph),
    );
    Ok((project_graph_from_valid_json(&graph_projection)?, vec![]))
}

pub(crate) fn load_node_entries(
    content_root: &ContentRoot,
    graph: &ProjectGraph,
) -> Result<Vec<NodeEntry>, String> {
    let mut entries = Vec::with_capacity(graph.nodes.len());
    for node in &graph.nodes {
        let node_path = content_root.resolve(&node.file)?;
        let data = if node_path.exists() {
            Some(read_json(&node_path)?)
        } else {
            log::warn!("节点 {} 的文件 {} 不存在，已跳过", node.id, node.file);
            None
        };
        entries.push(NodeEntry {
            rel_path: node.file.clone(),
            data,
        });
    }
    Ok(entries)
}

fn empty_project_graph() -> ProjectGraph {
    ProjectGraph {
        version: 1,
        entry_node_id: String::new(),
        chapters: vec![GraphChapter {
            id: "chapter_1".to_string(),
            title: "第一章".to_string(),
            checkpoint: None,
        }],
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
    graph_raw: &serde_json::Value,
) -> Result<ProjectGraph, String> {
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

    let chapters = graph_raw
        .get("chapters")
        .and_then(serde_json::Value::as_array)
        .map(|chapters| {
            chapters
                .iter()
                .map(|chapter| GraphChapter {
                    id: chapter["id"]
                        .as_str()
                        .expect("validated graph chapter id")
                        .to_string(),
                    title: chapter["title"]
                        .as_str()
                        .expect("validated graph chapter title")
                        .to_string(),
                    checkpoint: chapter.get("checkpoint").cloned(),
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

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
                        chapter_id: node["chapterId"]
                            .as_str()
                            .expect("validated graph node chapterId")
                            .to_string(),
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
                    condition: edge
                        .get("condition")
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_string),
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(ProjectGraph {
        version,
        entry_node_id,
        chapters,
        nodes: graph_nodes,
        edges: graph_edges,
    })
}
use super::super::contracts;
use super::super::fs::{read_json, ContentRoot};
use super::super::model::{
    GraphChapter, GraphEdge, GraphIssue, GraphIssueSeverity, GraphNode, GraphPosition, NodeEntry,
    ProjectGraph,
};
