//! Project filesystem capabilities, revisions, atomic writes, and trash operations.

/// Canonical, capability-scoped project directory. Construction checks the
/// project control file and content root before any filesystem operation.
#[derive(Clone, Debug)]
pub(crate) struct ProjectRoot(PathBuf);

impl ProjectRoot {
    pub(crate) fn open(project_path: &Path) -> Result<Self, String> {
        let root = project_path
            .canonicalize()
            .map_err(|e| format!("无法定位项目目录 {}: {}", project_path.display(), e))?;
        if !root.is_dir() {
            return Err(format!("项目路径不是目录: {}", root.display()));
        }
        let control = root.join("gal.project.json");
        reject_symlink(&control, "gal.project.json")?;
        if !control.is_file() {
            return Err(format!(
                "不是 VibeGal-Studio 项目目录（缺少 gal.project.json）: {}",
                root.display()
            ));
        }
        Ok(Self(root))
    }

    pub(crate) fn path(&self) -> &Path {
        &self.0
    }

    pub(crate) fn content_root(&self) -> Result<ContentRoot, String> {
        ContentRoot::open_at(&self.0)
    }

    pub(crate) fn read_project_json(&self) -> Result<serde_json::Value, String> {
        read_json(&self.0.join("gal.project.json"))
    }

    pub(crate) fn revision(&self, rel_path: &str) -> Result<Option<FileRevision>, String> {
        file_revision(&self.0, rel_path)
    }

    pub(crate) fn resolve_write_target(&self, rel: &str) -> Result<PathBuf, String> {
        let target = resolve_relative_under(&self.0, rel)?;
        if target.exists() {
            ensure_existing_path_within(&self.0, &target)?;
        }
        Ok(target)
    }
}

/// Canonical project-local content capability. Symlinks are forbidden for the
/// root itself and for every existing component resolved beneath it.
#[derive(Clone, Debug)]
pub(crate) struct ContentRoot(PathBuf);

impl ContentRoot {
    fn open_at(project_root: &Path) -> Result<Self, String> {
        let lexical = project_root.join("content");
        reject_symlink(&lexical, "content")?;
        let root = lexical
            .canonicalize()
            .map_err(|e| format!("无法定位 content 目录 {}: {}", lexical.display(), e))?;
        if !root.is_dir() || !root.starts_with(project_root) {
            return Err(format!("content 目录不安全: {}", lexical.display()));
        }
        Ok(Self(root))
    }

    pub(crate) fn path(&self) -> &Path {
        &self.0
    }

    pub(crate) fn resolve(&self, rel: &str) -> Result<PathBuf, String> {
        resolve_relative_under(&self.0, rel)
    }

    pub(crate) fn read_control_json(&self, rel: &str) -> Result<serde_json::Value, String> {
        read_json(&self.resolve(rel)?)
    }

    pub(crate) fn resolve_existing_file(&self, rel: &str) -> Result<PathBuf, String> {
        let target = self.resolve(rel)?;
        ensure_existing_path_within(&self.0, &target)?;
        if !target.is_file() {
            return Err(format!(
                "项目内容文件不存在或不是文件: {}",
                target.display()
            ));
        }
        Ok(target)
    }

    pub(crate) fn resolve_write_target(&self, rel: &str) -> Result<PathBuf, String> {
        let target = self.resolve(rel)?;
        if target.exists() {
            ensure_existing_path_within(&self.0, &target)?;
        }
        Ok(target)
    }
}

fn reject_symlink(path: &Path, label: &str) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err(format!("拒绝符号链接 {}: {}", label, path.display()))
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("无法检查{} {}: {}", label, path.display(), error)),
    }
}

pub(crate) fn validate_plain_name(name: &str, label: &str) -> Result<(), String> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name == ".."
        || name == "."
        || name.contains('\0')
    {
        return Err(format!("非法{}: {:?}", label, name));
    }
    Ok(())
}

pub(crate) fn safe_relative_path(rel: &str) -> Result<PathBuf, String> {
    if rel.is_empty() || rel.contains('\0') {
        return Err(format!("非法相对路径: {:?}", rel));
    }
    let path = Path::new(rel);
    if path.is_absolute() {
        return Err(format!("禁止绝对路径: {}", rel));
    }

    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!("路径越界：{}", rel));
            }
        }
    }
    if out.as_os_str().is_empty() {
        return Err(format!("非法相对路径: {:?}", rel));
    }
    Ok(out)
}

pub(crate) fn resolve_relative_under(base_canon: &Path, rel: &str) -> Result<PathBuf, String> {
    let safe = safe_relative_path(rel)?;
    let mut current = base_canon.to_path_buf();
    for component in safe.components() {
        let Component::Normal(part) = component else {
            continue;
        };
        current.push(part);
        reject_symlink(&current, "项目内容路径")?;
    }
    Ok(base_canon.join(safe))
}

pub(crate) fn ensure_existing_path_within(base_canon: &Path, target: &Path) -> Result<(), String> {
    reject_symlink(target, "项目文件")?;
    let target_canon = target
        .canonicalize()
        .map_err(|e| format!("无法定位路径 {}: {}", target.display(), e))?;
    if !target_canon.starts_with(base_canon) {
        return Err(format!(
            "路径越界：{} 不在项目目录 {} 内（可能的路径穿越攻击）",
            target.display(),
            base_canon.display()
        ));
    }
    Ok(())
}

pub(crate) fn file_revision(
    project_root: &Path,
    rel_path: &str,
) -> Result<Option<FileRevision>, String> {
    let project_root = project_root
        .canonicalize()
        .map_err(|e| format!("无法定位项目目录 {}: {}", project_root.display(), e))?;
    let target = resolve_relative_under(&project_root, rel_path)?;
    if !target.exists() {
        return Ok(None);
    }
    ensure_existing_path_within(&project_root, &target)?;
    let metadata = fs::metadata(&target)
        .map_err(|e| format!("读取文件信息失败 {}: {}", target.display(), e))?;
    if !metadata.is_file() {
        return Ok(None);
    }
    let modified = metadata
        .modified()
        .map_err(|e| format!("读取文件修改时间失败 {}: {}", target.display(), e))?;
    let mtime_ms = modified
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs_f64() * 1000.0)
        .unwrap_or(0.0);
    Ok(Some(FileRevision {
        rel_path: rel_path.replace('\\', "/"),
        mtime_ms,
        size: metadata.len(),
        sha256: None,
    }))
}

pub(crate) enum RevisionExpectation {
    Unchecked,
    Missing,
    Present(FileRevision),
}

pub(crate) fn parse_expected_revision(
    expected_revision: Option<serde_json::Value>,
) -> Result<RevisionExpectation, String> {
    match expected_revision {
        None => Ok(RevisionExpectation::Unchecked),
        Some(serde_json::Value::Null) => Ok(RevisionExpectation::Missing),
        Some(value) => serde_json::from_value::<FileRevision>(value)
            .map(RevisionExpectation::Present)
            .map_err(|e| format!("expectedRevision 格式错误: {}", e)),
    }
}

pub(crate) fn ensure_expected_revision(
    project_root: &Path,
    rel_path: &str,
    expected_revision: Option<serde_json::Value>,
) -> Result<(), String> {
    match parse_expected_revision(expected_revision)? {
        RevisionExpectation::Unchecked => Ok(()),
        RevisionExpectation::Missing => {
            let current = file_revision(project_root, rel_path)?;
            if current.is_none() {
                Ok(())
            } else {
                Err(write_conflict_error(rel_path, current))
            }
        }
        RevisionExpectation::Present(expected) => {
            let current = file_revision(project_root, rel_path)?;
            match current {
                Some(current) if revisions_match(&expected, &current) => Ok(()),
                other => Err(write_conflict_error(rel_path, other)),
            }
        }
    }
}

fn revisions_match(expected: &FileRevision, current: &FileRevision) -> bool {
    expected.rel_path == current.rel_path
        && expected.size == current.size
        && (expected.mtime_ms - current.mtime_ms).abs() < 0.001
}

fn write_conflict_error(rel_path: &str, current_revision: Option<FileRevision>) -> String {
    serde_json::json!({
        "code": "write_conflict",
        "message": format!("文件已被外部修改，未覆盖：{}", rel_path),
        "file": rel_path,
        "currentRevision": current_revision,
    })
    .to_string()
}

fn now_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0)
}

fn atomic_write_bytes(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("目标文件缺少父目录: {}", path.display()))?;
    fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("file");
    let mut last_error = None;

    for attempt in 0..100 {
        let tmp_path = parent.join(format!(
            ".galstudio-tmp-{}-{}-{}-{}",
            file_name,
            std::process::id(),
            now_nanos(),
            attempt
        ));
        let open_result = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp_path);
        let mut file = match open_result {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!(
                    "创建临时文件失败 ({}): {}",
                    tmp_path.display(),
                    error
                ))
            }
        };

        let write_result = file.write_all(bytes).and_then(|_| file.sync_all());
        drop(file);
        if let Err(error) = write_result {
            let _ = fs::remove_file(&tmp_path);
            return Err(format!(
                "写临时文件失败 ({}): {}",
                tmp_path.display(),
                error
            ));
        }

        match fs::rename(&tmp_path, path) {
            Ok(()) => return Ok(()),
            Err(error) => {
                let _ = fs::remove_file(&tmp_path);
                last_error = Some(error);
            }
        }
    }

    Err(format!(
        "替换文件失败 ({}): {}",
        path.display(),
        last_error
            .map(|e| e.to_string())
            .unwrap_or_else(|| "无法创建唯一临时文件".to_string())
    ))
}

pub(crate) fn atomic_write_text(path: &Path, text: &str) -> Result<(), String> {
    atomic_write_bytes(path, text.as_bytes())
}

pub(crate) fn move_project_file_to_trash(
    project_root: &Path,
    source: &Path,
    project_rel_path: &str,
    command: &str,
) -> Result<(), String> {
    ensure_existing_path_within(project_root, source)?;
    let metadata = fs::metadata(source)
        .map_err(|e| format!("读取文件信息失败 {}: {}", source.display(), e))?;
    if !metadata.is_file() {
        return Err(format!("删除目标不是文件: {}", source.display()));
    }

    let deleted_at = now_nanos().to_string();
    let trash_dir = project_root.join(".galstudio/trash").join(&deleted_at);
    let trash_target = trash_dir.join(safe_relative_path(project_rel_path)?);
    if let Some(parent) = trash_target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建 trash 目录失败: {}", e))?;
    }
    fs::rename(source, &trash_target).map_err(|e| {
        format!(
            "移动文件到 trash 失败 ({} → {}): {}",
            source.display(),
            trash_target.display(),
            e
        )
    })?;

    write_json(
        &trash_dir.join("trash.json"),
        &serde_json::json!({
            "originalPath": project_rel_path,
            "deletedAt": deleted_at,
            "command": command,
            "size": metadata.len(),
        }),
    )
}

pub(crate) fn read_json(path: &Path) -> Result<serde_json::Value, String> {
    reject_symlink(path, "JSON 文件")?;
    let text =
        fs::read_to_string(path).map_err(|e| format!("读取失败 ({}): {}", path.display(), e))?;
    serde_json::from_str(&text).map_err(|e| format!("解析 JSON 失败 ({}): {}", path.display(), e))
}

pub(crate) fn write_json(path: &Path, value: &serde_json::Value) -> Result<(), String> {
    reject_symlink(path, "JSON 文件")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    let text = serde_json::to_string_pretty(value).map_err(|e| format!("序列化失败: {}", e))?;
    atomic_write_text(path, &text).map_err(|e| format!("写文件失败 ({}): {}", path.display(), e))
}

pub(crate) fn write_text_file(path: &Path, text: &str) -> Result<(), String> {
    reject_symlink(path, "文本文件")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    atomic_write_text(path, text).map_err(|e| format!("写文件失败 ({}): {}", path.display(), e))
}

use super::model::FileRevision;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
