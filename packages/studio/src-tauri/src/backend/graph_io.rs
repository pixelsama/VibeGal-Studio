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
                mode: edge_mode_field(edge_raw),
                label: optional_graph_string_field(edge_raw, "label"),
                condition: optional_graph_string_field(edge_raw, "condition"),
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

fn optional_graph_string_field(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|field_value| field_value.as_str())
        .map(|text| text.to_string())
}

fn edge_mode_field(value: &serde_json::Value) -> String {
    match value.get("mode") {
        None => "linear".to_string(),
        Some(serde_json::Value::String(mode)) => mode.to_string(),
        Some(_) => "__invalid__".to_string(),
    }
}
