//! Project discovery, loading, graph I/O, initialization, and local templates.

mod assets;
mod graph_io;
mod initialize;
pub(crate) mod loader;
pub(crate) mod templates;

pub(crate) use assets::list_asset_entries;
pub(crate) use graph_io::{legacy_chapter_layout_issues, load_project_graph_data};
pub(crate) use initialize::{copy_dir_all, ensure_copy_targets_available, initialize_project_root};
pub(crate) use loader::open_project_for_cli;
pub(crate) use loader::{list_projects, open_project_inner, read_project_meta};
pub(crate) use templates::write_project_self_description;
