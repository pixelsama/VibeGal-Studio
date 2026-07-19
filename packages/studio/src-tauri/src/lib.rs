// VibeGal-Studio Tauri backend.
//
// Filesystem access is intentionally centralized on the Rust side; the React
// frontend talks to these commands through typed invoke wrappers.

mod backend;

pub use backend::api::{
    assign_missing_story_point_ids, generate_story_point_id, is_story_point_instruction,
    open_project_for_cli, save_node_for_cli, validate_node_for_cli, AssignedInstructionId,
    InstructionIdentityAssignment, InstructionIdentityContext, InstructionIdentityError,
    SaveNodeResult,
};
pub use backend::model::{GraphIssue, GraphIssueSeverity, ProjectData, ProjectIssue, ProjectMeta};

pub fn run() {
    backend::tauri_app::run();
}
