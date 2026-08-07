use super::support::*;

#[test]
fn validate_graph_flags_dangling_edge() {
    let mut graph = valid_project_graph();
    graph.edges = vec![graph_edge("prologue__missing", "prologue", "missing")];
    let entries = present_node_entries(&graph);

    let issues = validate_graph(&graph, &entries);

    let issue = issues
        .iter()
        .find(|issue| issue.code == "dangling_edge")
        .expect("dangling edge should be reported");
    assert_eq!(issue.severity, GraphIssueSeverity::Warn);
    assert_eq!(issue.edge_id.as_deref(), Some("prologue__missing"));
    assert_eq!(issue.file.as_deref(), Some("content/graph.json"));
    assert_eq!(issue.json_path.as_deref(), Some("$.edges[0]"));
    assert!(issue.message.contains("missing"));
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
fn validate_graph_flags_duplicate_chapter_ids() {
    let mut graph = valid_project_graph();
    graph.chapters = vec![
        GraphChapter {
            id: "opening".to_string(),
            title: "序章".to_string(),
            checkpoint: None,
        },
        GraphChapter {
            id: "opening".to_string(),
            title: "重复".to_string(),
            checkpoint: None,
        },
    ];

    let issues = validate_graph(&graph, &present_node_entries(&graph));

    let issue = issues
        .iter()
        .find(|issue| issue.code == "duplicate_chapter_id")
        .expect("duplicate chapter id should be reported");
    assert_eq!(issue.severity, GraphIssueSeverity::Error);
    assert_eq!(issue.json_path.as_deref(), Some("$.chapters"));
}

#[test]
fn validate_graph_flags_missing_node_chapter_reference() {
    let mut graph = valid_project_graph();
    graph.nodes[0].chapter_id = "missing".to_string();

    let issues = validate_graph(&graph, &present_node_entries(&graph));

    let issue = issues
        .iter()
        .find(|issue| issue.code == "missing_chapter_ref")
        .expect("missing chapter reference should be reported");
    assert_eq!(issue.severity, GraphIssueSeverity::Error);
    assert_eq!(issue.node_id.as_deref(), Some("prologue"));
    assert_eq!(issue.json_path.as_deref(), Some("$.nodes[0].chapterId"));
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

    let issue = issues
        .iter()
        .find(|issue| issue.code == "duplicate_edge_id")
        .expect("duplicate edge id should be reported");
    assert_eq!(issue.severity, GraphIssueSeverity::Warn);
    assert_eq!(issue.edge_id.as_deref(), Some("prologue__ending"));
}

// Spec 35：choice/mode 相关的旧规则已移除（choice_edge_missing_label、
// mixed_outgoing_modes、duplicate_choice_label、linear_node_multiple_outgoing）。
// 路由规则简化为「多条出口至多一条兜底边 + 兜底边须在最后 + condition 语法」。

#[test]
fn validate_graph_flags_auto_multiple_default_edges() {
    let mut graph = choice_branch_graph();
    graph.edges = vec![
        auto_edge("start__stay", "start", "stay", None),
        auto_edge("start__leave", "start", "leave", Some("")),
    ];
    let nodes = present_node_entries(&graph);

    let issues = validate_graph(&graph, &nodes);

    let issue = issues
        .iter()
        .find(|issue| issue.code == "auto_multiple_default_edges")
        .expect("multiple fallback edges should be reported");
    assert_eq!(issue.severity, GraphIssueSeverity::Error);
    assert_eq!(issue.node_id.as_deref(), Some("start"));
}

#[test]
fn validate_graph_warns_auto_without_default_edge() {
    let mut graph = choice_branch_graph();
    graph.edges = vec![
        auto_edge("start__stay", "start", "stay", Some("affection >= 3")),
        auto_edge("start__leave", "start", "leave", Some("affection < 3")),
    ];
    let nodes = present_node_entries(&graph);

    let issues = validate_graph(&graph, &nodes);

    let issue = issues
        .iter()
        .find(|issue| issue.code == "auto_missing_default_edge")
        .expect("multi-exit route without fallback should be reported");
    assert_eq!(issue.severity, GraphIssueSeverity::Warn);
    assert_eq!(issue.node_id.as_deref(), Some("start"));
}

#[test]
fn validate_graph_rejects_invalid_condition_but_accepts_default_before_condition() {
    let mut graph = choice_branch_graph();
    graph.edges = vec![
        auto_edge("fallback", "start", "stay", None),
        auto_edge("bad", "start", "leave", Some("affection >")),
    ];
    let issues = validate_graph(&graph, &present_node_entries(&graph));
    assert!(issues
        .iter()
        .any(|issue| issue.code == "invalid_edge_condition"
            && issue.edge_id.as_deref() == Some("bad")));
    assert!(!issues
        .iter()
        .any(|issue| issue.code == "auto_default_edge_not_last"));
}

#[test]
fn route_analysis_finds_unreachable_nodes() {
    let graph = ProjectGraph {
        version: 1,
        entry_node_id: "start".to_string(),
        chapters: vec![],
        nodes: vec![
            graph_node("start", "nodes/start.json"),
            graph_node("ending", "nodes/ending.json"),
            graph_node("orphan", "nodes/orphan.json"),
        ],
        edges: vec![graph_edge("start__ending", "start", "ending")],
    };

    let issues = validate_graph(&graph, &present_node_entries(&graph));

    let issue = issues
        .iter()
        .find(|issue| issue.code == "unreachable_node")
        .expect("unreachable node should be reported");
    assert_eq!(issue.severity, GraphIssueSeverity::Warn);
    assert_eq!(issue.node_id.as_deref(), Some("orphan"));
    assert_eq!(issue.file.as_deref(), Some("content/graph.json"));
}

#[test]
fn route_analysis_follows_choice_option_targets() {
    let mut graph = choice_branch_graph();
    graph.edges.clear();
    let nodes = vec![
        NodeEntry {
            rel_path: "nodes/start.json".to_string(),
            data: Some(
                serde_json::json!([{ "t": "choice", "options": [{ "text": "去", "to": "stay" }] }]),
            ),
        },
        NodeEntry {
            rel_path: "nodes/stay.json".to_string(),
            data: Some(serde_json::json!([])),
        },
        NodeEntry {
            rel_path: "nodes/leave.json".to_string(),
            data: Some(serde_json::json!([])),
        },
    ];

    let issues = validate_graph(&graph, &nodes);

    assert!(!issues
        .iter()
        .any(|issue| issue.code == "unreachable_node" && issue.node_id.as_deref() == Some("stay")));
    assert!(
        issues
            .iter()
            .any(|issue| issue.code == "unreachable_node"
                && issue.node_id.as_deref() == Some("leave"))
    );
}

#[test]
fn route_analysis_finds_dead_ends() {
    let graph = cyclic_graph_without_ending();

    let issues = validate_graph(&graph, &present_node_entries(&graph));

    let issue = issues
        .iter()
        .find(|issue| issue.code == "dead_end_route")
        .expect("cycle without ending should be a dead-end route");
    assert_eq!(issue.severity, GraphIssueSeverity::Warn);
    assert_eq!(issue.node_id.as_deref(), Some("start"));
}

#[test]
fn route_analysis_warns_on_cycles() {
    let graph = cyclic_graph_without_ending();

    let issues = validate_graph(&graph, &present_node_entries(&graph));

    let issue = issues
        .iter()
        .find(|issue| issue.code == "cycle_warning")
        .expect("cycle should be reported");
    assert_eq!(issue.severity, GraphIssueSeverity::Warn);
    assert!(matches!(
        issue.node_id.as_deref(),
        Some("loop_a") | Some("loop_b")
    ));
}

#[test]
fn validate_graph_clean_graph_has_no_issues() {
    let graph = valid_project_graph();
    let entries = present_node_entries(&graph);

    let issues = validate_graph(&graph, &entries);

    assert!(issues.is_empty());
}
