fn ensure_initialization_targets_available(
    project_path: &Path,
    default_renderer_dir: &Path,
) -> Result<(), String> {
    for path in [
        project_path.join("gal.project.json"),
        project_path.join("content/manifest.json"),
        project_path.join("content/meta.json"),
        project_path.join("content/graph.json"),
        project_path.join("content/nodes/start.json"),
        project_path.join("AGENTS.md"),
        project_path.join(".galstudio/README.md"),
        project_path.join(".galstudio/renderer-contract.md"),
        project_path.join(".galstudio/schemas/graph.json"),
        project_path.join(".galstudio/schemas/nodeFile.json"),
        project_path.join(".galstudio/schemas/manifest.json"),
        project_path.join(".galstudio/schemas/meta.json"),
    ] {
        ensure_can_create_file(&path)?;
    }
    ensure_copy_targets_available(
        default_renderer_dir,
        &project_path.join("renderers/default"),
    )
}

fn ensure_can_create_file(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Err(format!("初始化会覆盖已有文件，已取消: {}", path.display()));
    }
    Ok(())
}

fn ensure_copy_targets_available(src: &Path, dst: &Path) -> Result<(), String> {
    let entries =
        fs::read_dir(src).map_err(|e| format!("读取目录失败 {}: {}", src.display(), e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
        let ty = entry
            .file_type()
            .map_err(|e| format!("读取文件类型失败: {}", e))?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            ensure_copy_targets_available(&from, &to)?;
        } else {
            ensure_can_create_file(&to)?;
        }
    }
    Ok(())
}

fn chrono_now() -> String {
    // 简单的 RFC3339 风格时间戳，避免引入 chrono 依赖
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{}", secs)
}

/// 递归复制目录
fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&from, &to)?;
        } else {
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

