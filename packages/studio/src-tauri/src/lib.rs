// VibeGal-Studio Tauri backend.
//
// Filesystem access is intentionally centralized on the Rust side; the React
// frontend talks to these commands through typed invoke wrappers.

mod backend;

pub use backend::{
    open_project_for_cli, run, GraphIssue, GraphIssueSeverity, ProjectData, ProjectIssue,
};
