//! Renderer source catalog and renderer-layer mutations.

/// 读取一个渲染层目录下的所有源码文件（.ts/.tsx），供前端运行时编译。
/// 返回 { 相对路径: 源码 } 的列表。递归读取。
pub(crate) fn read_renderer_files(
    project_path: String,
    renderer_id: String,
) -> Result<Vec<RendererFile>, String> {
    let project_root = ProjectRoot::open(Path::new(&project_path))?;
    validate_plain_name(&renderer_id, "渲染层 id")?;
    let renderer_dir =
        resolve_relative_under(project_root.path(), &format!("renderers/{renderer_id}"))?;
    ensure_existing_path_within(project_root.path(), &renderer_dir)?;

    let renderer_metadata = fs::symlink_metadata(&renderer_dir)
        .map_err(|e| format!("读取渲染层目录信息失败 {}: {}", renderer_dir.display(), e))?;
    if renderer_metadata.file_type().is_symlink() {
        return Err(format!(
            "渲染层目录不能是符号链接: {}",
            renderer_dir.display()
        ));
    }
    let renderer_root = renderer_dir
        .canonicalize()
        .map_err(|e| format!("解析渲染层目录失败 {}: {}", renderer_dir.display(), e))?;
    if !renderer_root.starts_with(project_root.path()) {
        return Err(format!("渲染层目录越界: {}", renderer_root.display()));
    }

    let mut files = vec![];
    collect_source_files(&renderer_root, &renderer_root, &mut files)?;
    Ok(files)
}

#[derive(Serialize, Clone, Debug)]
pub struct RendererFile {
    /// 相对渲染层目录的路径（如 "index.tsx"、"Stage.tsx"），用作模块标识
    pub path: String,
    pub content: String,
}

const RENDERER_MAX_SOURCE_FILES: usize = 128;
const RENDERER_MAX_SOURCE_FILE_BYTES: usize = 512 * 1024;
const RENDERER_MAX_TOTAL_SOURCE_BYTES: usize = 4 * 1024 * 1024;

/// 递归收集目录下所有 .ts/.tsx 文件
fn collect_source_files(
    base: &Path,
    dir: &Path,
    out: &mut Vec<RendererFile>,
) -> Result<(), String> {
    let canonical_base = base
        .canonicalize()
        .map_err(|e| format!("解析渲染层根目录失败 {}: {}", base.display(), e))?;
    let canonical_dir = dir
        .canonicalize()
        .map_err(|e| format!("解析渲染层子目录失败 {}: {}", dir.display(), e))?;
    if !canonical_dir.starts_with(&canonical_base) {
        return Err(format!("渲染层子目录越界: {}", canonical_dir.display()));
    }

    let entries = fs::read_dir(&canonical_dir)
        .map_err(|e| format!("读取目录失败 {}: {}", canonical_dir.display(), e))?;
    for entry_result in entries {
        let entry = entry_result
            .map_err(|e| format!("读取目录项失败 {}: {}", canonical_dir.display(), e))?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|e| format!("读取渲染层文件信息失败 {}: {}", path.display(), e))?;
        if metadata.file_type().is_symlink() {
            return Err(format!("渲染层源码不能包含符号链接: {}", path.display()));
        }
        if metadata.is_dir() {
            let child = path
                .canonicalize()
                .map_err(|e| format!("解析渲染层子目录失败 {}: {}", path.display(), e))?;
            if !child.starts_with(&canonical_base) {
                return Err(format!("渲染层子目录越界: {}", child.display()));
            }
            collect_source_files(&canonical_base, &child, out)?;
        } else if metadata.is_file() {
            let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
                continue;
            };
            if ext == "ts" || ext == "tsx" {
                let canonical_file = path
                    .canonicalize()
                    .map_err(|e| format!("解析渲染层源码失败 {}: {}", path.display(), e))?;
                if !canonical_file.starts_with(&canonical_base) {
                    return Err(format!("渲染层源码越界: {}", canonical_file.display()));
                }
                if out.len() >= RENDERER_MAX_SOURCE_FILES {
                    return Err(format!(
                        "渲染层源码文件数量超过限制（最多 {} 个）",
                        RENDERER_MAX_SOURCE_FILES
                    ));
                }
                let size = usize::try_from(metadata.len()).unwrap_or(usize::MAX);
                if size > RENDERER_MAX_SOURCE_FILE_BYTES {
                    return Err(format!(
                        "渲染层源码单文件超过限制（最多 {} 字节）: {}",
                        RENDERER_MAX_SOURCE_FILE_BYTES,
                        canonical_file.display()
                    ));
                }
                let total_size = out
                    .iter()
                    .map(|file| file.content.len())
                    .sum::<usize>()
                    .saturating_add(size);
                if total_size > RENDERER_MAX_TOTAL_SOURCE_BYTES {
                    return Err(format!(
                        "渲染层源码总大小超过限制（最多 {} 字节）",
                        RENDERER_MAX_TOTAL_SOURCE_BYTES
                    ));
                }
                let rel = canonical_file
                    .strip_prefix(&canonical_base)
                    .map_err(|_| format!("渲染层源码越界: {}", canonical_file.display()))?
                    .to_string_lossy()
                    .replace('\\', "/");
                let content = fs::read_to_string(&canonical_file)
                    .map_err(|e| format!("读取文件失败 {}: {}", canonical_file.display(), e))?;
                out.push(RendererFile { path: rel, content });
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod renderer_source_security_tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_renderer(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("vibegal-renderer-{name}-{stamp}"))
    }

    fn collect(base: &Path) -> Result<Vec<RendererFile>, String> {
        let mut files = Vec::new();
        collect_source_files(base, base, &mut files)?;
        Ok(files)
    }

    #[cfg(unix)]
    #[test]
    fn renderer_source_reader_rejects_renderer_root_symlinks() {
        use std::os::unix::fs::symlink;

        let project = temp_renderer("root-symlink-project");
        let source = project.join("renderer-source");
        fs::create_dir_all(project.join("renderers")).unwrap();
        fs::create_dir_all(&source).unwrap();
        fs::write(project.join("gal.project.json"), "{}").unwrap();
        fs::write(source.join("index.tsx"), "export default {}").unwrap();
        symlink(&source, project.join("renderers/default")).unwrap();

        let error = read_renderer_files(
            project.to_string_lossy().into_owned(),
            "default".to_string(),
        )
        .expect_err("renderer root symlinks must be rejected");
        assert!(error.contains("符号链接"), "unexpected error: {error}");

        let _ = fs::remove_dir_all(&project);
    }

    #[cfg(unix)]
    #[test]
    fn renderer_source_reader_rejects_file_symlinks() {
        use std::os::unix::fs::symlink;

        let root = temp_renderer("file-symlink");
        let outside = root.with_extension("outside.tsx");
        fs::create_dir_all(&root).unwrap();
        fs::write(&outside, "export default 'outside'").unwrap();
        symlink(&outside, root.join("index.tsx")).unwrap();

        let error = collect(&root).expect_err("renderer source symlinks must be rejected");
        assert!(error.contains("符号链接"), "unexpected error: {error}");

        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_file(&outside);
    }

    #[cfg(unix)]
    #[test]
    fn renderer_source_reader_rejects_directory_symlinks() {
        use std::os::unix::fs::symlink;

        let root = temp_renderer("dir-symlink");
        let outside = root.with_extension("outside");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("Stage.tsx"), "export const Stage = null").unwrap();
        symlink(&outside, root.join("components")).unwrap();

        let error = collect(&root).expect_err("renderer directory symlinks must be rejected");
        assert!(error.contains("符号链接"), "unexpected error: {error}");

        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn renderer_source_reader_enforces_file_count_limit() {
        let root = temp_renderer("file-count");
        fs::create_dir_all(&root).unwrap();
        for index in 0..=RENDERER_MAX_SOURCE_FILES {
            fs::write(root.join(format!("{index}.ts")), "export {};\n").unwrap();
        }

        let error = collect(&root).expect_err("oversized renderer file sets must fail");
        assert!(error.contains("文件数量"), "unexpected error: {error}");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn renderer_source_reader_enforces_single_file_limit() {
        let root = temp_renderer("single-size");
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join("index.tsx"),
            vec![b'x'; RENDERER_MAX_SOURCE_FILE_BYTES + 1],
        )
        .unwrap();

        let error = collect(&root).expect_err("oversized renderer source must fail");
        assert!(error.contains("单文件"), "unexpected error: {error}");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn renderer_source_reader_enforces_total_size_limit() {
        let root = temp_renderer("total-size");
        fs::create_dir_all(&root).unwrap();
        let chunk = vec![b'x'; RENDERER_MAX_SOURCE_FILE_BYTES];
        let file_count = RENDERER_MAX_TOTAL_SOURCE_BYTES / RENDERER_MAX_SOURCE_FILE_BYTES + 1;
        for index in 0..file_count {
            fs::write(root.join(format!("{index}.ts")), &chunk).unwrap();
        }

        let error = collect(&root).expect_err("oversized renderer source trees must fail");
        assert!(error.contains("总大小"), "unexpected error: {error}");

        let _ = fs::remove_dir_all(&root);
    }
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

pub(crate) fn create_renderer_from_template(
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

pub(crate) fn duplicate_renderer_inner(
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

pub(crate) fn rename_renderer_inner(
    project_root: &Path,
    old_id: &str,
    new_id: &str,
) -> Result<(), String> {
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

pub(crate) fn delete_renderer_inner(project_root: &Path, renderer_id: &str) -> Result<(), String> {
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

pub(crate) fn create_renderer(
    project_path: &str,
    renderer_id: &str,
    template_id: &str,
    template_dir: &Path,
) -> Result<(), String> {
    let project_root = ProjectRoot::open(Path::new(project_path))?;
    validate_plain_name(&template_id, "渲染层模板 id")?;
    if template_id != "default" {
        return Err(format!("未知渲染层模板: {template_id}"));
    }
    create_renderer_from_template(project_root.path(), renderer_id, template_dir)
}

pub(crate) fn duplicate_renderer(
    project_path: String,
    source_id: String,
    new_id: String,
) -> Result<(), String> {
    let project_root = ProjectRoot::open(Path::new(&project_path))?;
    duplicate_renderer_inner(project_root.path(), &source_id, &new_id)
}

pub(crate) fn rename_renderer(
    project_path: String,
    old_id: String,
    new_id: String,
) -> Result<(), String> {
    let project_root = ProjectRoot::open(Path::new(&project_path))?;
    rename_renderer_inner(project_root.path(), &old_id, &new_id)
}

pub(crate) fn delete_renderer(project_path: String, renderer_id: String) -> Result<(), String> {
    let project_root = ProjectRoot::open(Path::new(&project_path))?;
    delete_renderer_inner(project_root.path(), &renderer_id)
}

// ── 工具函数 ──────────────────────────────────────
use super::fs::{
    ensure_existing_path_within, resolve_relative_under, validate_plain_name, write_json,
    ProjectRoot,
};
use super::project::{copy_dir_all, ensure_copy_targets_available, read_project_meta};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
