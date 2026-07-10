//! Contract-backed manifest/meta validation and issue aggregation helpers.

// Project-content structural validation delegated to embedded contracts.

pub(crate) fn validate_manifest_structure(manifest: &serde_json::Value) -> Vec<ProjectIssue> {
    contract_project_issues(
        contracts::ContractSchemaKind::Manifest,
        manifest,
        "content/manifest.json",
    )
}

pub(crate) fn validate_meta_structure(meta: &serde_json::Value) -> Vec<ProjectIssue> {
    contract_project_issues(
        contracts::ContractSchemaKind::Meta,
        meta,
        "content/meta.json",
    )
}

fn contract_project_issues(
    schema: contracts::ContractSchemaKind,
    value: &serde_json::Value,
    file: &str,
) -> Vec<ProjectIssue> {
    contracts::validate_schema(schema, value)
        .into_iter()
        .map(|violation| ProjectIssue {
            severity: violation.severity,
            source: violation.source,
            code: violation.code,
            message: violation.message,
            file: Some(file.to_string()),
            json_path: Some(violation.json_path),
            node_id: None,
            edge_id: None,
        })
        .collect()
}

/// Map a graph issue into the stable ProjectIssue serialization shape.
pub(crate) fn graph_issue_to_project(issue: &GraphIssue, source: &str) -> ProjectIssue {
    ProjectIssue {
        severity: issue.severity,
        source: source.to_string(),
        code: issue.code.clone(),
        message: issue.message.clone(),
        file: issue.file.clone(),
        json_path: issue.json_path.clone(),
        node_id: issue.node_id.clone(),
        edge_id: issue.edge_id.clone(),
    }
}
use super::super::contracts;
use super::super::model::{GraphIssue, ProjectIssue};
