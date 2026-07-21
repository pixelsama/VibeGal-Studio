//! Tauri application composition root.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub(crate) fn run() {
    tauri::Builder::default()
        .manage(super::watcher::ProjectWatchers::default())
        .manage(super::commands::AssetScopeState::default())
        .manage(super::game_build::DesktopBuildRegistry::default())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            super::commands::list_projects,
            super::commands::open_project,
            super::commands::create_project,
            super::commands::initialize_project,
            super::commands::watch_project,
            super::commands::unwatch_project,
            super::commands::save_file,
            super::commands::save_node,
            super::commands::save_graph,
            super::commands::save_graph_positions,
            super::commands::delete_file,
            super::commands::save_project_meta,
            super::commands::read_renderer_files,
            super::commands::create_renderer,
            super::commands::duplicate_renderer,
            super::commands::rename_renderer,
            super::commands::delete_renderer,
            super::commands::list_assets,
            super::commands::import_asset,
            super::commands::delete_asset,
            super::commands::read_asset_preview_data_url,
            super::commands::save_manifest,
            super::commands::save_variables,
            super::commands::load_app_settings,
            super::commands::save_app_settings,
            super::commands::build_desktop_game,
            super::commands::cancel_desktop_game_build,
            super::commands::desktop_build_preflight,
            super::commands::smoke_desktop_game,
            super::commands::reveal_path,
            super::commands::run_desktop_game,
            super::commands::cli_tool_status,
            super::commands::install_cli_tool,
            super::commands::uninstall_cli_tool,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
