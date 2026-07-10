// VibeGal-Studio Tauri backend.
//
// Filesystem access is intentionally centralized on the Rust side; the React
// frontend talks to these commands through typed invoke wrappers.

mod backend;

pub use backend::api::open_project_for_cli;
pub use backend::model::{GraphIssue, GraphIssueSeverity, ProjectData, ProjectIssue, ProjectMeta};

pub fn run() {
    backend::tauri_app::run();
}
