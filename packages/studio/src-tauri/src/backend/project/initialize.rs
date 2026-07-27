//! Conservative project initialization helpers.

use super::super::identity::{assign_missing_story_point_ids, InstructionIdentityContext};
use std::fs;
use std::path::Path;

pub(crate) fn ensure_initialization_targets_available(
    project_path: &Path,
    renderer_id: &str,
    renderer_template_dir: &Path,
) -> Result<(), String> {
    ensure_project_shell_targets_available(project_path, renderer_id, renderer_template_dir)?;
    for path in [
        project_path.join("content/manifest.json"),
        project_path.join("content/meta.json"),
        project_path.join("content/graph.json"),
        project_path.join("content/variables.json"),
        project_path.join("content/nodes/start.json"),
    ] {
        ensure_can_create_file(&path)?;
    }
    Ok(())
}

fn ensure_project_shell_targets_available(
    project_path: &Path,
    renderer_id: &str,
    renderer_template_dir: &Path,
) -> Result<(), String> {
    for path in [
        project_path.join("gal.project.json"),
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
        project_path.join(".galstudio/schemas/fixture.json"),
        project_path.join(".galstudio/schemas/variables.json"),
        project_path.join(".galstudio/schemas/locale.json"),
    ] {
        ensure_can_create_file(&path)?;
    }
    ensure_copy_targets_available(
        renderer_template_dir,
        &project_path.join("renderers").join(renderer_id),
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
    renderer_id: &str,
    renderer_template_dir: &Path,
) -> Result<(), String> {
    ensure_initialization_targets_available(project_path, renderer_id, renderer_template_dir)?;
    fs::create_dir_all(project_path.join("content/nodes"))
        .map_err(|e| format!("创建 content/nodes 失败: {}", e))?;
    fs::create_dir_all(project_path.join("content/assets"))
        .map_err(|e| format!("创建 content/assets 失败: {}", e))?;
    fs::create_dir_all(project_path.join("renderers").join(renderer_id))
        .map_err(|e| format!("创建 renderers/{renderer_id} 失败: {e}"))?;

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
            "chapters": [{ "id": "chapter_1", "title": "第一章" }],
            "nodes": [{
                "id": "start",
                "title": "开始",
                "file": "nodes/start.json",
                "chapterId": "chapter_1",
                "position": { "x": 120, "y": 120 }
            }],
            "edges": []
        }),
    )?;
    write_json(
        &project_path.join("content/variables.json"),
        &serde_json::json!({ "version": 1, "variables": {} }),
    )?;
    let initial_node = assign_missing_story_point_ids(
        &serde_json::json!([{ "t": "narrate", "text": "新的故事从这里开始。" }]),
        &InstructionIdentityContext::new("content/nodes/start.json", "start"),
    )
    .map_err(|error| format!("初始化默认节点身份失败: {error}"))?;
    write_json(
        &project_path.join("content/nodes/start.json"),
        &initial_node.node,
    )?;
    write_project_shell(project_path, name, renderer_id, renderer_template_dir)
}

pub(crate) fn initialize_project_root_from_example(
    project_path: &Path,
    name: &str,
    renderer_id: &str,
    renderer_template_dir: &Path,
    example_content_dir: &Path,
) -> Result<(), String> {
    ensure_project_shell_targets_available(project_path, renderer_id, renderer_template_dir)?;
    ensure_copy_targets_available(example_content_dir, &project_path.join("content"))?;

    let meta_path = example_content_dir.join("meta.json");
    let mut meta = super::super::fs::read_json(&meta_path)?;
    let object = meta
        .as_object_mut()
        .ok_or_else(|| "示例内容 meta.json 必须是对象".to_string())?;
    object.insert(
        "title".to_string(),
        serde_json::Value::String(name.to_string()),
    );

    copy_dir_all(example_content_dir, &project_path.join("content"))
        .map_err(|e| format!("复制示例内容失败: {}", e))?;
    write_json(&project_path.join("content/meta.json"), &meta)?;

    write_project_shell(project_path, name, renderer_id, renderer_template_dir)
}

fn write_project_shell(
    project_path: &Path,
    name: &str,
    renderer_id: &str,
    renderer_template_dir: &Path,
) -> Result<(), String> {
    fs::create_dir_all(project_path.join("renderers").join(renderer_id))
        .map_err(|e| format!("创建 renderers/{renderer_id} 失败: {e}"))?;
    super::write_project_self_description(project_path)?;
    copy_dir_all(
        renderer_template_dir,
        &project_path.join("renderers").join(renderer_id),
    )
    .map_err(|e| format!("复制渲染层模板失败: {}", e))?;

    let project_meta = ProjectMeta {
        name: name.to_string(),
        active_renderer_id: renderer_id.to_string(),
        created_at: chrono_now(),
    };
    write_json(
        &project_path.join("gal.project.json"),
        &serde_json::to_value(&project_meta).unwrap(),
    )
}

use super::super::fs::write_json;
use super::super::model::ProjectMeta;
