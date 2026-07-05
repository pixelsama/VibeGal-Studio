#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ProjectWatchers::default())
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
            list_projects,
            open_project,
            create_project,
            initialize_project,
            watch_project,
            unwatch_project,
            save_file,
            save_graph,
            save_graph_positions,
            delete_file,
            save_project_meta,
            read_renderer_files,
            create_renderer,
            duplicate_renderer,
            rename_renderer,
            delete_renderer,
            list_assets,
            import_asset,
            delete_asset,
            read_asset_preview_data_url,
            save_manifest,
            load_app_settings,
            save_app_settings,
            cli_tool_status,
            install_cli_tool,
            uninstall_cli_tool,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

