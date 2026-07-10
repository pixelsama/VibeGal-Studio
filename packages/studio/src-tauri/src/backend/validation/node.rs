//! Node instruction semantic validation driven by embedded contract metadata.

// Node-file validation: contracts own structure, embedded metadata owns policy.

pub(crate) fn validate_node_contents(
    graph: &ProjectGraph,
    nodes: &[NodeEntry],
    manifest: &serde_json::Value,
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
        }
    }
    issues
}
use super::super::contracts;
use super::super::model::{NodeEntry, ProjectGraph, ProjectIssue};
