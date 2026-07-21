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
            let declarations = variables.and_then(|registry| registry.get("variables")).and_then(serde_json::Value::as_object);
            let mut persistent_ids = std::collections::HashSet::new();
            for (instruction_index, instruction) in data.as_array().into_iter().flatten().enumerate() {
                let instruction_type = instruction.get("t").and_then(serde_json::Value::as_str);
                if instruction_type == Some("set") {
                    if let Some(expression) = instruction.get("expr").and_then(serde_json::Value::as_str) {
                        if let Err(message) = super::expression::parse_expression(expression) {
                            issues.push(ProjectIssue {
                                severity: super::super::model::GraphIssueSeverity::Error,
                                source: "node".to_string(), code: "invalid_assignment_expression".to_string(), message,
                                file: Some(file.clone()), json_path: Some(format!("$[{instruction_index}].expr")),
                                node_id: Some(graph_node.id.clone()), edge_id: None,
                            });
                        }
                    }
                    let key = instruction.get("key").and_then(serde_json::Value::as_str).unwrap_or("");
                    if variables.is_some() && declarations.is_none_or(|items| !items.contains_key(key)) {
                        let mut issue = simple_node_issue("undeclared_variable", "变量未在 content/variables.json 声明", &file, &graph_node.id, instruction_index);
                        issue.severity = super::super::model::GraphIssueSeverity::Warn;
                        issue.source = "variables".to_string();
                        issues.push(issue);
                    }
                    if key.starts_with("system.") {
                        issues.push(simple_node_issue("reserved_variable_name", "system.* 是只读变量", &file, &graph_node.id, instruction_index));
                    }
                    let global = declarations.and_then(|items| items.get(key)).and_then(|decl| decl.get("scope")).and_then(serde_json::Value::as_str) == Some("global");
                    if let (Some(declaration), Some(value)) = (declarations.and_then(|items| items.get(key)), instruction.get("value")) {
                        let expected = declaration.get("type").and_then(serde_json::Value::as_str).unwrap_or("");
                        let nullable = declaration.get("nullable").and_then(serde_json::Value::as_bool).unwrap_or(false);
                        let matches = (value.is_null() && nullable) || matches!((expected, value), ("string", serde_json::Value::String(_)) | ("number", serde_json::Value::Number(_)) | ("boolean", serde_json::Value::Bool(_)));
                        if !matches { issues.push(simple_node_issue("variable_write_type_mismatch", "变量写入值与声明类型不匹配", &file, &graph_node.id, instruction_index)); }
                    }
                    if global && instruction.get("id").and_then(serde_json::Value::as_str).is_none() {
                        issues.push(simple_node_issue("global_effect_missing_id", "global set 需要稳定 id", &file, &graph_node.id, instruction_index));
                    }
                    if global { collect_persistent_id(&mut issues, &mut persistent_ids, instruction, &file, &graph_node.id, instruction_index); }
                }
                if instruction_type == Some("completeEnding") {
                    collect_persistent_id(&mut issues, &mut persistent_ids, instruction, &file, &graph_node.id, instruction_index);
                }
            }
        }
    }
    issues
}

fn simple_node_issue(code: &str, message: &str, file: &str, node_id: &str, index: usize) -> ProjectIssue {
    ProjectIssue { severity: super::super::model::GraphIssueSeverity::Error, source: "node".to_string(), code: code.to_string(), message: message.to_string(), file: Some(file.to_string()), json_path: Some(format!("$[{index}]")), node_id: Some(node_id.to_string()), edge_id: None }
}

fn collect_persistent_id(issues: &mut Vec<ProjectIssue>, seen: &mut std::collections::HashSet<String>, instruction: &serde_json::Value, file: &str, node_id: &str, index: usize) {
    if let Some(id) = instruction.get("id").and_then(serde_json::Value::as_str) {
        if !seen.insert(id.to_string()) { issues.push(simple_node_issue("duplicate_persistent_effect_id", "同一节点内持久副作用 id 重复", file, node_id, index)); }
    }
}
use super::super::contracts;
use super::super::model::{NodeEntry, ProjectGraph, ProjectIssue};
