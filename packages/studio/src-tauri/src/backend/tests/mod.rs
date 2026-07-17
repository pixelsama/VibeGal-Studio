mod assets;
mod graph_validation;
mod initialization_watcher;
mod mutations;
mod node_validation;
// 全部用例都是 symlink 拒绝场景，仅在 Unix 上运行（文件内已逐个 #[cfg(unix)]，
// 这里整模块 gate 避免 Windows 上空模块的 unused import 告警）
#[cfg(unix)]
mod path_security;
mod project_loading;
mod renderer;
mod revision_public;
mod settings_cli;
mod support;
