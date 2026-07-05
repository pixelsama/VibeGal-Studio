/// 校验 manifest 的结构合法性。与 engine ManifestSchema 的 .strict() 等价。
/// 重点检查 audio 必须是含 bgm/sfx/voice 三子表的对象，
/// 旧 flat audio（audio: { bgm_main: ... }）会被检为 manifest_invalid_audio。
pub fn validate_manifest_structure(manifest: &serde_json::Value) -> Vec<ProjectIssue> {
    let mut issues = vec![];
    let obj = match manifest.as_object() {
        Some(o) => o,
        None => {
            issues.push(ProjectIssue {
                severity: GraphIssueSeverity::Error,
                source: "manifest".to_string(),
                code: "manifest_not_object".to_string(),
                message: "manifest.json 不是一个 JSON 对象".to_string(),
                file: Some("content/manifest.json".to_string()),
                json_path: Some("$".to_string()),
                node_id: None,
                edge_id: None,
            });
            return issues;
        }
    };

    // audio 必须存在且是含 bgm/sfx/voice 三子表的对象
    let audio = match obj.get("audio") {
        Some(a) => a,
        None => {
            issues.push(ProjectIssue {
                severity: GraphIssueSeverity::Error,
                source: "manifest".to_string(),
                code: "manifest_missing_audio".to_string(),
                message: "manifest 缺少 audio 字段".to_string(),
                file: Some("content/manifest.json".to_string()),
                json_path: Some("$.audio".to_string()),
                node_id: None,
                edge_id: None,
            });
            return issues;
        }
    };

    let audio_obj = match audio.as_object() {
        Some(o) => o,
        None => {
            issues.push(ProjectIssue {
                severity: GraphIssueSeverity::Error,
                source: "manifest".to_string(),
                code: "manifest_invalid_audio".to_string(),
                message: "manifest.audio 不是对象".to_string(),
                file: Some("content/manifest.json".to_string()),
                json_path: Some("$.audio".to_string()),
                node_id: None,
                edge_id: None,
            });
            return issues;
        }
    };

    // 三张子表必须存在
    for sub in ["bgm", "sfx", "voice"] {
        if !audio_obj.contains_key(sub) {
            issues.push(ProjectIssue {
                severity: GraphIssueSeverity::Error,
                source: "manifest".to_string(),
                code: "manifest_invalid_audio".to_string(),
                message: format!("manifest.audio 缺少 {sub} 子表"),
                file: Some("content/manifest.json".to_string()),
                json_path: Some(format!("$.audio.{sub}")),
                node_id: None,
                edge_id: None,
            });
        }
    }

    // 未知 key（旧 flat audio 的 id 会落在这里，如 audio.bgm_main）
    let known: std::collections::HashSet<&str> = ["bgm", "sfx", "voice"].iter().copied().collect();
    let mut unknown: Vec<&String> = audio_obj
        .keys()
        .filter(|k| !known.contains(k.as_str()))
        .collect();
    unknown.sort();
    if !unknown.is_empty() {
        issues.push(ProjectIssue {
            severity: GraphIssueSeverity::Error,
            source: "manifest".to_string(),
            code: "manifest_invalid_audio".to_string(),
            message: format!(
                "manifest.audio 含未知字段（可能是旧 flat 格式）：{}",
                unknown
                    .iter()
                    .map(|k| k.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            file: Some("content/manifest.json".to_string()),
            json_path: Some("$.audio".to_string()),
            node_id: None,
            edge_id: None,
        });
    }

    issues
}

// ──────────────────────────────────────────────
// meta 结构校验（对应 engine MetaSchema 的输入侧约束）
// ──────────────────────────────────────────────

pub fn validate_meta_structure(meta: &serde_json::Value) -> Vec<ProjectIssue> {
    let mut issues = vec![];
    let obj = match meta.as_object() {
        Some(obj) => obj,
        None => {
            issues.push(meta_issue(
                "meta_not_object",
                "meta.json 不是一个 JSON 对象",
                "$",
            ));
            return issues;
        }
    };

    if let Some(title) = obj.get("title") {
        if !title.is_string() {
            issues.push(meta_issue(
                "meta_invalid_title",
                "meta.title 必须是字符串",
                "$.title",
            ));
        }
    }

    if let Some(typing_speed) = obj.get("typingSpeedCps") {
        if !typing_speed.as_f64().is_some_and(|value| value > 0.0) {
            issues.push(meta_issue(
                "meta_invalid_timing",
                "meta.typingSpeedCps 必须是正数",
                "$.typingSpeedCps",
            ));
        }
    }

    validate_optional_nonnegative_int(obj, "autoAdvanceMs", "$.autoAdvanceMs", &mut issues);
    validate_optional_nonnegative_int(obj, "chapterGapMs", "$.chapterGapMs", &mut issues);

    if let Some(stage) = obj.get("stage") {
        let Some(stage_obj) = stage.as_object() else {
            issues.push(meta_issue(
                "meta_invalid_stage",
                "meta.stage 必须是对象",
                "$.stage",
            ));
            return issues;
        };

        validate_optional_int_range(stage_obj, "width", "$.stage.width", 320, 7680, &mut issues);
        validate_optional_int_range(
            stage_obj,
            "height",
            "$.stage.height",
            180,
            4320,
            &mut issues,
        );
    }

    issues
}

fn meta_issue(code: &str, message: &str, json_path: &str) -> ProjectIssue {
    ProjectIssue {
        severity: GraphIssueSeverity::Error,
        source: "meta".to_string(),
        code: code.to_string(),
        message: message.to_string(),
        file: Some("content/meta.json".to_string()),
        json_path: Some(json_path.to_string()),
        node_id: None,
        edge_id: None,
    }
}

fn validate_optional_nonnegative_int(
    obj: &serde_json::Map<String, serde_json::Value>,
    key: &str,
    json_path: &str,
    issues: &mut Vec<ProjectIssue>,
) {
    if let Some(value) = obj.get(key) {
        if json_int(value).is_none_or(|number| number < 0) {
            issues.push(meta_issue(
                "meta_invalid_timing",
                &format!("meta.{key} 必须是非负整数"),
                json_path,
            ));
        }
    }
}

fn validate_optional_int_range(
    obj: &serde_json::Map<String, serde_json::Value>,
    key: &str,
    json_path: &str,
    min: i64,
    max: i64,
    issues: &mut Vec<ProjectIssue>,
) {
    if let Some(value) = obj.get(key) {
        if json_int(value).is_none_or(|number| number < min || number > max) {
            issues.push(meta_issue(
                "meta_invalid_stage",
                &format!("meta.stage.{key} 必须是 {min} 到 {max} 之间的整数"),
                json_path,
            ));
        }
    }
}

fn json_int(value: &serde_json::Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|number| i64::try_from(number).ok()))
}

/// 把 GraphIssue 映射成 ProjectIssue（补 source 字段，保留 nodeId/edgeId 供 UI 定位）。
fn graph_issue_to_project(issue: &GraphIssue, source: &str) -> ProjectIssue {
    ProjectIssue {
        severity: issue.severity.clone(),
        source: source.to_string(),
        code: issue.code.clone(),
        message: issue.message.clone(),
        file: issue.file.clone(),
        json_path: issue.json_path.clone(),
        node_id: issue.node_id.clone(),
        edge_id: issue.edge_id.clone(),
    }
}
