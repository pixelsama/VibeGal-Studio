//! Node instruction semantic validation driven by embedded contract metadata.

// Node-file validation: contracts own structure, embedded metadata owns policy.

#[cfg(test)]
pub(crate) fn validate_node_contents(
    graph: &ProjectGraph,
    nodes: &[NodeEntry],
    manifest: &serde_json::Value,
) -> Vec<ProjectIssue> {
    validate_node_contents_internal(graph, nodes, manifest, None)
}

pub(crate) fn validate_node_contents_with_variables(
    graph: &ProjectGraph,
    nodes: &[NodeEntry],
    manifest: &serde_json::Value,
    variables: &serde_json::Value,
) -> Vec<ProjectIssue> {
    validate_node_contents_internal(graph, nodes, manifest, Some(variables))
}

fn validate_node_contents_internal(
    graph: &ProjectGraph,
    nodes: &[NodeEntry],
    manifest: &serde_json::Value,
    variables: Option<&serde_json::Value>,
) -> Vec<ProjectIssue> {
    let manifest_is_valid =
        contracts::validate_schema(contracts::ContractSchemaKind::Manifest, manifest).is_empty();
    let mut semantic_manifest = manifest.clone();
    contracts::apply_schema_defaults(
        &mut semantic_manifest,
        contracts::schema(contracts::ContractSchemaKind::Manifest),
    );
    let mut issues = Vec::new();

    for (index, graph_node) in graph.nodes.iter().enumerate() {
        let Some(entry) = nodes.get(index) else {
            continue;
        };
        let Some(data) = &entry.data else {
            continue;
        };
        let file = format!("content/{}", graph_node.file);
        let structural = contracts::validate_schema(contracts::ContractSchemaKind::NodeFile, data);
        let structurally_valid = structural.is_empty();
        issues.extend(structural.into_iter().map(|violation| ProjectIssue {
            severity: violation.severity,
            source: violation.source,
            code: violation.code,
            message: violation.message,
            file: Some(file.clone()),
            json_path: Some(violation.json_path),
            node_id: Some(graph_node.id.clone()),
            edge_id: None,
        }));
        if structurally_valid {
            issues.extend(
                contracts::validate_node_semantics(data, &semantic_manifest)
                    .into_iter()
                    .filter_map(|issue| {
                        if !manifest_is_valid && issue.code.starts_with("missing_") {
                            return None;
                        }
                        Some(ProjectIssue {
                            severity: issue.severity,
                            source: issue.source,
                            code: issue.code,
                            message: issue.message,
                            file: Some(file.clone()),
                            json_path: Some(issue.json_path),
                            node_id: Some(graph_node.id.clone()),
                            edge_id: None,
                        })
                    }),
            );
            let declarations = variables
                .and_then(|registry| registry.get("variables"))
                .and_then(serde_json::Value::as_object);
            let mut persistent_ids = std::collections::HashSet::new();
            for (instruction_index, instruction) in
                data.as_array().into_iter().flatten().enumerate()
            {
                validate_instruction_semantics(
                    instruction,
                    &format!("$[{instruction_index}]"),
                    &file,
                    &graph_node.id,
                    variables.is_some(),
                    declarations,
                    &mut persistent_ids,
                    &mut issues,
                );
            }
        }
    }
    issues
}

fn validate_instruction_semantics(
    instruction: &serde_json::Value,
    path: &str,
    file: &str,
    node_id: &str,
    variables_present: bool,
    declarations: Option<&serde_json::Map<String, serde_json::Value>>,
    persistent_ids: &mut std::collections::HashSet<String>,
    issues: &mut Vec<ProjectIssue>,
) {
    match instruction.get("t").and_then(serde_json::Value::as_str) {
        Some("set") => {
            if let Some(expression) = instruction.get("expr").and_then(serde_json::Value::as_str) {
                if let Err(message) = super::expression::parse_expression(expression) {
                    issues.push(ProjectIssue {
                        severity: super::super::model::GraphIssueSeverity::Error,
                        source: "node".to_string(),
                        code: "invalid_assignment_expression".to_string(),
                        message,
                        file: Some(file.to_string()),
                        json_path: Some(format!("{path}.expr")),
                        node_id: Some(node_id.to_string()),
                        edge_id: None,
                    });
                }
            }
            let key = instruction
                .get("key")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            if variables_present && declarations.is_none_or(|items| !items.contains_key(key)) {
                let mut issue = simple_node_issue_at(
                    "undeclared_variable",
                    "变量未在 content/variables.json 声明",
                    file,
                    node_id,
                    path,
                );
                issue.severity = super::super::model::GraphIssueSeverity::Warn;
                issue.source = "variables".to_string();
                issues.push(issue);
            }
            if key.starts_with("system.") {
                issues.push(simple_node_issue_at(
                    "reserved_variable_name",
                    "system.* 是只读变量",
                    file,
                    node_id,
                    path,
                ));
            }
            let global = declarations
                .and_then(|items| items.get(key))
                .and_then(|decl| decl.get("scope"))
                .and_then(serde_json::Value::as_str)
                == Some("global");
            if let (Some(declaration), Some(value)) = (
                declarations.and_then(|items| items.get(key)),
                instruction.get("value"),
            ) {
                let expected = declaration
                    .get("type")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("");
                let nullable = declaration
                    .get("nullable")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false);
                let matches = (value.is_null() && nullable)
                    || matches!(
                        (expected, value),
                        ("string", serde_json::Value::String(_))
                            | ("number", serde_json::Value::Number(_))
                            | ("boolean", serde_json::Value::Bool(_))
                    );
                if !matches {
                    issues.push(simple_node_issue_at(
                        "variable_write_type_mismatch",
                        "变量写入值与声明类型不匹配",
                        file,
                        node_id,
                        path,
                    ));
                }
            }
            if global
                && instruction
                    .get("id")
                    .and_then(serde_json::Value::as_str)
                    .is_none()
            {
                issues.push(simple_node_issue_at(
                    "global_effect_missing_id",
                    "global set 需要稳定 id",
                    file,
                    node_id,
                    path,
                ));
            }
            if global {
                collect_persistent_id(issues, persistent_ids, instruction, file, node_id, path);
            }
        }
        Some("inputName") => {
            let key = instruction
                .get("key")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            let declaration = declarations.and_then(|items| items.get(key));
            if variables_present && declaration.is_none() {
                let mut issue = simple_node_issue_at(
                    "input_name_variable_missing",
                    "玩家命名必须引用已声明的文本故事状态",
                    file,
                    node_id,
                    &format!("{path}.key"),
                );
                issue.source = "variables".to_string();
                issues.push(issue);
            } else if let Some(declaration) = declaration {
                let variable_type = declaration.get("type").and_then(serde_json::Value::as_str);
                let kind = declaration
                    .get("kind")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("");
                if variable_type != Some("string") || (!kind.is_empty() && kind != "text") {
                    let mut issue = simple_node_issue_at(
                        "input_name_variable_not_text",
                        "玩家命名只能写入 text 用途的字符串故事状态",
                        file,
                        node_id,
                        &format!("{path}.key"),
                    );
                    issue.source = "variables".to_string();
                    issues.push(issue);
                }
            }
        }
        Some("completeEnding") => {
            collect_persistent_id(issues, persistent_ids, instruction, file, node_id, path)
        }
        _ => {}
    }

    match instruction.get("t").and_then(serde_json::Value::as_str) {
        Some("if") => {
            if let Some(then) = instruction
                .get("then")
                .and_then(serde_json::Value::as_array)
            {
                for (index, child) in then.iter().enumerate() {
                    validate_instruction_semantics(
                        child,
                        &format!("{path}.then[{index}]"),
                        file,
                        node_id,
                        variables_present,
                        declarations,
                        persistent_ids,
                        issues,
                    );
                }
            }
            if let Some(else_branch) = instruction
                .get("else")
                .and_then(serde_json::Value::as_array)
            {
                for (index, child) in else_branch.iter().enumerate() {
                    validate_instruction_semantics(
                        child,
                        &format!("{path}.else[{index}]"),
                        file,
                        node_id,
                        variables_present,
                        declarations,
                        persistent_ids,
                        issues,
                    );
                }
            }
        }
        Some("choice") => {
            if let Some(options) = instruction
                .get("options")
                .and_then(serde_json::Value::as_array)
            {
                for (option_index, option) in options.iter().enumerate() {
                    if let Some(effects) =
                        option.get("effects").and_then(serde_json::Value::as_array)
                    {
                        for (index, effect) in effects.iter().enumerate() {
                            validate_instruction_semantics(
                                effect,
                                &format!("{path}.options[{option_index}].effects[{index}]"),
                                file,
                                node_id,
                                variables_present,
                                declarations,
                                persistent_ids,
                                issues,
                            );
                        }
                    }
                    if let Some(body) = option.get("body").and_then(serde_json::Value::as_array) {
                        for (index, child) in body.iter().enumerate() {
                            validate_instruction_semantics(
                                child,
                                &format!("{path}.options[{option_index}].body[{index}]"),
                                file,
                                node_id,
                                variables_present,
                                declarations,
                                persistent_ids,
                                issues,
                            );
                        }
                    }
                }
            }
        }
        _ => {}
    }
}

fn simple_node_issue_at(
    code: &str,
    message: &str,
    file: &str,
    node_id: &str,
    path: &str,
) -> ProjectIssue {
    ProjectIssue {
        severity: super::super::model::GraphIssueSeverity::Error,
        source: "node".to_string(),
        code: code.to_string(),
        message: message.to_string(),
        file: Some(file.to_string()),
        json_path: Some(path.to_string()),
        node_id: Some(node_id.to_string()),
        edge_id: None,
    }
}

fn collect_persistent_id(
    issues: &mut Vec<ProjectIssue>,
    seen: &mut std::collections::HashSet<String>,
    instruction: &serde_json::Value,
    file: &str,
    node_id: &str,
    path: &str,
) {
    if let Some(id) = instruction.get("id").and_then(serde_json::Value::as_str) {
        if !seen.insert(id.to_string()) {
            issues.push(simple_node_issue_at(
                "duplicate_persistent_effect_id",
                "同一节点内持久副作用 id 重复",
                file,
                node_id,
                path,
            ));
        }
    }
}
use super::super::contracts;
use super::super::model::{NodeEntry, ProjectGraph, ProjectIssue};
