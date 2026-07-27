//! Semantic localization and line-voice diagnostics shared by Studio and CLI.

use std::collections::{HashMap, HashSet};

use super::super::model::{GraphIssueSeverity, LocaleEntry, NodeEntry, ProjectGraph, ProjectIssue};

#[derive(Clone)]
struct TextRow {
    chapter_title: String,
    node_id: String,
    node_title: String,
    file: String,
    instruction_index: usize,
    story_point: String,
    text: String,
    text_key: Option<String>,
    kind: String,
    has_voice: bool,
}

pub(crate) fn validate_localization_and_voice(
    meta: &serde_json::Value,
    manifest: &serde_json::Value,
    graph: &ProjectGraph,
    nodes: &[NodeEntry],
    locales: &[LocaleEntry],
) -> Vec<ProjectIssue> {
    let rows = collect_text_rows(graph, nodes);
    let voice_catalog_exists = manifest
        .pointer("/audio/voice")
        .and_then(serde_json::Value::as_object)
        .is_some_and(|catalog| !catalog.is_empty());
    let mut issues = if voice_catalog_exists {
        validate_voice_coverage(&rows)
    } else {
        Vec::new()
    };
    let Some((default_locale, available_locales)) = locale_config(meta) else {
        return issues;
    };

    let tables = locales
        .iter()
        .filter_map(|entry| {
            entry
                .value
                .as_object()
                .map(|table| (entry.locale.as_str(), table))
        })
        .collect::<HashMap<_, _>>();
    let locale_files = locales
        .iter()
        .map(|entry| (entry.locale.as_str(), entry.rel_path.as_str()))
        .collect::<HashMap<_, _>>();
    let assigned_keys = rows
        .iter()
        .filter_map(|row| row.text_key.as_deref())
        .collect::<HashSet<_>>();

    for row in &rows {
        let Some(text_key) = row.text_key.as_deref() else {
            issues.push(row_issue(
                row,
                "locale",
                "locale_missing_text_key",
                format!(
                    "未分配翻译 key：{} / {} / {}；已登记语言将回退到原文。",
                    row.chapter_title, row.node_title, row.story_point
                ),
                format!("$[{}].textKey", row.instruction_index),
            ));
            continue;
        };

        for locale in available_locales
            .iter()
            .filter(|locale| locale.as_str() != default_locale)
        {
            let translated = tables
                .get(locale.as_str())
                .is_some_and(|table| table.contains_key(text_key));
            if !translated {
                issues.push(row_issue(
                    row,
                    "locale",
                    "locale_missing_translation",
                    format!(
                        "语言 {locale} 缺少译文：{} / {} / {} ({text_key})。",
                        row.chapter_title, row.node_title, row.story_point
                    ),
                    format!("$[{}].textKey", row.instruction_index),
                ));
            }
        }

        if let Some(default_text) = tables
            .get(default_locale.as_str())
            .and_then(|table| table.get(text_key))
            .and_then(serde_json::Value::as_str)
        {
            if default_text != row.text {
                issues.push(row_issue(
                    row,
                    "locale",
                    "locale_default_text_drift",
                    format!(
                        "默认语言 {default_locale} 文本与原文不一致：{} / {} / {} ({text_key})。",
                        row.chapter_title, row.node_title, row.story_point
                    ),
                    format!("$[{}].text", row.instruction_index),
                ));
            }
        }
    }

    for locale in available_locales {
        let Some(table) = tables.get(locale.as_str()) else {
            continue;
        };
        let file = locale_files
            .get(locale.as_str())
            .copied()
            .unwrap_or("content/locales");
        let mut orphan_keys = table
            .keys()
            .filter(|key| !assigned_keys.contains(key.as_str()))
            .collect::<Vec<_>>();
        orphan_keys.sort();
        for key in orphan_keys {
            issues.push(ProjectIssue {
                severity: GraphIssueSeverity::Warn,
                source: "locale".to_string(),
                code: "locale_orphan_translation".to_string(),
                message: format!("语言 {locale} 存在未被任何台词或旁白引用的译文：{key}。"),
                file: Some(file.to_string()),
                json_path: Some(format!("$[{}]", serde_json::to_string(key).unwrap())),
                node_id: None,
                edge_id: None,
            });
        }
    }

    issues
}

fn locale_config(meta: &serde_json::Value) -> Option<(String, Vec<String>)> {
    let locale = meta.get("locale")?.as_object()?;
    let default = locale.get("default")?.as_str()?.to_string();
    let available = locale
        .get("available")?
        .as_array()?
        .iter()
        .map(|value| value.as_str().map(str::to_string))
        .collect::<Option<Vec<_>>>()?;
    Some((default, available))
}

fn collect_text_rows(graph: &ProjectGraph, nodes: &[NodeEntry]) -> Vec<TextRow> {
    let chapters = graph
        .chapters
        .iter()
        .map(|chapter| (chapter.id.as_str(), chapter.title.as_str()))
        .collect::<HashMap<_, _>>();
    let data_by_path = nodes
        .iter()
        .filter_map(|entry| {
            entry
                .data
                .as_ref()
                .map(|data| (entry.rel_path.as_str(), data))
        })
        .collect::<HashMap<_, _>>();
    let mut rows = Vec::new();

    for node in &graph.nodes {
        let Some(instructions) = data_by_path
            .get(node.file.as_str())
            .and_then(|data| data.as_array())
        else {
            continue;
        };
        let mut pending_voice = false;
        for (instruction_index, instruction) in instructions.iter().enumerate() {
            let Some(object) = instruction.as_object() else {
                continue;
            };
            let Some(kind) = object.get("t").and_then(serde_json::Value::as_str) else {
                continue;
            };
            if kind == "voice" {
                pending_voice = true;
                continue;
            }
            if kind != "say" && kind != "narrate" {
                continue;
            }
            let Some(text) = object.get("text").and_then(serde_json::Value::as_str) else {
                continue;
            };
            let story_point = object
                .get("id")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| format!("index:{instruction_index}"));
            rows.push(TextRow {
                chapter_title: chapters
                    .get(node.chapter_id.as_str())
                    .copied()
                    .unwrap_or(node.chapter_id.as_str())
                    .to_string(),
                node_id: node.id.clone(),
                node_title: if node.title.is_empty() {
                    node.id.clone()
                } else {
                    node.title.clone()
                },
                file: format!("content/{}", node.file),
                instruction_index,
                story_point,
                text: text.to_string(),
                text_key: object
                    .get("textKey")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string),
                kind: kind.to_string(),
                has_voice: object
                    .get("voice")
                    .and_then(serde_json::Value::as_str)
                    .is_some()
                    || pending_voice,
            });
            pending_voice = false;
        }
    }
    rows
}

fn validate_voice_coverage(rows: &[TextRow]) -> Vec<ProjectIssue> {
    rows.iter()
        .filter(|row| row.kind == "say" && !row.has_voice)
        .map(|row| {
            row_issue(
                row,
                "node",
                "voice_missing_coverage",
                format!(
                    "台词未绑定语音：{} / {} / {}；这不会阻止构建。",
                    row.chapter_title, row.node_title, row.story_point
                ),
                format!("$[{}].voice", row.instruction_index),
            )
        })
        .collect()
}

fn row_issue(
    row: &TextRow,
    source: &str,
    code: &str,
    message: String,
    json_path: String,
) -> ProjectIssue {
    ProjectIssue {
        severity: GraphIssueSeverity::Warn,
        source: source.to_string(),
        code: code.to_string(),
        message,
        file: Some(row.file.clone()),
        json_path: Some(json_path),
        node_id: Some(row.node_id.clone()),
        edge_id: None,
    }
}
