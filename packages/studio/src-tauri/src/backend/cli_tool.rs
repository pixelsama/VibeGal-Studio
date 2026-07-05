const CLI_COMMAND_NAME: &str = "galstudio-cli";

fn cli_executable_name() -> &'static str {
    if cfg!(windows) {
        "galstudio-cli.exe"
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

fn cli_tool_candidate_link_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if cfg!(target_os = "macos") {
        paths.push(PathBuf::from("/usr/local/bin").join(CLI_COMMAND_NAME));
        return paths;
    }
    if cfg!(unix) {
        paths.push(PathBuf::from("/usr/local/bin").join(CLI_COMMAND_NAME));
    }
    if let Ok(home) = env::var("HOME") {
        paths.push(
            PathBuf::from(home)
                .join(".local/bin")
                .join(CLI_COMMAND_NAME),
        );
    }
    paths
}

fn cli_binary_path_candidates(app_handle: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(path) = env::var("GALSTUDIO_CLI_PATH") {
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
}

fn resolve_cli_binary_path(app_handle: &tauri::AppHandle) -> PathBuf {
    let candidates = cli_binary_path_candidates(app_handle);
    candidates
        .iter()
        .find(|path| path.is_file())
        .cloned()
        .or_else(|| candidates.into_iter().next())
        .unwrap_or_else(|| PathBuf::from(cli_executable_name()))
}

fn cli_launcher_path_from_resource_dir(resource_dir: &Path) -> PathBuf {
    resource_dir.join("bin").join(cli_executable_name())
}

fn cli_launcher_path_candidates(app_handle: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(path) = env::var("GALSTUDIO_CLI_LAUNCHER_PATH") {
        candidates.push(PathBuf::from(path));
    }

    if let Ok(resources) = app_handle.path().resource_dir() {
        candidates.push(cli_launcher_path_from_resource_dir(&resources));
        candidates.push(resources.join("resources/bin").join(cli_executable_name()));
    }

    candidates
}

fn resolve_cli_launcher_path(app_handle: &tauri::AppHandle) -> PathBuf {
    let candidates = cli_launcher_path_candidates(app_handle);
    candidates
        .iter()
        .find(|path| path.is_file())
        .cloned()
        .or_else(|| candidates.into_iter().next())
        .unwrap_or_else(|| PathBuf::from(cli_executable_name()))
}

fn resolve_symlink_target(link_path: &Path, target: PathBuf) -> PathBuf {
    if target.is_absolute() {
        target
    } else {
        link_path
            .parent()
            .map(|parent| parent.join(&target))
            .unwrap_or(target)
    }
}

fn paths_point_to_same_file(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(left), Ok(right)) => left == right,
        _ => a == b,
    }
}

fn is_managed_cli_symlink(cli_path: &Path, link_path: &Path) -> bool {
    let Ok(metadata) = fs::symlink_metadata(link_path) else {
        return false;
    };
    if !metadata.file_type().is_symlink() {
        return false;
    }
    let Ok(target) = fs::read_link(link_path) else {
        return false;
    };
    let target = resolve_symlink_target(link_path, target);
    paths_point_to_same_file(&target, cli_path)
}

fn path_env_contains_dir(path_env: Option<&str>, dir: &Path) -> bool {
    let Some(raw_path) = path_env else {
        return false;
    };
    env::split_paths(raw_path).any(|candidate| paths_point_to_same_file(&candidate, dir))
}

fn cli_tool_status_inner(
    launcher_path: &Path,
    sidecar_path: &Path,
    candidate_link_paths: &[PathBuf],
    path_env: Option<&str>,
) -> Result<CliToolStatus, String> {
    let Some(default_link_path) = candidate_link_paths.first() else {
        return Err("当前平台没有可用的命令行安装路径".to_string());
    };
    let installed_link_path = candidate_link_paths
        .iter()
        .find(|path| is_managed_cli_symlink(launcher_path, path));
    let legacy_sidecar_link_path = candidate_link_paths
        .iter()
        .find(|path| is_managed_cli_symlink(sidecar_path, path));
    let link_path = installed_link_path
        .or(legacy_sidecar_link_path)
        .unwrap_or(default_link_path);
    let installed = installed_link_path.is_some();
    let launcher_available = launcher_path.is_file();
    let sidecar_available = sidecar_path.is_file();
    let cli_available = launcher_available && sidecar_available;
    let link_occupied = fs::symlink_metadata(link_path).is_ok()
        && !is_managed_cli_symlink(launcher_path, link_path)
        && !is_managed_cli_symlink(sidecar_path, link_path);
    let in_path = link_path
        .parent()
        .map(|parent| path_env_contains_dir(path_env, parent))
        .unwrap_or(false);
    let issue = if !launcher_available {
        Some(format!(
            "找不到随应用提供的 {} 启动脚本: {}",
            CLI_COMMAND_NAME,
            launcher_path.display()
        ))
    } else if !sidecar_available {
        Some(format!(
            "找不到随应用提供的 {} 执行文件: {}",
            CLI_COMMAND_NAME,
            sidecar_path.display()
        ))
    } else if link_occupied {
        Some(format!(
            "目标路径已存在且不是 GalStudio 管理的链接: {}",
            link_path.display()
        ))
    } else {
        None
    };

    Ok(CliToolStatus {
        command: CLI_COMMAND_NAME.to_string(),
        cli_path: launcher_path.to_string_lossy().to_string(),
        link_path: link_path.to_string_lossy().to_string(),
        installed,
        cli_available,
        link_occupied,
        in_path,
        issue,
    })
}

#[cfg(unix)]
fn create_cli_tool_symlink(cli_path: &Path, link_path: &Path) -> Result<(), String> {
    match std::os::unix::fs::symlink(cli_path, link_path) {
        Ok(()) => Ok(()),
        Err(error) => {
            #[cfg(target_os = "macos")]
            {
                if error.kind() == std::io::ErrorKind::PermissionDenied {
                    return create_cli_tool_symlink_with_admin_prompt(cli_path, link_path);
                }
            }
            Err(format!(
                "创建命令链接失败 ({} -> {}): {}",
                link_path.display(),
                cli_path.display(),
                error
            ))
        }
    }
}

#[cfg(target_os = "macos")]
fn create_cli_tool_symlink_with_admin_prompt(
    cli_path: &Path,
    link_path: &Path,
) -> Result<(), String> {
    let script = admin_symlink_script(cli_path, link_path)?;
    let expression = format!(
        "do shell script {} with administrator privileges",
        applescript_string_literal(&script)
    );
    let output = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(expression)
        .output()
        .map_err(|e| format!("无法请求管理员权限创建命令链接: {}", e))?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        Err("管理员授权创建命令链接失败".to_string())
    } else {
        Err(format!("管理员授权创建命令链接失败: {}", stderr))
    }
}

fn admin_symlink_script(cli_path: &Path, link_path: &Path) -> Result<String, String> {
    let Some(parent) = link_path.parent() else {
        return Err(format!("命令链接路径没有父目录: {}", link_path.display()));
    };
    let link = shell_single_quote(&link_path.to_string_lossy());
    let parent = shell_single_quote(&parent.to_string_lossy());
    let cli = shell_single_quote(&cli_path.to_string_lossy());
    Ok(format!(
        "if [ -e {link} ] || [ -L {link} ]; then echo {occupied} >&2; exit 73; fi\n/bin/mkdir -p {parent}\n/bin/ln -s {cli} {link}",
        link = link,
        occupied = shell_single_quote("target command already exists"),
        parent = parent,
        cli = cli,
    ))
}

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn applescript_string_literal(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len() + 2);
    escaped.push('"');
    for ch in value.chars() {
        match ch {
            '\\' => escaped.push_str("\\\\"),
            '"' => escaped.push_str("\\\""),
            _ => escaped.push(ch),
        }
    }
    escaped.push('"');
    escaped
}

#[cfg(not(unix))]
fn create_cli_tool_symlink(_cli_path: &Path, _link_path: &Path) -> Result<(), String> {
    Err("当前平台暂不支持从应用内安装命令行工具".to_string())
}

fn install_cli_tool_inner(
    launcher_path: &Path,
    sidecar_path: &Path,
    candidate_link_paths: &[PathBuf],
    path_env: Option<&str>,
) -> Result<CliToolStatus, String> {
    if !launcher_path.is_file() {
        return Err(format!(
            "找不到随应用提供的 {} 启动脚本: {}",
            CLI_COMMAND_NAME,
            launcher_path.display()
        ));
    }
    if !sidecar_path.is_file() {
        return Err(format!(
            "找不到随应用提供的 {} 执行文件: {}",
            CLI_COMMAND_NAME,
            sidecar_path.display()
        ));
    }
    if candidate_link_paths.is_empty() {
        return Err("当前平台没有可用的命令行安装路径".to_string());
    }

    let mut fallback_error: Option<String> = None;
    for link_path in candidate_link_paths {
        if is_managed_cli_symlink(launcher_path, link_path) {
            return cli_tool_status_inner(
                launcher_path,
                sidecar_path,
                candidate_link_paths,
                path_env,
            );
        }
        if is_managed_cli_symlink(sidecar_path, link_path) {
            fs::remove_file(link_path)
                .map_err(|e| format!("替换旧版命令链接失败 ({}): {}", link_path.display(), e))?;
        } else if fs::symlink_metadata(link_path).is_ok() {
            return Err(format!(
                "目标路径已存在且不是 GalStudio 管理的命令: {}",
                link_path.display()
            ));
        }
        if let Some(parent) = link_path.parent() {
            if let Err(error) = fs::create_dir_all(parent) {
                #[cfg(target_os = "macos")]
                {
                    if error.kind() == std::io::ErrorKind::PermissionDenied {
                        match create_cli_tool_symlink_with_admin_prompt(launcher_path, link_path) {
                            Ok(()) => {
                                return cli_tool_status_inner(
                                    launcher_path,
                                    sidecar_path,
                                    candidate_link_paths,
                                    path_env,
                                );
                            }
                            Err(error) => {
                                fallback_error = Some(error);
                                continue;
                            }
                        }
                    }
                }
                fallback_error = Some(format!(
                    "创建命令目录失败 ({}): {}",
                    parent.display(),
                    error
                ));
                continue;
            }
        }
        match create_cli_tool_symlink(launcher_path, link_path) {
            Ok(()) => {
                return cli_tool_status_inner(
                    launcher_path,
                    sidecar_path,
                    candidate_link_paths,
                    path_env,
                )
            }
            Err(error) => fallback_error = Some(error),
        }
    }

    Err(fallback_error.unwrap_or_else(|| "安装命令行工具失败".to_string()))
}

fn uninstall_cli_tool_inner(
    launcher_path: &Path,
    sidecar_path: &Path,
    candidate_link_paths: &[PathBuf],
    path_env: Option<&str>,
) -> Result<CliToolStatus, String> {
    for link_path in candidate_link_paths {
        if is_managed_cli_symlink(launcher_path, link_path)
            || is_managed_cli_symlink(sidecar_path, link_path)
        {
            fs::remove_file(link_path)
                .map_err(|e| format!("移除命令链接失败 ({}): {}", link_path.display(), e))?;
        }
    }
    cli_tool_status_inner(launcher_path, sidecar_path, candidate_link_paths, path_env)
}

#[tauri::command]
fn cli_tool_status(app_handle: tauri::AppHandle) -> Result<CliToolStatus, String> {
    let launcher_path = resolve_cli_launcher_path(&app_handle);
    let sidecar_path = resolve_cli_binary_path(&app_handle);
    let link_paths = cli_tool_candidate_link_paths();
    let path_env = env::var("PATH").ok();
    cli_tool_status_inner(
        &launcher_path,
        &sidecar_path,
        &link_paths,
        path_env.as_deref(),
    )
}

#[tauri::command]
fn install_cli_tool(app_handle: tauri::AppHandle) -> Result<CliToolStatus, String> {
    let launcher_path = resolve_cli_launcher_path(&app_handle);
    let sidecar_path = resolve_cli_binary_path(&app_handle);
    let link_paths = cli_tool_candidate_link_paths();
    let path_env = env::var("PATH").ok();
    install_cli_tool_inner(
        &launcher_path,
        &sidecar_path,
        &link_paths,
        path_env.as_deref(),
    )
}

#[tauri::command]
fn uninstall_cli_tool(app_handle: tauri::AppHandle) -> Result<CliToolStatus, String> {
    let launcher_path = resolve_cli_launcher_path(&app_handle);
    let sidecar_path = resolve_cli_binary_path(&app_handle);
    let link_paths = cli_tool_candidate_link_paths();
    let path_env = env::var("PATH").ok();
    uninstall_cli_tool_inner(
        &launcher_path,
        &sidecar_path,
        &link_paths,
        path_env.as_deref(),
    )
}

