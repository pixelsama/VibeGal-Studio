//! Tauri resource and application-data path resolution.

use std::env;
use std::path::PathBuf;
use tauri::Manager;

const CLI_COMMAND_NAME: &str = "vibegal-cli";

fn cli_executable_name() -> &'static str {
    if cfg!(windows) {
        "vibegal-cli.exe"
    } else {
        CLI_COMMAND_NAME
    }
}

fn cli_sidecar_target_triple() -> Option<&'static str> {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Some("aarch64-apple-darwin")
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        Some("x86_64-apple-darwin")
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        Some("x86_64-unknown-linux-gnu")
    } else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        Some("x86_64-pc-windows-msvc")
    } else {
        None
    }
}

pub(crate) fn default_renderer_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("获取 resource_dir 失败: {}", e))?
        .join("resources/default-renderer"))
}

pub(crate) fn settings_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_handle
        .path()
        .app_config_dir()
        .map_err(|e| format!("获取 app_config_dir 失败: {}", e))?
        .join("settings.json"))
}

pub(crate) fn cli_binary_path(app_handle: &tauri::AppHandle) -> PathBuf {
    let mut candidates = Vec::new();
    if let Ok(path) = env::var("VIBEGAL_CLI_PATH") {
        candidates.push(PathBuf::from(path));
    }
    if let Ok(exe) = env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join(cli_executable_name()));
            if let Some(triple) = cli_sidecar_target_triple() {
                candidates.push(parent.join(format!("{}-{}", CLI_COMMAND_NAME, triple)));
                if cfg!(windows) {
                    candidates.push(parent.join(format!("{}-{}.exe", CLI_COMMAND_NAME, triple)));
                }
            }
        }
    }
    if let Ok(resources) = app_handle.path().resource_dir() {
        candidates.push(resources.join(cli_executable_name()));
        candidates.push(resources.join("bin").join(cli_executable_name()));
        if let Some(triple) = cli_sidecar_target_triple() {
            candidates.push(resources.join(format!("{}-{}", CLI_COMMAND_NAME, triple)));
            if cfg!(windows) {
                candidates.push(resources.join(format!("{}-{}.exe", CLI_COMMAND_NAME, triple)));
            }
        }
    }
    candidates
        .iter()
        .find(|path| path.is_file())
        .cloned()
        .or_else(|| candidates.into_iter().next())
        .unwrap_or_else(|| PathBuf::from(cli_executable_name()))
}

// 启动脚本概念只存在于 Unix（Windows 直接把 sidecar 当 CLI 本体，见
// commands/mod.rs 的 cli_paths）；any(..., test) 保留跨平台测试覆盖。
#[cfg(any(unix, test))]
pub(crate) fn cli_launcher_path_from_resource_dir(resource_dir: &std::path::Path) -> PathBuf {
    resource_dir.join("bin").join(cli_executable_name())
}

#[cfg(any(unix, test))]
pub(crate) fn cli_launcher_path(app_handle: &tauri::AppHandle) -> PathBuf {
    let mut candidates = Vec::new();
    if let Ok(path) = env::var("VIBEGAL_CLI_LAUNCHER_PATH") {
        candidates.push(PathBuf::from(path));
    }
    if let Ok(resources) = app_handle.path().resource_dir() {
        candidates.push(cli_launcher_path_from_resource_dir(&resources));
        candidates.push(resources.join("resources/bin").join(cli_executable_name()));
    }
    candidates
        .iter()
        .find(|path| path.is_file())
        .cloned()
        .or_else(|| candidates.into_iter().next())
        .unwrap_or_else(|| PathBuf::from(cli_executable_name()))
}
