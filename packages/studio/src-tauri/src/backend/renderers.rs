/// 读取一个渲染层目录下的所有源码文件（.ts/.tsx），供前端运行时编译。
/// 返回 { 相对路径: 源码 } 的列表。递归读取。
#[tauri::command]
fn read_renderer_files(
    project_path: String,
    renderer_id: String,
) -> Result<Vec<RendererFile>, String> {
    let project_root = canonical_project_root(Path::new(&project_path))?;
    validate_plain_name(&renderer_id, "渲染层 id")?;
    let renderer_dir = resolve_relative_under(&project_root, &format!("renderers/{renderer_id}"))?;
    ensure_existing_path_within(&project_root, &renderer_dir)?;

    let mut files = vec![];
    collect_source_files(&renderer_dir, &renderer_dir, &mut files)?;
    Ok(files)
}

#[derive(Serialize, Clone)]
pub struct RendererFile {
    /// 相对渲染层目录的路径（如 "index.tsx"、"Stage.tsx"），用作模块标识
    pub path: String,
    pub content: String,
}

/// 递归收集目录下所有 .ts/.tsx 文件
fn collect_source_files(
    base: &Path,
    dir: &Path,
    out: &mut Vec<RendererFile>,
) -> Result<(), String> {
    let entries =
        fs::read_dir(dir).map_err(|e| format!("读取目录失败 {}: {}", dir.display(), e))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_source_files(base, &path, out)?;
        } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            if ext == "ts" || ext == "tsx" {
                let rel = path
                    .strip_prefix(base)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/");
                let content = fs::read_to_string(&path)
                    .map_err(|e| format!("读取文件失败 {}: {}", path.display(), e))?;
                out.push(RendererFile { path: rel, content });
            }
        }
    }
    Ok(())
}

fn renderer_dir(project_root: &Path, renderer_id: &str) -> Result<PathBuf, String> {
    validate_plain_name(renderer_id, "渲染层 id")?;
    resolve_relative_under(project_root, &format!("renderers/{renderer_id}"))
}

fn ensure_renderer_exists(renderer_dir: &Path, renderer_id: &str) -> Result<(), String> {
    if !renderer_dir.is_dir() {
        return Err(format!("渲染层不存在: {renderer_id}"));
    }
    Ok(())
}

fn create_renderer_from_template(
    project_root: &Path,
    renderer_id: &str,
    template_dir: &Path,
) -> Result<(), String> {
    let target_dir = renderer_dir(project_root, renderer_id)?;
    if target_dir.exists() {
        return Err(format!("渲染层已存在: {renderer_id}"));
    }
    if !template_dir.is_dir() {
        return Err(format!("渲染层模板不存在: {}", template_dir.display()));
    }
    ensure_copy_targets_available(template_dir, &target_dir)?;
    fs::create_dir_all(&target_dir).map_err(|e| format!("创建渲染层目录失败: {}", e))?;
    copy_dir_all(template_dir, &target_dir).map_err(|e| format!("复制渲染层模板失败: {}", e))
}

fn duplicate_renderer_inner(
    project_root: &Path,
    source_id: &str,
    new_id: &str,
) -> Result<(), String> {
    let source_dir = renderer_dir(project_root, source_id)?;
    ensure_renderer_exists(&source_dir, source_id)?;
    let target_dir = renderer_dir(project_root, new_id)?;
    if target_dir.exists() {
        return Err(format!("渲染层已存在: {new_id}"));
    }
    ensure_copy_targets_available(&source_dir, &target_dir)?;
    fs::create_dir_all(&target_dir).map_err(|e| format!("创建渲染层目录失败: {}", e))?;
    copy_dir_all(&source_dir, &target_dir).map_err(|e| format!("复制渲染层失败: {}", e))
}

fn rename_renderer_inner(project_root: &Path, old_id: &str, new_id: &str) -> Result<(), String> {
    if old_id == new_id {
        return Err("旧渲染层 id 与新 id 相同".to_string());
    }
    let source_dir = renderer_dir(project_root, old_id)?;
    ensure_renderer_exists(&source_dir, old_id)?;
    let target_dir = renderer_dir(project_root, new_id)?;
    if target_dir.exists() {
        return Err(format!("渲染层已存在: {new_id}"));
    }
    fs::rename(&source_dir, &target_dir).map_err(|e| format!("重命名渲染层失败: {}", e))?;

    let mut meta = read_project_meta(project_root)?;
    if meta.active_renderer_id == old_id {
        meta.active_renderer_id = new_id.to_string();
        write_json(
            &project_root.join("gal.project.json"),
            &serde_json::to_value(&meta).unwrap(),
        )?;
    }
    Ok(())
}

fn delete_renderer_inner(project_root: &Path, renderer_id: &str) -> Result<(), String> {
    let target_dir = renderer_dir(project_root, renderer_id)?;
    ensure_renderer_exists(&target_dir, renderer_id)?;
    let meta = read_project_meta(project_root)?;
    if meta.active_renderer_id == renderer_id {
        return Err(format!(
            "当前激活的渲染层 {renderer_id} 不能直接删除，请先切换到其他渲染层"
        ));
    }
    fs::remove_dir_all(&target_dir).map_err(|e| format!("删除渲染层失败: {}", e))
}

#[tauri::command]
fn create_renderer(
    project_path: String,
    renderer_id: String,
    template_id: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let project_root = canonical_project_root(Path::new(&project_path))?;
    validate_plain_name(&template_id, "渲染层模板 id")?;
    if template_id != "default" {
        return Err(format!("未知渲染层模板: {template_id}"));
    }
    let template_dir = default_renderer_dir(&app_handle)?;
    create_renderer_from_template(&project_root, &renderer_id, &template_dir)
}

#[tauri::command]
fn duplicate_renderer(
    project_path: String,
    source_id: String,
    new_id: String,
) -> Result<(), String> {
    let project_root = canonical_project_root(Path::new(&project_path))?;
    duplicate_renderer_inner(&project_root, &source_id, &new_id)
}

#[tauri::command]
fn rename_renderer(project_path: String, old_id: String, new_id: String) -> Result<(), String> {
    let project_root = canonical_project_root(Path::new(&project_path))?;
    rename_renderer_inner(&project_root, &old_id, &new_id)
}

#[tauri::command]
fn delete_renderer(project_path: String, renderer_id: String) -> Result<(), String> {
    let project_root = canonical_project_root(Path::new(&project_path))?;
    delete_renderer_inner(&project_root, &renderer_id)
}

/// 更新 gal.project.json
#[tauri::command]
fn save_project_meta(
    project_path: String,
    meta: ProjectMeta,
    expected_revision: Option<serde_json::Value>,
) -> Result<(), String> {
    let project_root = canonical_project_root(Path::new(&project_path))?;
    ensure_expected_revision(&project_root, "gal.project.json", expected_revision)?;
    write_json(
        &project_root.join("gal.project.json"),
        &serde_json::to_value(&meta).unwrap(),
    )
}

// ── 工具函数 ──────────────────────────────────────

