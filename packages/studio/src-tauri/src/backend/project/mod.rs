//! Project discovery, loading, graph I/O, initialization, and local templates.

mod assets;
mod graph_io;
mod initialize;
pub(crate) mod loader;
pub(crate) mod templates;

pub(crate) use assets::list_asset_entries;
pub(crate) use graph_io::{legacy_chapter_layout_issues, load_node_entries, load_project_graph};
pub(crate) use initialize::{
    copy_dir_all, ensure_copy_targets_available, initialize_project_root,
    initialize_project_root_from_example,
};
pub(crate) use loader::open_project_for_cli;
pub(crate) use loader::{
    analyze_project, list_projects, open_project_inner, open_project_summary, read_node_detail,
    read_node_file_snapshot, read_project_meta, read_project_nodes,
};
pub(crate) use templates::{
    ensure_project_self_description, missing_project_self_description_files,
    project_ignores_galstudio, write_project_self_description,
};
