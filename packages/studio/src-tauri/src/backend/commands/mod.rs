//! Thin Tauri command adapters over backend domain services.

use super::cli_tool;
use super::fs::ProjectRoot;
use super::model::{
    AppSettings, AssetEntry, CliToolStatus, FileRevision, GraphPositionPatchInput, ProjectData,
    ProjectListItem, ProjectMeta,
};
use super::mutation;
use super::project;
use super::renderer::{self, RendererFile};
use super::resources;
use super::settings as settings_service;
use super::watcher::{self, ProjectWatchers, PROJECT_CHANGED_EVENT};
use std::env;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[derive(Default)]
pub(crate) struct AssetScopeState {
    active_content_root: Mutex<Option<PathBuf>>,
}

pub(crate) fn transition_asset_scope<Forbid, Allow>(
    active: &mut Option<PathBuf>,
    next: PathBuf,
    mut forbid: Forbid,
    mut allow: Allow,
) -> Result<(), String>
where
    Forbid: FnMut(&Path) -> Result<(), String>,
    Allow: FnMut(&Path) -> Result<(), String>,
{
    if active.as_ref() == Some(&next) {
        return Ok(());
    }
    let previous = active.clone();
    if let Some(previous) = &previous {
        forbid(previous)?;
        *active = None;
    }
    match allow(&next) {
        Ok(()) => {
            *active = Some(next);
            Ok(())
        }
        Err(allow_error) => {
            if let Some(previous) = previous {
                match allow(&previous) {
                    Ok(()) => *active = Some(previous),
                    Err(restore_error) => {
                        return Err(format!(
                            "{allow_error}; 恢复原资产目录授权失败: {restore_error}"
                        ));
                    }
                }
            }
            Err(allow_error)
        }
    }
}

fn open_project_with_scope(
    path: &str,
    app_handle: &tauri::AppHandle,
    scope_state: &AssetScopeState,
) -> Result<ProjectData, String> {
    let data = project::open_project_inner(path)?;
    let content_root = ProjectRoot::open(Path::new(&data.path))?.content_root()?;
    let scope = app_handle.asset_protocol_scope();
    let mut active = scope_state
        .active_content_root
        .lock()
        .map_err(|_| "资产协议授权状态已损坏".to_string())?;
    transition_asset_scope(
        &mut active,
        content_root.path().to_path_buf(),
        |previous| {
            scope
                .forbid_directory(previous, true)
                .map_err(|e| format!("撤销渲染资产目录授权失败 ({}): {}", previous.display(), e))
        },
        |next| {
            scope
                .allow_directory(next, true)
                .map_err(|e| format!("授权渲染资产目录失败 ({}): {}", next.display(), e))
        },
    )?;
    Ok(data)
}

#[tauri::command]
pub(crate) fn list_projects(workspace_dir: String) -> Result<Vec<ProjectListItem>, String> {
    project::list_projects(workspace_dir)
}

#[tauri::command]
pub(crate) fn open_project(
    path: String,
    app_handle: tauri::AppHandle,
    scope_state: tauri::State<'_, AssetScopeState>,
) -> Result<ProjectData, String> {
    open_project_with_scope(&path, &app_handle, &scope_state)
}

#[tauri::command]
pub(crate) fn create_project(
    parent_dir: String,
    name: String,
    app_handle: tauri::AppHandle,
    scope_state: tauri::State<'_, AssetScopeState>,
) -> Result<ProjectData, String> {
    let template = resources::default_renderer_dir(&app_handle)?;
    let project_path = mutation::create_project(&parent_dir, &name, &template)?;
    open_project_with_scope(
        project_path.to_string_lossy().as_ref(),
        &app_handle,
        &scope_state,
    )
}

#[tauri::command]
pub(crate) fn initialize_project(
    path: String,
    app_handle: tauri::AppHandle,
    scope_state: tauri::State<'_, AssetScopeState>,
) -> Result<ProjectData, String> {
    let template = resources::default_renderer_dir(&app_handle)?;
    let project_path = mutation::initialize_project(&path, &template)?;
    open_project_with_scope(
        project_path.to_string_lossy().as_ref(),
        &app_handle,
        &scope_state,
    )
}

#[tauri::command]
pub(crate) fn watch_project(
    project_path: String,
    app_handle: tauri::AppHandle,
    watchers: tauri::State<'_, ProjectWatchers>,
) -> Result<(), String> {
    watcher::watch(&project_path, &watchers, move |payload| {
        let _ = app_handle.emit(PROJECT_CHANGED_EVENT, payload);
    })
}

#[tauri::command]
pub(crate) fn unwatch_project(
    project_path: String,
    watchers: tauri::State<'_, ProjectWatchers>,
) -> Result<(), String> {
    watcher::unwatch(&project_path, &watchers)
}

#[tauri::command]
pub(crate) fn save_file(
    project_path: String,
    rel_path: String,
    content: String,
    expected_revision: Option<serde_json::Value>,
) -> Result<Option<FileRevision>, String> {
    mutation::save_file(project_path, rel_path, content, expected_revision)
}

#[tauri::command]
pub(crate) fn save_graph(
    project_path: String,
    graph: serde_json::Value,
    expected_revision: Option<serde_json::Value>,
) -> Result<Option<FileRevision>, String> {
    mutation::save_graph(project_path, graph, expected_revision)
}

#[tauri::command]
pub(crate) fn save_graph_positions(
    project_path: String,
    updates: Vec<GraphPositionPatchInput>,
    expected_revision: Option<serde_json::Value>,
) -> Result<Option<FileRevision>, String> {
    mutation::save_graph_positions(project_path, updates, expected_revision)
}

#[tauri::command]
pub(crate) fn delete_file(
    project_path: String,
    rel_path: String,
    expected_revision: Option<serde_json::Value>,
) -> Result<(), String> {
    mutation::delete_file(project_path, rel_path, expected_revision)
}

#[tauri::command]
pub(crate) fn save_project_meta(
    project_path: String,
    meta: ProjectMeta,
    expected_revision: Option<serde_json::Value>,
) -> Result<Option<FileRevision>, String> {
    mutation::save_project_meta(project_path, meta, expected_revision)
}

#[tauri::command]
pub(crate) fn read_renderer_files(
    project_path: String,
    renderer_id: String,
) -> Result<Vec<RendererFile>, String> {
    renderer::read_renderer_files(project_path, renderer_id)
}

#[tauri::command]
pub(crate) fn create_renderer(
    project_path: String,
    renderer_id: String,
    template_id: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let template = resources::default_renderer_dir(&app_handle)?;
    renderer::create_renderer(&project_path, &renderer_id, &template_id, &template)
}

#[tauri::command]
pub(crate) fn duplicate_renderer(
    project_path: String,
    source_id: String,
    new_id: String,
) -> Result<(), String> {
    renderer::duplicate_renderer(project_path, source_id, new_id)
}

#[tauri::command]
pub(crate) fn rename_renderer(
    project_path: String,
    old_id: String,
    new_id: String,
) -> Result<(), String> {
    renderer::rename_renderer(project_path, old_id, new_id)
}

#[tauri::command]
pub(crate) fn delete_renderer(project_path: String, renderer_id: String) -> Result<(), String> {
    renderer::delete_renderer(project_path, renderer_id)
}

#[tauri::command]
pub(crate) fn list_assets(project_path: String) -> Result<Vec<AssetEntry>, String> {
    mutation::list_assets(project_path)
}

#[tauri::command]
pub(crate) fn import_asset(
    project_path: String,
    source_abs_path: String,
    dest_rel_path: String,
) -> Result<(), String> {
    mutation::import_asset(project_path, source_abs_path, dest_rel_path)
}

#[tauri::command]
pub(crate) fn delete_asset(
    project_path: String,
    rel_path: String,
    expected_revision: Option<serde_json::Value>,
) -> Result<(), String> {
    mutation::delete_asset(project_path, rel_path, expected_revision)
}

#[tauri::command]
pub(crate) fn read_asset_preview_data_url(
    project_path: String,
    rel_path: String,
) -> Result<String, String> {
    mutation::read_asset_preview_data_url(project_path, rel_path)
}

#[tauri::command]
pub(crate) fn save_manifest(
    project_path: String,
    manifest: serde_json::Value,
    expected_revision: Option<serde_json::Value>,
) -> Result<Option<FileRevision>, String> {
    mutation::save_manifest(project_path, manifest, expected_revision)
}

#[tauri::command]
pub(crate) fn load_app_settings(app_handle: tauri::AppHandle) -> Result<AppSettings, String> {
    settings_service::load(&resources::settings_path(&app_handle)?)
}

#[tauri::command]
pub(crate) fn save_app_settings(
    app_handle: tauri::AppHandle,
    settings: AppSettings,
) -> Result<(), String> {
    settings_service::save(&resources::settings_path(&app_handle)?, settings)
}

fn cli_paths(app_handle: &tauri::AppHandle) -> (PathBuf, PathBuf, Vec<PathBuf>, Option<String>) {
    (
        resources::cli_launcher_path(app_handle),
        resources::cli_binary_path(app_handle),
        cli_tool::cli_tool_candidate_link_paths(),
        env::var("PATH").ok(),
    )
}

#[tauri::command]
pub(crate) fn cli_tool_status(app_handle: tauri::AppHandle) -> Result<CliToolStatus, String> {
    let (launcher, sidecar, links, path_env) = cli_paths(&app_handle);
    cli_tool::cli_tool_status_inner(&launcher, &sidecar, &links, path_env.as_deref())
}

#[tauri::command]
pub(crate) fn install_cli_tool(app_handle: tauri::AppHandle) -> Result<CliToolStatus, String> {
    let (launcher, sidecar, links, path_env) = cli_paths(&app_handle);
    cli_tool::install_cli_tool_inner(&launcher, &sidecar, &links, path_env.as_deref())
}

#[tauri::command]
pub(crate) fn uninstall_cli_tool(app_handle: tauri::AppHandle) -> Result<CliToolStatus, String> {
    let (launcher, sidecar, links, path_env) = cli_paths(&app_handle);
    cli_tool::uninstall_cli_tool_inner(&launcher, &sidecar, &links, path_env.as_deref())
}

#[cfg(test)]
mod tests;
