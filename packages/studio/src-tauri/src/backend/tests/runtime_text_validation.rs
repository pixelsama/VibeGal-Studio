use std::collections::HashSet;

use super::support::*;

#[test]
fn validate_runtime_text_reports_safe_markup_diagnostics_at_story_location() {
    let graph = one_node_graph();
    let nodes = vec![node_entry(
        "nodes/start.json",
        serde_json::json!([
            {
                "t": "narrate",
                "id": "line_01",
                "text": "你好，{playerName。[pause=oops][script]"
            },
            {
                "t": "narrate",
                "id": "line_02",
                "text": "[pause=oops][script]"
            }
        ]),
    )];

    let issues = validate_localization_and_voice(
        &serde_json::json!({}),
        &serde_json::json!({ "audio": { "voice": {} } }),
        &serde_json::json!({ "version": 1, "variables": {} }),
        &graph,
        &nodes,
        &[],
    );
    let codes = issues
        .iter()
        .map(|issue| issue.code.as_str())
        .collect::<Vec<_>>();

    assert!(codes.contains(&"text_unclosed_placeholder"));
    assert!(codes.contains(&"text_invalid_markup_value"));
    assert!(codes.contains(&"text_unknown_markup"));
    assert!(issues.iter().all(|issue| {
        issue.file.as_deref() == Some("content/nodes/start.json")
            && matches!(issue.json_path.as_deref(), Some("$[0].text" | "$[1].text"))
            && issue.node_id.as_deref() == Some("start")
    }));
}

#[test]
fn validate_runtime_text_accepts_safe_interpolation_and_markup() {
    let graph = one_node_graph();
    let nodes = vec![node_entry(
        "nodes/start.json",
        serde_json::json!([
            {
                "t": "say",
                "id": "line_01",
                "who": "hero",
                "text": "你好，{playerName}。[b]欢迎[/b][pause=250][color=#12abEF]回来[/color][ruby=せかい]世界[/ruby]"
            }
        ]),
    )];

    let issues = validate_localization_and_voice(
        &serde_json::json!({}),
        &serde_json::json!({ "audio": { "voice": {} } }),
        &serde_json::json!({
            "version": 1,
            "variables": {
                "playerName": {
                    "kind": "text",
                    "type": "string",
                    "scope": "run",
                    "default": "旅行者"
                }
            }
        }),
        &graph,
        &nodes,
        &[],
    );

    assert!(issues.is_empty(), "安全文本不应产生诊断: {issues:?}");
}

#[test]
fn validate_runtime_text_matches_runtime_safety_boundaries() {
    let graph = one_node_graph();
    let too_deep = format!("{}正文{}", "[b]".repeat(9), "[/b]".repeat(9));
    let too_many_tokens = format!("{}正文", "[pause=0]".repeat(513));
    let nodes = vec![node_entry(
        "nodes/start.json",
        serde_json::json!([
            {
                "t": "narrate",
                "id": "line_01",
                "text": "{缺失状态} / {同名状态} [b][color=#112233]错位[/b][/color] [ruby=][/ruby] [color=missing.token]主题色[/color]"
            },
            { "t": "narrate", "id": "line_02", "text": too_deep },
            { "t": "narrate", "id": "line_03", "text": too_many_tokens }
        ]),
    )];
    let variables = serde_json::json!({
        "version": 1,
        "variables": {
            "first": { "type": "string", "scope": "run", "default": "甲", "label": "同名状态" },
            "second": { "type": "string", "scope": "run", "default": "乙", "label": "同名状态" }
        }
    });

    let issues = validate_localization_and_voice(
        &serde_json::json!({}),
        &serde_json::json!({ "audio": { "voice": {} } }),
        &variables,
        &graph,
        &nodes,
        &[],
    );
    let codes = issues
        .iter()
        .map(|issue| issue.code.as_str())
        .collect::<HashSet<_>>();

    assert!(codes.contains("text_unknown_variable"));
    assert!(codes.contains("text_ambiguous_variable_label"));
    assert!(codes.contains("text_mismatched_markup"));
    assert!(codes.contains("text_invalid_markup_value"));
    assert!(codes.contains("text_markup_limit"));
}

#[test]
fn validate_runtime_text_accepts_registered_safe_theme_color() {
    let graph = one_node_graph();
    let nodes = vec![node_entry(
        "nodes/start.json",
        serde_json::json!([{
            "t": "narrate",
            "id": "line_01",
            "text": "[color=dialogueBox.textColor]正文[/color]"
        }]),
    )];

    let issues = validate_localization_and_voice(
        &serde_json::json!({}),
        &serde_json::json!({
            "audio": { "voice": {} },
            "uiSkins": {
                "default": {
                    "tokens": { "dialogueBox.textColor": "#123abc" }
                }
            }
        }),
        &serde_json::json!({ "version": 1, "variables": {} }),
        &graph,
        &nodes,
        &[],
    );

    assert!(issues.is_empty(), "安全主题色不应产生诊断: {issues:?}");
}
