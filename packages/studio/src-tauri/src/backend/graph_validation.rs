#[derive(Clone, Debug)]
struct ChoiceTarget {
    text: String,
    to: String,
    instruction_index: usize,
    choice_index: usize,
    node_file: String,
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
    let mut outgoing_edges: HashMap<String, Vec<(usize, &GraphEdge)>> = HashMap::new();
    let mut edge_pairs: HashSet<(String, String)> = HashSet::new();
    for (index, edge) in graph.edges.iter().enumerate() {
        if !seen_edge_ids.insert(edge.id.clone()) {
            duplicate_edge_ids.insert(edge.id.clone());
        }
        outgoing_edges
            .entry(edge.from.clone())
            .or_default()
            .push((index, edge));
        edge_pairs.insert((edge.from.clone(), edge.to.clone()));

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

    let choice_targets = collect_choice_targets(graph, nodes_data);
    for (node_id, choices) in &choice_targets {
        let expected_targets: HashSet<&str> =
            choices.iter().map(|choice| choice.to.as_str()).collect();
        for choice in choices {
            if !seen_node_ids.contains(&choice.to) {
                issues.push(GraphIssue {
                    severity: GraphIssueSeverity::Error,
                    code: "choice_target_missing_node".to_string(),
                    message: format!("选择项「{}」指向不存在的节点：{}", choice.text, choice.to),
                    file: Some(format!("content/{}", choice.node_file)),
                    json_path: Some(format!(
                        "$[{}].choices[{}].to",
                        choice.instruction_index, choice.choice_index
                    )),
                    node_id: Some(node_id.clone()),
                    edge_id: None,
                });
            } else if !edge_pairs.contains(&(node_id.clone(), choice.to.clone())) {
                issues.push(GraphIssue {
                    severity: GraphIssueSeverity::Warn,
                    code: "choice_missing_graph_edge".to_string(),
                    message: format!(
                        "选择项「{}」指向 {}，但 graph 中缺少 {} -> {} 的边",
                        choice.text, choice.to, node_id, choice.to
                    ),
                    file: Some("content/graph.json".to_string()),
                    json_path: Some("$.edges".to_string()),
                    node_id: Some(node_id.clone()),
                    edge_id: None,
                });
            }
        }

        if let Some(outgoing) = outgoing_edges.get(node_id) {
            for (edge_index, edge) in outgoing {
                if !expected_targets.contains(edge.to.as_str()) {
                    issues.push(GraphIssue {
                        severity: GraphIssueSeverity::Warn,
                        code: "edge_missing_choice".to_string(),
                        message: format!(
                            "choice 节点 {} 有额外 outgoing edge {} -> {}，但没有对应选择项",
                            node_id, edge.from, edge.to
                        ),
                        file: Some("content/graph.json".to_string()),
                        json_path: Some(format!("$.edges[{edge_index}]")),
                        node_id: Some(node_id.clone()),
                        edge_id: Some(edge.id.clone()),
                    });
                }
            }
        }
    }

    for node in &graph.nodes {
        if choice_targets.contains_key(&node.id) {
            continue;
        }
        let outgoing_count = outgoing_edges
            .get(&node.id)
            .map(|edges| edges.len())
            .unwrap_or(0);
        if outgoing_count > 1 {
            issues.push(GraphIssue {
                severity: GraphIssueSeverity::Warn,
                code: "linear_node_multiple_outgoing".to_string(),
                message: format!(
                    "线性节点 {} 有多条 outgoing edges，但节点内没有 choice 指令",
                    node.id
                ),
                file: Some("content/graph.json".to_string()),
                json_path: Some("$.edges".to_string()),
                node_id: Some(node.id.clone()),
                edge_id: None,
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

fn collect_choice_targets(
    graph: &ProjectGraph,
    nodes_data: &[NodeEntry],
) -> HashMap<String, Vec<ChoiceTarget>> {
    let mut result: HashMap<String, Vec<ChoiceTarget>> = HashMap::new();
    for (node_index, node) in graph.nodes.iter().enumerate() {
        let Some(data) = nodes_data
            .get(node_index)
            .and_then(|entry| entry.data.as_ref())
        else {
            continue;
        };
        let Some(instructions) = data.as_array() else {
            continue;
        };
        for (instruction_index, instruction) in instructions.iter().enumerate() {
            if instruction.get("t").and_then(|value| value.as_str()) != Some("choice") {
                continue;
            }
            let Some(choices) = instruction
                .get("choices")
                .and_then(|value| value.as_array())
            else {
                continue;
            };
            for (choice_index, choice) in choices.iter().enumerate() {
                let Some(text) = choice.get("text").and_then(|value| value.as_str()) else {
                    continue;
                };
                let Some(to) = choice.get("to").and_then(|value| value.as_str()) else {
                    continue;
                };
                result
                    .entry(node.id.clone())
                    .or_default()
                    .push(ChoiceTarget {
                        text: text.to_string(),
                        to: to.to_string(),
                        instruction_index,
                        choice_index,
                        node_file: node.file.clone(),
                    });
            }
        }
    }
    result
}

