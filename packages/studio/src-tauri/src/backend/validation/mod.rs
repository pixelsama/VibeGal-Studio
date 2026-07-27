//! Read-only validation services. Validation returns issues and never writes project data.

mod asset;
mod data;
mod expression;
mod graph;
mod localization;
mod node;

pub(crate) use asset::validate_assets;
pub(crate) use data::{
    graph_issue_to_project, validate_locale_structure, validate_manifest_structure,
    validate_meta_structure, validate_ui_skin_convergence,
};
pub(crate) use expression::parse_expression;
pub(crate) use expression::rename_identifier;
pub(crate) use graph::validate_graph;
pub(crate) use localization::validate_localization_and_voice;
#[cfg(test)]
pub(crate) use node::validate_node_contents;
pub(crate) use node::validate_node_contents_with_variables;
