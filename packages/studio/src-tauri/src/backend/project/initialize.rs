//! Conservative project initialization helpers.

use std::fs;
use std::path::Path;

pub(crate) fn ensure_initialization_targets_available(
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
        project_path.join(".galstudio/types/engine.d.ts"),
        project_path.join(".galstudio/types/react.d.ts"),
        project_path.join("tsconfig.json"),
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

pub(crate) fn ensure_copy_targets_available(src: &Path, dst: &Path) -> Result<(), String> {
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

pub(crate) fn chrono_now() -> String {
    // 简单的 RFC3339 风格时间戳，避免引入 chrono 依赖
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{}", secs)
}

/// 递归复制目录
pub(crate) fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
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

pub(crate) fn initialize_project_root(
    project_path: &Path,
    name: &str,
    default_renderer_dir: &Path,
) -> Result<(), String> {
    ensure_initialization_targets_available(project_path, default_renderer_dir)?;
    fs::create_dir_all(project_path.join("content/nodes"))
        .map_err(|e| format!("创建 content/nodes 失败: {}", e))?;
    fs::create_dir_all(project_path.join("content/assets"))
        .map_err(|e| format!("创建 content/assets 失败: {}", e))?;
    fs::create_dir_all(project_path.join("renderers/default"))
        .map_err(|e| format!("创建 renderers/default 失败: {}", e))?;

    write_json(
        &project_path.join("content/manifest.json"),
        &serde_json::json!({
            "characters": {},
            "backgrounds": {},
            "audio": { "bgm": {}, "sfx": {}, "voice": {} }
        }),
    )?;
    write_json(
        &project_path.join("content/meta.json"),
        &serde_json::json!({
            "title": name,
            "typingSpeedCps": 30,
            "autoAdvanceMs": 1200,
            "chapterGapMs": 1500,
            "stage": { "width": 1280, "height": 720 }
        }),
    )?;
    write_json(
        &project_path.join("content/graph.json"),
        &serde_json::json!({
            "version": 1,
            "entryNodeId": "start",
            "nodes": [{
                "id": "start",
                "title": "开始",
                "file": "nodes/start.json",
                "position": { "x": 120, "y": 120 }
            }],
            "edges": []
        }),
    )?;
    write_json(
        &project_path.join("content/nodes/start.json"),
        &serde_json::json!([{ "t": "narrate", "text": "新的故事从这里开始。" }]),
    )?;
    super::write_project_self_description(project_path)?;
    copy_dir_all(
        default_renderer_dir,
        &project_path.join("renderers/default"),
    )
    .map_err(|e| format!("复制渲染层模板失败: {}", e))?;

    let project_meta = ProjectMeta {
        name: name.to_string(),
        active_renderer_id: "default".to_string(),
        created_at: chrono_now(),
    };
    write_json(
        &project_path.join("gal.project.json"),
        &serde_json::to_value(&project_meta).unwrap(),
    )
}

use super::super::fs::write_json;
use super::super::model::ProjectMeta;
