//! Stable crate facade consumed by the standalone CLI.

use super::model::ProjectData;
pub use super::mutation::SaveNodeResult;

pub use super::identity::{
    assign_missing_story_point_ids, generate_story_point_id, is_story_point_instruction,
    AssignedInstructionId, InstructionIdentityAssignment, InstructionIdentityContext,
    InstructionIdentityError,
};

pub fn open_project_for_cli(path: &str) -> Result<ProjectData, String> {
    super::project::open_project_for_cli(path)
}

pub fn save_node_for_cli(
    project_path: &str,
    node_file: &str,
    instructions: serde_json::Value,
    expected_revision: Option<serde_json::Value>,
) -> Result<SaveNodeResult, String> {
    super::mutation::save_node(
        project_path.to_string(),
        node_file.to_string(),
        instructions,
        expected_revision,
    )
}

pub fn validate_node_for_cli(instructions: &serde_json::Value) -> Result<(), String> {
    super::mutation::validate_node_contract(instructions)
}
