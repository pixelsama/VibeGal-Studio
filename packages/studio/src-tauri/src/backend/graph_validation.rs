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
    let mut outgoing_edges: HashMap<String, Vec<(usize, &GraphEdge)>> = HashMap::new();
    for (index, edge) in graph.edges.iter().enumerate() {
        if !seen_edge_ids.insert(edge.id.clone()) {
            duplicate_edge_ids.insert(edge.id.clone());
        }
        outgoing_edges
            .entry(edge.from.clone())
            .or_default()
            .push((index, edge));

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

        if !matches!(edge.mode.as_str(), "linear" | "choice" | "auto") {
            issues.push(GraphIssue {
                severity: GraphIssueSeverity::Error,
                code: "edge_invalid_mode".to_string(),
                message: format!("边 {} 的 mode 必须是 linear、choice 或 auto", edge.id),
                file: Some("content/graph.json".to_string()),
                json_path: Some(format!("$.edges[{index}].mode")),
                node_id: None,
                edge_id: Some(edge.id.clone()),
            });
        }
        if edge.mode == "choice"
            && edge
                .label
                .as_deref()
                .map(|label| label.trim().is_empty())
                .unwrap_or(true)
        {
            issues.push(GraphIssue {
                severity: GraphIssueSeverity::Error,
                code: "choice_edge_missing_label".to_string(),
                message: format!("玩家选择边 {} 需要非空 label", edge.id),
                file: Some("content/graph.json".to_string()),
                json_path: Some(format!("$.edges[{index}].label")),
                node_id: Some(edge.from.clone()),
                edge_id: Some(edge.id.clone()),
            });
        }
    }

    for (node_id, outgoing) in &outgoing_edges {
        let modes = outgoing
            .iter()
            .map(|(_, edge)| edge.mode.as_str())
            .collect::<HashSet<_>>();
        if modes.len() > 1 {
            issues.push(GraphIssue {
                severity: GraphIssueSeverity::Error,
                code: "mixed_outgoing_modes".to_string(),
                message: format!("节点 {} 的出口不能混用 linear、choice 和 auto", node_id),
                file: Some("content/graph.json".to_string()),
                json_path: Some("$.edges".to_string()),
                node_id: Some(node_id.clone()),
                edge_id: None,
            });
            continue;
        }

        let mode = outgoing
            .first()
            .map(|(_, edge)| edge.mode.as_str())
            .unwrap_or("linear");
        if mode == "linear" && outgoing.len() > 1 {
            issues.push(GraphIssue {
                severity: GraphIssueSeverity::Error,
                code: "linear_node_multiple_outgoing".to_string(),
                message: format!("线性节点 {} 最多只能有一条 outgoing edge", node_id),
                file: Some("content/graph.json".to_string()),
                json_path: Some("$.edges".to_string()),
                node_id: Some(node_id.clone()),
                edge_id: None,
            });
        }
        if mode == "choice" {
            let mut labels = HashSet::new();
            for (edge_index, edge) in outgoing {
                let label = edge.label.as_deref().unwrap_or("").trim();
                if !label.is_empty() && !labels.insert(label.to_string()) {
                    issues.push(GraphIssue {
                        severity: GraphIssueSeverity::Warn,
                        code: "duplicate_choice_label".to_string(),
                        message: format!("节点 {} 有重复选项文本：{}", node_id, label),
                        file: Some("content/graph.json".to_string()),
                        json_path: Some(format!("$.edges[{edge_index}].label")),
                        node_id: Some(node_id.clone()),
                        edge_id: Some(edge.id.clone()),
                    });
                }
            }
        }
        if mode == "auto" {
            let default_edges = outgoing
                .iter()
                .filter(|(_, edge)| {
                    edge.condition
                        .as_deref()
                        .map(|condition| condition.trim().is_empty())
                        .unwrap_or(true)
                })
                .count();
            if default_edges > 1 {
                issues.push(GraphIssue {
                    severity: GraphIssueSeverity::Error,
                    code: "auto_multiple_default_edges".to_string(),
                    message: format!("节点 {} 的自动出口最多只能有一条默认边", node_id),
                    file: Some("content/graph.json".to_string()),
                    json_path: Some("$.edges".to_string()),
                    node_id: Some(node_id.clone()),
                    edge_id: None,
                });
            } else if outgoing.len() > 1 && default_edges == 0 {
                issues.push(GraphIssue {
                    severity: GraphIssueSeverity::Warn,
                    code: "auto_missing_default_edge".to_string(),
                    message: format!("节点 {} 的自动出口没有默认边，可能无路可走", node_id),
                    file: Some("content/graph.json".to_string()),
                    json_path: Some("$.edges".to_string()),
                    node_id: Some(node_id.clone()),
                    edge_id: None,
                });
            }
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
