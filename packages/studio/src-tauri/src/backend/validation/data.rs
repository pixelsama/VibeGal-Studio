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

pub(crate) fn validate_locale_structure(
    locale: &serde_json::Value,
    file: &str,
) -> Vec<ProjectIssue> {
    contract_project_issues(contracts::ContractSchemaKind::Locale, locale, file)
}

/// 单 skin 收敛（Spec 19 §4.4）：uiSkins 保持 record 结构，不强制迁移、
/// 不静默忽略；条目 > 1 时出 Warn 级 project issue 引导用户自行清理。
/// 引擎只消费 `default`（缺省时回退第一个条目），多余条目不会被消费。
pub(crate) fn validate_ui_skin_convergence(manifest: &serde_json::Value) -> Vec<ProjectIssue> {
    let Some(skins) = manifest.get("uiSkins").and_then(|v| v.as_object()) else {
        return vec![];
    };
    if skins.len() <= 1 {
        return vec![];
    }
    vec![ProjectIssue {
        severity: GraphIssueSeverity::Warn,
        source: "manifest".to_string(),
        code: "multiple_ui_skins".to_string(),
        message: format!(
            "manifest 登记了 {} 套外观资源（uiSkins）：多余的外观资源条目不会被消费（引擎只读取 default，缺省时回退第一个条目），请自行清理多余条目。",
            skins.len()
        ),
        file: Some("content/manifest.json".to_string()),
        json_path: Some("$.uiSkins".to_string()),
        node_id: None,
        edge_id: None,
    }]
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

pub(crate) fn validate_project_semantics(
    graph: &serde_json::Value,
    nodes: &[super::super::model::NodeEntry],
    manifest: &serde_json::Value,
    image_dimensions: &std::collections::HashMap<String, (u32, u32)>,
) -> Vec<ProjectIssue> {
    if !contracts::validate_schema(contracts::ContractSchemaKind::Graph, graph).is_empty()
        || !contracts::validate_schema(contracts::ContractSchemaKind::Manifest, manifest).is_empty()
    {
        return vec![];
    }
    let mut graph_projection = graph.clone();
    contracts::apply_schema_defaults(
        &mut graph_projection,
        contracts::schema(contracts::ContractSchemaKind::Graph),
    );
    let mut manifest_projection = manifest.clone();
    contracts::apply_schema_defaults(
        &mut manifest_projection,
        contracts::schema(contracts::ContractSchemaKind::Manifest),
    );
    let nodes_by_path = nodes
        .iter()
        .map(|entry| (entry.rel_path.as_str(), entry))
        .collect::<std::collections::HashMap<_, _>>();
    let nodes_by_id = graph_projection
        .get("nodes")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|node| {
            let node_id = node.get("id")?.as_str()?.to_string();
            let node_file = node.get("file")?.as_str()?;
            let data = nodes_by_path.get(node_file)?.data.as_ref()?;
            if !contracts::validate_schema(contracts::ContractSchemaKind::NodeFile, data).is_empty()
            {
                return None;
            }
            Some((node_id, data))
        })
        .collect::<std::collections::HashMap<_, _>>();

    contracts::validate_project_semantics(
        &graph_projection,
        &nodes_by_id,
        &manifest_projection,
        image_dimensions,
    )
    .into_iter()
    .map(|issue| ProjectIssue {
        severity: issue.severity,
        source: issue.source.clone(),
        code: issue.code,
        message: issue.message,
        file: Some(
            if issue.source == "manifest" {
                "content/manifest.json"
            } else {
                "content/graph.json"
            }
            .to_string(),
        ),
        json_path: Some(issue.json_path),
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
use super::super::model::{GraphIssue, GraphIssueSeverity, ProjectIssue};
