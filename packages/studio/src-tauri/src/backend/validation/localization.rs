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
    variables: &serde_json::Value,
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
    issues.extend(validate_runtime_text(manifest, variables, graph, nodes));
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

fn validate_runtime_text(
    manifest: &serde_json::Value,
    variables: &serde_json::Value,
    graph: &ProjectGraph,
    nodes: &[NodeEntry],
) -> Vec<ProjectIssue> {
    let data_by_path = nodes
        .iter()
        .filter_map(|entry| {
            entry
                .data
                .as_ref()
                .map(|data| (entry.rel_path.as_str(), data))
        })
        .collect::<HashMap<_, _>>();
    let mut issues = Vec::new();
    let declarations = variables
        .get("variables")
        .and_then(serde_json::Value::as_object);
    let labels = declarations
        .into_iter()
        .flat_map(|items| items.iter())
        .filter_map(|(id, declaration)| {
            declaration
                .get("label")
                .and_then(serde_json::Value::as_str)
                .map(|label| (label.to_string(), id.to_string()))
        })
        .fold(
            HashMap::<String, Vec<String>>::new(),
            |mut labels, (label, id)| {
                labels.entry(label).or_default().push(id);
                labels
            },
        );
    let theme_colors = manifest
        .get("uiSkins")
        .and_then(serde_json::Value::as_object)
        .and_then(|skins| skins.get("default").or_else(|| skins.values().next()))
        .and_then(|skin| skin.get("tokens"))
        .and_then(serde_json::Value::as_object);

    for node in &graph.nodes {
        let Some(instructions) = data_by_path
            .get(node.file.as_str())
            .and_then(|data| data.as_array())
        else {
            continue;
        };
        for (instruction_index, instruction) in instructions.iter().enumerate() {
            let Some(text) = instruction
                .as_object()
                .filter(|object| {
                    matches!(
                        object.get("t").and_then(serde_json::Value::as_str),
                        Some("say" | "narrate")
                    )
                })
                .and_then(|object| object.get("text"))
                .and_then(serde_json::Value::as_str)
            else {
                continue;
            };
            for (code, message, offset) in
                scan_runtime_text(text, declarations, &labels, theme_colors)
            {
                issues.push(ProjectIssue {
                    severity: GraphIssueSeverity::Warn,
                    source: "node".to_string(),
                    code: code.to_string(),
                    message: format!("{message}（文本偏移 {offset}）"),
                    file: Some(format!("content/{}", node.file)),
                    json_path: Some(format!("$[{instruction_index}].text")),
                    node_id: Some(node.id.clone()),
                    edge_id: None,
                });
            }
        }
    }
    issues
}

const RUNTIME_TEXT_MAX_DEPTH: usize = 8;
const RUNTIME_TEXT_MAX_TOKENS: usize = 512;

type RuntimeTextIssue = (&'static str, String, usize);

#[derive(Clone, Copy, PartialEq, Eq)]
enum RuntimeTextTag {
    Bold,
    Color,
    Ruby,
}

fn scan_runtime_text(
    text: &str,
    declarations: Option<&serde_json::Map<String, serde_json::Value>>,
    labels: &HashMap<String, Vec<String>>,
    theme_colors: Option<&serde_json::Map<String, serde_json::Value>>,
) -> Vec<RuntimeTextIssue> {
    let mut issues = Vec::new();
    scan_placeholders(text, declarations, labels, &mut issues);
    scan_markup(text, theme_colors, &mut issues);
    issues.sort_by_key(|(_, _, offset)| *offset);
    issues
}

fn scan_placeholders(
    text: &str,
    declarations: Option<&serde_json::Map<String, serde_json::Value>>,
    labels: &HashMap<String, Vec<String>>,
    issues: &mut Vec<RuntimeTextIssue>,
) {
    let mut index = 0;
    while index < text.len() {
        let Some(relative) = text[index..].find('{') else {
            break;
        };
        index += relative;
        if text[index..].starts_with("{{") {
            index += 2;
            continue;
        }
        let Some(relative_close) = text[index + 1..].find('}') else {
            issues.push((
                "text_unclosed_placeholder",
                "变量占位符缺少右花括号，运行时将按原文显示。".to_string(),
                index,
            ));
            index += 1;
            continue;
        };
        let end = index + 1 + relative_close;
        let name = &text[index + 1..end];
        if name.is_empty() || name.trim() != name || name.contains('{') {
            issues.push((
                "text_invalid_placeholder",
                "变量占位符不是安全的故事状态名称，运行时将按原文显示。".to_string(),
                index,
            ));
        } else {
            let direct = declarations.is_some_and(|items| items.contains_key(name));
            let matches = labels.get(name).map(Vec::as_slice).unwrap_or(&[]);
            if !direct && matches.len() > 1 {
                issues.push((
                    "text_ambiguous_variable_label",
                    format!("故事状态显示名“{name}”对应多个状态，请改用稳定 ID。"),
                    index,
                ));
            } else if !direct && matches.len() != 1 {
                issues.push((
                    "text_unknown_variable",
                    format!("找不到故事状态“{name}”，运行时将保留原占位符。"),
                    index,
                ));
            }
        }
        index = end + 1;
    }
}

fn scan_markup(
    text: &str,
    theme_colors: Option<&serde_json::Map<String, serde_json::Value>>,
    issues: &mut Vec<RuntimeTextIssue>,
) {
    let mut stack = Vec::<RuntimeTextTag>::new();
    let mut index = 0;
    let mut token_count = 0;
    let mut limit_reported = false;
    while index < text.len() {
        let Some(relative) = text[index..].find('[') else {
            break;
        };
        index += relative;
        let Some(relative_close) = text[index + 1..].find(']') else {
            issues.push((
                "text_unclosed_markup",
                "行内标记缺少右方括号，运行时将按原文显示。".to_string(),
                index,
            ));
            index += 1;
            continue;
        };
        let end = index + 1 + relative_close;
        let literal = &text[index..=end];
        let body = &text[index + 1..end];
        token_count += 1;
        if token_count > RUNTIME_TEXT_MAX_TOKENS && !limit_reported {
            issues.push((
                "text_markup_limit",
                format!(
                    "行内标记片段不能超过 {RUNTIME_TEXT_MAX_TOKENS} 个，超出部分将按普通文本显示。"
                ),
                index,
            ));
            limit_reported = true;
        }

        let opening = if body == "b" {
            Some(RuntimeTextTag::Bold)
        } else if body.starts_with("color=") {
            Some(RuntimeTextTag::Color)
        } else if body.starts_with("ruby=") {
            Some(RuntimeTextTag::Ruby)
        } else {
            None
        };
        if let Some(tag) = opening {
            let closing = match tag {
                RuntimeTextTag::Bold => "[/b]",
                RuntimeTextTag::Color => "[/color]",
                RuntimeTextTag::Ruby => "[/ruby]",
            };
            if !text[end + 1..].contains(closing) {
                issues.push((
                    "text_unclosed_markup",
                    format!("行内标记 {literal} 缺少 {closing}，运行时将按原文显示。"),
                    index,
                ));
            } else if stack.len() >= RUNTIME_TEXT_MAX_DEPTH {
                issues.push((
                    "text_markup_limit",
                    format!("行内标记嵌套不能超过 {RUNTIME_TEXT_MAX_DEPTH} 层，运行时将按普通文本显示。"),
                    index,
                ));
            } else if validate_markup_value(body, theme_colors, index, issues) {
                stack.push(tag);
            }
            index = end + 1;
            continue;
        }

        let closing = match body {
            "/b" => Some(RuntimeTextTag::Bold),
            "/color" => Some(RuntimeTextTag::Color),
            "/ruby" => Some(RuntimeTextTag::Ruby),
            _ => None,
        };
        if let Some(tag) = closing {
            if stack.last() == Some(&tag) {
                stack.pop();
            } else {
                issues.push((
                    "text_mismatched_markup",
                    format!("行内结束标记 {literal} 没有匹配的开始标记，运行时将按原文显示。"),
                    index,
                ));
            }
        } else if body.starts_with("pause=") {
            validate_markup_value(body, theme_colors, index, issues);
        } else {
            issues.push((
                "text_unknown_markup",
                format!("不支持行内标记 {literal}，运行时将按原文显示。"),
                index,
            ));
        }
        index = end + 1;
    }
}

fn validate_markup_value(
    body: &str,
    theme_colors: Option<&serde_json::Map<String, serde_json::Value>>,
    offset: usize,
    issues: &mut Vec<RuntimeTextIssue>,
) -> bool {
    if let Some(raw) = body.strip_prefix("pause=") {
        if raw.is_empty()
            || !raw.bytes().all(|byte| byte.is_ascii_digit())
            || raw.parse::<u64>().ok().is_none_or(|value| value > 60_000)
        {
            issues.push((
                "text_invalid_markup_value",
                "行内停顿必须是 0–60000 毫秒。".to_string(),
                offset,
            ));
            return false;
        }
    } else if let Some(color) = body.strip_prefix("color=") {
        let safe_hex = color.len() == 7
            && color.starts_with('#')
            && color[1..].chars().all(|value| value.is_ascii_hexdigit());
        let safe_theme_color = theme_colors
            .and_then(|tokens| tokens.get(color))
            .and_then(serde_json::Value::as_str)
            .is_some_and(|value| {
                value.len() == 7
                    && value.starts_with('#')
                    && value[1..]
                        .chars()
                        .all(|character| character.is_ascii_hexdigit())
            });
        if !safe_hex && !safe_theme_color {
            issues.push((
                "text_invalid_markup_value",
                "颜色必须是安全 hex 或已登记且解析为安全 hex 的主题色。".to_string(),
                offset,
            ));
            return false;
        }
    } else if let Some(ruby) = body.strip_prefix("ruby=") {
        if ruby.is_empty() || ruby.len() > 100 || ruby.contains('[') {
            issues.push((
                "text_invalid_markup_value",
                "ruby 读音必须是 1–100 个普通字符。".to_string(),
                offset,
            ));
            return false;
        }
    }
    true
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
