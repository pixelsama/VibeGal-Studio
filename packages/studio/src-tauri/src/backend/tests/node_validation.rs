use super::support::*;

#[test]
fn validate_node_contents_flags_non_array_node() {
    let graph = one_node_graph();
    let nodes = vec![node_entry("nodes/start.json", serde_json::json!({}))];

    let issues = validate_node_contents(&graph, &nodes, &manifest_with_refs());

    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].source, "node");
    assert_eq!(issues[0].code, "node_not_array");
    assert_eq!(issues[0].severity, GraphIssueSeverity::Error);
    assert_eq!(issues[0].file.as_deref(), Some("content/nodes/start.json"));
    assert_eq!(issues[0].json_path.as_deref(), Some("$"));
    assert_eq!(issues[0].node_id.as_deref(), Some("start"));
}

#[test]
fn validate_node_contents_flags_unknown_instruction_type() {
    let graph = one_node_graph();
    let nodes = vec![node_entry(
        "nodes/start.json",
        serde_json::json!([{ "t": "teleport", "id": "x" }]),
    )];

    let issues = validate_node_contents(&graph, &nodes, &manifest_with_refs());

    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].code, "instruction_unknown_type");
    assert_eq!(issues[0].json_path.as_deref(), Some("$[0].t"));
    assert_eq!(issues[0].node_id.as_deref(), Some("start"));
}

#[test]
fn validate_node_contents_rejects_choice_instruction() {
    let graph = one_node_graph();
    let nodes = vec![node_entry(
        "nodes/start.json",
        serde_json::json!([
            {
                "t": "choice",
                "choices": [{ "text": "留下", "to": "stay" }]
            }
        ]),
    )];

    let issues = validate_node_contents(&graph, &nodes, &manifest_with_refs());

    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].code, "choice_instruction_not_supported");
    assert_eq!(issues[0].severity, GraphIssueSeverity::Error);
    assert_eq!(issues[0].file.as_deref(), Some("content/nodes/start.json"));
    assert_eq!(issues[0].json_path.as_deref(), Some("$[0].t"));
    assert_eq!(issues[0].node_id.as_deref(), Some("start"));
}

#[test]
fn validate_node_contents_accepts_pause_instruction() {
    let graph = one_node_graph();
    let nodes = vec![node_entry(
        "nodes/start.json",
        serde_json::json!([
            { "t": "bg", "id": "school" },
            { "t": "pause", "id": "pause_01" },
            { "t": "narrate", "id": "narrate_01", "text": "继续。" }
        ]),
    )];

    let issues = validate_node_contents(&graph, &nodes, &manifest_with_refs());

    assert!(
        issues.is_empty(),
        "pause 应被视为合法剧情帧停点: {issues:?}"
    );
}

#[test]
fn validate_node_contents_accepts_set_instruction() {
    let graph = one_node_graph();
    let nodes = vec![node_entry(
        "nodes/start.json",
        serde_json::json!([
            { "t": "set", "key": "affection", "value": 3 },
            { "t": "set", "key": "has_key", "value": true },
            { "t": "set", "key": "route", "value": "stay" },
            { "t": "set", "key": "unused", "value": null }
        ]),
    )];

    let issues = validate_node_contents(&graph, &nodes, &manifest_with_refs());

    assert!(issues.is_empty(), "set 应支持自动条件路由变量: {issues:?}");
}

#[test]
fn validate_node_contents_accepts_runtime_media_instructions() {
    let graph = one_node_graph();
    let nodes = vec![node_entry(
        "nodes/start.json",
        serde_json::json!([
            { "t": "showCg", "id": "cg_rooftop_asset" },
            { "t": "playVideo", "id": "opening", "skippable": false }
        ]),
    )];

    let issues = validate_node_contents(&graph, &nodes, &manifest_with_refs());

    assert!(
        issues.is_empty(),
        "媒体指令应与 engine schema 保持一致: {issues:?}"
    );
}

#[test]
fn validate_node_contents_flags_missing_runtime_media_refs() {
    let graph = one_node_graph();
    let nodes = vec![node_entry(
        "nodes/start.json",
        serde_json::json!([
            { "t": "showCg", "id": "missing_cg" },
            { "t": "playVideo", "id": "missing_video" }
        ]),
    )];

    let issues = validate_node_contents(&graph, &nodes, &manifest_with_refs());

    assert_eq!(
        issues
            .iter()
            .map(|issue| issue.code.as_str())
            .collect::<Vec<_>>(),
        vec!["missing_cg_ref", "missing_video_ref"]
    );
}

#[test]
fn validate_node_contents_matches_shared_contract_fixture() {
    let fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../contracts/fixtures/node-semantic-contract.json");
    let fixture: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(fixture_path).unwrap()).unwrap();
    let graph = one_node_graph();
    let nodes = vec![node_entry(
        "nodes/start.json",
        fixture["instructions"].clone(),
    )];

    let issues = validate_node_contents(&graph, &nodes, &fixture["manifest"]);
    let mut actual = issues
        .iter()
        .map(|issue| {
            serde_json::json!({
                "code": issue.code,
                "severity": match issue.severity {
                    GraphIssueSeverity::Error => "error",
                    GraphIssueSeverity::Warn => "warn",
                },
                "source": issue.source,
                "jsonPath": issue.json_path,
            })
        })
        .collect::<Vec<_>>();
    actual.sort_by_key(|issue| format!("{}\0{}", issue["jsonPath"], issue["code"]));
    let mut expected = fixture["expectedIssues"].as_array().unwrap().clone();
    expected.sort_by_key(|issue| format!("{}\0{}", issue["jsonPath"], issue["code"]));

    assert_eq!(actual, expected);
}

#[test]
fn validate_node_contents_flags_invalid_set_value() {
    let graph = one_node_graph();
    let nodes = vec![node_entry(
        "nodes/start.json",
        serde_json::json!([{ "t": "set", "key": "route", "value": { "bad": true } }]),
    )];

    let issues = validate_node_contents(&graph, &nodes, &manifest_with_refs());

    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].code, "instruction_invalid_field");
    assert_eq!(issues[0].json_path.as_deref(), Some("$[0].value"));
}

#[test]
fn validate_node_contents_flags_missing_required_field() {
    let graph = one_node_graph();
    let nodes = vec![node_entry(
        "nodes/start.json",
        serde_json::json!([{ "t": "say", "who": "hero" }]),
    )];

    let issues = validate_node_contents(&graph, &nodes, &manifest_with_refs());

    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].code, "instruction_invalid_field");
    assert_eq!(issues[0].json_path.as_deref(), Some("$[0].text"));
}

#[test]
fn validate_node_contents_flags_invalid_enum() {
    let graph = one_node_graph();
    let nodes = vec![node_entry(
        "nodes/start.json",
        serde_json::json!([{ "t": "bg", "id": "school", "trans": "spin" }]),
    )];

    let issues = validate_node_contents(&graph, &nodes, &manifest_with_refs());

    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].code, "instruction_invalid_field");
    assert_eq!(issues[0].json_path.as_deref(), Some("$[0].trans"));
}

#[test]
fn validate_node_contents_flags_missing_background_ref() {
    let graph = one_node_graph();
    let nodes = vec![node_entry(
        "nodes/start.json",
        serde_json::json!([{ "t": "bg", "id": "ghost_bg" }]),
    )];

    let issues = validate_node_contents(&graph, &nodes, &manifest_with_refs());

    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].code, "missing_background_ref");
    assert_eq!(issues[0].json_path.as_deref(), Some("$[0].id"));
}

#[test]
fn validate_node_contents_flags_missing_character_expr() {
    let graph = one_node_graph();
    let nodes = vec![node_entry(
        "nodes/start.json",
        serde_json::json!([{ "t": "say", "id": "say_01", "who": "hero", "expr": "angry", "text": "Hi" }]),
    )];

    let issues = validate_node_contents(&graph, &nodes, &manifest_with_refs());

    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].code, "missing_character_expr");
    assert_eq!(issues[0].json_path.as_deref(), Some("$[0].expr"));
}

#[test]
fn validate_node_contents_flags_missing_unlock_ref() {
    let graph = one_node_graph();
    let nodes = vec![node_entry(
        "nodes/start.json",
        serde_json::json!([{ "t": "unlock", "kind": "cg", "id": "missing_unlock" }]),
    )];

    let issues = validate_node_contents(&graph, &nodes, &manifest_with_refs());

    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].code, "missing_unlock_ref");
    assert_eq!(issues[0].json_path.as_deref(), Some("$[0].id"));
}

#[test]
fn validate_node_contents_warns_when_story_point_id_is_missing() {
    let graph = one_node_graph();
    let nodes = vec![node_entry(
        "nodes/start.json",
        serde_json::json!([{ "t": "narrate", "text": "缺少稳定 id" }]),
    )];

    let issues = validate_node_contents(&graph, &nodes, &manifest_with_refs());

    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].code, "instruction_id_missing");
    assert_eq!(issues[0].severity, GraphIssueSeverity::Warn);
    assert_eq!(issues[0].json_path.as_deref(), Some("$[0].id"));
}

#[test]
fn validate_node_contents_rejects_duplicate_story_point_ids() {
    let graph = one_node_graph();
    let nodes = vec![node_entry(
        "nodes/start.json",
        serde_json::json!([
            { "t": "say", "id": "line_01", "who": "hero", "text": "第一句" },
            { "t": "pause", "id": "line_01" }
        ]),
    )];

    let issues = validate_node_contents(&graph, &nodes, &manifest_with_refs());

    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].code, "instruction_id_duplicate");
    assert_eq!(issues[0].severity, GraphIssueSeverity::Error);
    assert_eq!(issues[0].json_path.as_deref(), Some("$[1].id"));
}

#[test]
fn validate_node_contents_skips_missing_node_file() {
    let graph = one_node_graph();
    let nodes = vec![NodeEntry {
        rel_path: "nodes/start.json".to_string(),
        data: None,
    }];

    let issues = validate_node_contents(&graph, &nodes, &manifest_with_refs());

    assert!(issues.is_empty());
}

#[test]
fn validate_node_contents_skips_reference_checks_when_manifest_is_invalid() {
    let graph = one_node_graph();
    let nodes = vec![node_entry(
        "nodes/start.json",
        serde_json::json!([{ "t": "bg", "id": "ghost_bg" }]),
    )];
    let manifest = serde_json::json!({ "characters": {}, "backgrounds": {}, "audio": { "bgm_main": "x.mp3" } });

    let issues = validate_node_contents(&graph, &nodes, &manifest);

    assert!(
        issues.is_empty(),
        "manifest 非法时不应制造引用二次问题: {issues:?}"
    );
}
