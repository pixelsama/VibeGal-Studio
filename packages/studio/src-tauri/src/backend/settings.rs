fn default_renderer_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("获取 resource_dir 失败: {}", e))?
        .join("resources/default-renderer"))
}

// ──────────────────────────────────────────────
// 应用级设置（非项目级），存到 app config 目录的 settings.json
// ──────────────────────────────────────────────

fn settings_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_handle
        .path()
        .app_config_dir()
        .map_err(|e| format!("获取 app_config_dir 失败: {}", e))?
        .join("settings.json"))
}

/// 加载应用设置。文件不存在时返回默认值（首次运行，默认跟随系统）。
#[tauri::command]
fn load_app_settings(app_handle: tauri::AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(&app_handle)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let text = fs::read_to_string(&path)
        .map_err(|e| format!("读取设置失败 ({}): {}", path.display(), e))?;
    serde_json::from_str::<AppSettings>(&text)
        .map_err(|e| format!("解析设置失败 ({}): {}", path.display(), e))
}

/// 保存应用设置。
#[tauri::command]
fn save_app_settings(app_handle: tauri::AppHandle, settings: AppSettings) -> Result<(), String> {
    let path = settings_path(&app_handle)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建设置目录失败: {}", e))?;
    }
    let json =
        serde_json::to_string_pretty(&settings).map_err(|e| format!("序列化设置失败: {}", e))?;
    atomic_write_text(&path, &json).map_err(|e| format!("写设置失败 ({}): {}", path.display(), e))
}

// ──────────────────────────────────────────────
// 命令行工具安装（显式 symlink，不静默修改 PATH）
// ──────────────────────────────────────────────
