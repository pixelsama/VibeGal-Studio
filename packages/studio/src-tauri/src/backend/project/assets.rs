//! Filesystem-backed asset discovery under a validated content capability.

use super::super::fs::{ensure_existing_path_within, file_revision, ContentRoot};
use super::super::model::{AssetEntry, AssetKind};
use std::fs;
use std::path::Path;

fn collect_asset_files(
    content_root: &ContentRoot,
    dir: &Path,
    out: &mut Vec<AssetEntry>,
) -> Result<(), String> {
    let entries =
        fs::read_dir(dir).map_err(|e| format!("读取目录失败 {}: {}", dir.display(), e))?;
    for entry_result in entries {
        let entry =
            entry_result.map_err(|e| format!("读取资产目录项失败 {}: {}", dir.display(), e))?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|e| format!("读取资产路径信息失败 {}: {}", path.display(), e))?;
        if metadata.file_type().is_symlink() {
            return Err(format!("资产目录不能包含符号链接: {}", path.display()));
        }
        ensure_existing_path_within(content_root.path(), &path)?;
        if metadata.is_dir() {
            collect_asset_files(content_root, &path, out)?;
        } else if metadata.is_file() {
            let rel = path
                .strip_prefix(content_root.path())
                .map_err(|_| format!("资产路径越界: {}", path.display()))?
                .to_string_lossy()
                .replace('\\', "/");
            let project_root = content_root
                .path()
                .parent()
                .ok_or_else(|| format!("无法定位项目根目录: {}", content_root.path().display()))?;
            out.push(AssetEntry {
                size: metadata.len(),
                kind: AssetKind::from_rel_path(&rel),
                revision: file_revision(project_root, &format!("content/{rel}"))?,
                rel_path: rel,
            });
        }
    }
    Ok(())
}

pub(crate) fn list_asset_entries(content_root: &ContentRoot) -> Result<Vec<AssetEntry>, String> {
    let assets_dir = content_root.resolve("assets")?;
    let metadata = match fs::symlink_metadata(&assets_dir) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(error) => {
            return Err(format!(
                "读取资产目录信息失败 {}: {}",
                assets_dir.display(),
                error
            ))
        }
    };
    if metadata.file_type().is_symlink() {
        return Err(format!(
            "assets 目录不能是符号链接: {}",
            assets_dir.display()
        ));
    }
    if !metadata.is_dir() {
        return Ok(vec![]);
    }
    ensure_existing_path_within(content_root.path(), &assets_dir)?;
    let mut entries = vec![];
    collect_asset_files(content_root, &assets_dir, &mut entries)?;
    entries.sort_by(|a, b| {
        a.kind
            .as_str()
            .cmp(b.kind.as_str())
            .then_with(|| a.rel_path.cmp(&b.rel_path))
    });
    Ok(entries)
}
