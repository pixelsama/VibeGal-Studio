//! Stable crate facade consumed by the standalone CLI.

use super::model::ProjectData;

pub fn open_project_for_cli(path: &str) -> Result<ProjectData, String> {
    super::project::open_project_for_cli(path)
}
