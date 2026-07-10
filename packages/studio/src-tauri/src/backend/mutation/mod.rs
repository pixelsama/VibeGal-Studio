//! Project initialization and content mutation services.

/// 在 parent_dir 下创建新项目：建目录结构 + 复制默认渲染层模板 + 写 gal.project.json
pub(crate) fn create_project(
    parent_dir: &str,
    name: &str,
    default_renderer_dir: &Path,
) -> Result<PathBuf, String> {
    // 校验项目名：只允许文件名片段，禁止路径分隔符与 ..
    validate_plain_name(&name, "项目名")?;
    let parent_root = Path::new(&parent_dir)
        .canonicalize()
        .map_err(|e| format!("无法定位父目录 {}: {}", parent_dir, e))?;
    let project_path = parent_root.join(&name);
    if project_path.exists() {
        return Err(format!("目录已存在: {}", project_path.display()));
    }

    initialize_project_root(&project_path, name, default_renderer_dir)?;
    Ok(project_path)
}

/// 把用户选择的当前目录初始化为 VibeGal-Studio 项目。
pub(crate) fn initialize_project(
    path: &str,
    default_renderer_dir: &Path,
) -> Result<PathBuf, String> {
    let project_path = Path::new(&path)
        .canonicalize()
        .map_err(|e| format!("无法定位项目目录 {}: {}", path, e))?;
    if !project_path.is_dir() {
        return Err(format!("项目路径不是目录: {}", project_path.display()));
    }
    if project_path.join("gal.project.json").is_file() {
        return Ok(project_path);
    }

    let name = project_path
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| !n.is_empty())
        .unwrap_or("VibeGal-Studio Project")
        .to_string();
    initialize_project_root(&project_path, &name, &default_renderer_dir)?;
    Ok(project_path)
}

/// 保存单个文件（相对项目根的路径）。校验目标必须在项目目录内。
pub(crate) fn save_file(
    project_path: String,
    rel_path: String,
    content: String,
    expected_revision: Option<serde_json::Value>,
) -> Result<Option<FileRevision>, String> {
    let project_root = ProjectRoot::open(Path::new(&project_path))?;
    ensure_expected_revision(project_root.path(), &rel_path, expected_revision.clone())?;
    if let Some((schema, label)) = write_contract_for_path(&rel_path) {
        let value = serde_json::from_str::<serde_json::Value>(&content)
            .map_err(|error| format!("{label} JSON 解析失败: {error}"))?;
        match schema {
            contracts::ContractSchemaKind::Graph => {
                return save_graph(project_path, value, expected_revision);
            }
            contracts::ContractSchemaKind::Manifest => {
                return save_manifest(project_path, value, expected_revision);
            }
            _ => validate_write_contract(schema, &value, label)?,
        }
    }
    let safe_target = project_root.resolve_write_target(&rel_path)?;
    if let Some(parent) = safe_target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
        ensure_existing_path_within(project_root.path(), parent)?;
    }
    if safe_target.exists() {
        ensure_existing_path_within(project_root.path(), &safe_target)?;
    }
    atomic_write_text(&safe_target, &content)
        .map_err(|e| format!("写文件失败 ({}): {}", safe_target.display(), e))?;
    project_root.revision(&rel_path)
}

/// 保存 content/graph.json。节点文件生命周期由 save_file/delete_file 单独管理。
pub(crate) fn save_graph(
    project_path: String,
    graph: serde_json::Value,
    expected_revision: Option<serde_json::Value>,
) -> Result<Option<FileRevision>, String> {
    validate_write_contract(contracts::ContractSchemaKind::Graph, &graph, "graph")?;
    let project_root = ProjectRoot::open(Path::new(&project_path))?;
    let content_root = project_root.content_root()?;
    ensure_expected_revision(project_root.path(), "content/graph.json", expected_revision)?;

    for node in graph["nodes"].as_array().into_iter().flatten() {
        let node_file = node["file"].as_str().expect("validated graph node file");
        let node_path = content_root.resolve_write_target(node_file)?;
        if node_path.exists() {
            ensure_existing_path_within(content_root.path(), &node_path)?;
        }
    }

    let graph_path = content_root.resolve_write_target("graph.json")?;
    write_json(&graph_path, &graph)?;
    project_root.revision("content/graph.json")
}

fn validate_write_contract(
    schema: contracts::ContractSchemaKind,
    value: &serde_json::Value,
    label: &str,
) -> Result<(), String> {
    let violations = contracts::validate_schema(schema, value);
    if let Some(violation) = violations.first() {
        return Err(format!(
            "{label} 不符合内容契约（{} {}）",
            violation.json_path, violation.code
        ));
    }
    Ok(())
}

fn is_node_file_path(rel_path: &str) -> bool {
    let Ok(path) = safe_relative_path(rel_path) else {
        return false;
    };
    let mut components = path.components();
    matches!(components.next(), Some(Component::Normal(part)) if part == "content")
        && matches!(components.next(), Some(Component::Normal(part)) if part == "nodes")
        && components.clone().next().is_some()
        && path.extension().and_then(|extension| extension.to_str()) == Some("json")
}

fn write_contract_for_path(
    rel_path: &str,
) -> Option<(contracts::ContractSchemaKind, &'static str)> {
    let path = safe_relative_path(rel_path).ok()?;
    if path == Path::new("content/graph.json") {
        Some((contracts::ContractSchemaKind::Graph, "graph"))
    } else if path == Path::new("content/manifest.json") {
        Some((contracts::ContractSchemaKind::Manifest, "manifest"))
    } else if path == Path::new("content/meta.json") {
        Some((contracts::ContractSchemaKind::Meta, "meta"))
    } else if is_node_file_path(rel_path) {
        Some((contracts::ContractSchemaKind::NodeFile, "节点内容"))
    } else {
        None
    }
}

/// 只更新 graph.json 中指定节点的 position，保留外部新增/修改的其他节点和边。
pub(crate) fn save_graph_positions(
    project_path: String,
    updates: Vec<GraphPositionPatchInput>,
    expected_revision: Option<serde_json::Value>,
) -> Result<Option<FileRevision>, String> {
    let project_root = ProjectRoot::open(Path::new(&project_path))?;
    let content_root = project_root.content_root()?;
    let graph_path = content_root.resolve_existing_file("graph.json")?;
    let _ = parse_expected_revision(expected_revision)?;

    let mut graph = read_json(&graph_path)?;
    let nodes = graph
        .get_mut("nodes")
        .and_then(|value| value.as_array_mut())
        .ok_or_else(|| "graph.json 的 nodes 必须是数组".to_string())?;

    let positions_by_id = updates
        .into_iter()
        .map(|update| {
            if update.id.is_empty() {
                return Err("position patch 的 id 不能为空".to_string());
            }
            Ok((update.id, update.position))
        })
        .collect::<Result<HashMap<_, _>, String>>()?;

    for node in nodes {
        let Some(id) = node.get("id").and_then(|value| value.as_str()) else {
            continue;
        };
        let Some(position) = positions_by_id.get(id) else {
            continue;
        };
        let Some(node_object) = node.as_object_mut() else {
            continue;
        };
        node_object.insert(
            "position".to_string(),
            serde_json::json!({ "x": position.x, "y": position.y }),
        );
    }

    validate_write_contract(contracts::ContractSchemaKind::Graph, &graph, "graph")?;
    write_json(&graph_path, &graph)?;
    project_root.revision("content/graph.json")
}

/// 删除 content/ 下的单个文件。路径相对 content 根，缺失视为已删除。
pub(crate) fn delete_file(
    project_path: String,
    rel_path: String,
    expected_revision: Option<serde_json::Value>,
) -> Result<(), String> {
    delete_content_file_to_trash(project_path, rel_path, expected_revision, "delete_file")
}

fn delete_content_file_to_trash(
    project_path: String,
    rel_path: String,
    expected_revision: Option<serde_json::Value>,
    command: &str,
) -> Result<(), String> {
    let project_root = ProjectRoot::open(Path::new(&project_path))?;
    let content_root = project_root.content_root()?;
    let content_rel_path = safe_relative_path(&rel_path)?;
    let project_rel_path = PathBuf::from("content")
        .join(content_rel_path)
        .to_string_lossy()
        .replace('\\', "/");
    ensure_expected_revision(project_root.path(), &project_rel_path, expected_revision)?;
    let target = content_root.resolve(&rel_path)?;
    if target.exists() {
        ensure_existing_path_within(content_root.path(), &target)?;
        move_project_file_to_trash(project_root.path(), &target, &project_rel_path, command)?;
    }
    Ok(())
}

// ──────────────────────────────────────────────
// 资产管理命令（list / import / delete / save_manifest）
// 路径一律相对 content 根，与 manifest 引用路径一致。
// ──────────────────────────────────────────────

/// 列出 content/assets/ 下的所有资产文件（递归），含 kind 推断与大小。
pub(crate) fn list_assets(project_path: String) -> Result<Vec<AssetEntry>, String> {
    let content_root = ProjectRoot::open(Path::new(&project_path))?.content_root()?;
    list_asset_entries(&content_root)
}

/// 导入资产：把外部文件拷贝进 content/assets/。
/// - source_abs_path：来自对话框的外部文件绝对路径
/// - dest_rel_path：目标相对 content 根的路径，如 "assets/audio/bgm/battle.mp3"
/// 不静默覆盖已有文件（符合 AGENTS.md 保守用户文件原则）。
pub(crate) fn import_asset(
    project_path: String,
    source_abs_path: String,
    dest_rel_path: String,
) -> Result<(), String> {
    let content_root = ProjectRoot::open(Path::new(&project_path))?.content_root()?;

    // 目标必须在 content 内（防越界）
    let dest = content_root.resolve_write_target(&dest_rel_path)?;
    if dest.exists() {
        return Err(format!("目标文件已存在，未覆盖（{}）", dest.display()));
    }

    // 源文件必须存在且可读
    let source = Path::new(&source_abs_path);
    if !source.is_file() {
        return Err(format!("源文件不存在或不可读：{}", source.display()));
    }

    // 建父目录后再校验父目录仍在 content 内（防符号链接逃逸）
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
        ensure_existing_path_within(content_root.path(), parent)?;
    }

    let mut source_file = fs::File::open(source)
        .map_err(|e| format!("打开源文件失败 ({}): {}", source.display(), e))?;
    let mut destination_file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&dest)
        .map_err(|e| format!("创建目标文件失败 ({}): {}", dest.display(), e))?;
    if let Err(error) = std::io::copy(&mut source_file, &mut destination_file) {
        drop(destination_file);
        let _ = fs::remove_file(&dest);
        return Err(format!(
            "拷贝文件失败 ({} → {}): {}",
            source.display(),
            dest.display(),
            error
        ));
    }
    Ok(())
}

/// 删除 content/ 下的资产文件。路径相对 content 根，幂等（缺失视为已删除）。
/// 注意：此命令只删文件，manifest 条目的移除由 save_manifest 统一负责（单一写入点）。
pub(crate) fn delete_asset(
    project_path: String,
    rel_path: String,
    expected_revision: Option<serde_json::Value>,
) -> Result<(), String> {
    // 语义与 delete_file 完全一致（都是 content 根相对路径删文件）；
    // 单独命名是为了在前端语义上区分「删资产」与「删节点文件」。
    delete_content_file_to_trash(project_path, rel_path, expected_revision, "delete_asset")
}

/// 读取 content/ 下的图片资产，返回可直接用于 <img src> 的 data URL。
/// 前端资产缩略图走这个命令，而不是直接把本地磁盘路径暴露给 WebView。
pub(crate) fn read_asset_preview_data_url(
    project_path: String,
    rel_path: String,
) -> Result<String, String> {
    let content_root = ProjectRoot::open(Path::new(&project_path))?.content_root()?;
    let target = content_root.resolve_existing_file(&rel_path)?;

    let mime = preview_image_mime(&rel_path)
        .ok_or_else(|| format!("不支持预览的图片类型: {}", rel_path))?;
    let size = fs::metadata(&target)
        .map_err(|e| format!("读取资产信息失败 ({}): {}", target.display(), e))?
        .len();
    if size > MAX_ASSET_PREVIEW_BYTES {
        return Err(format!(
            "资产预览过大（{} bytes），超过 {} bytes",
            size, MAX_ASSET_PREVIEW_BYTES
        ));
    }

    let bytes =
        fs::read(&target).map_err(|e| format!("读取资产预览失败 ({}): {}", target.display(), e))?;
    Ok(format!(
        "data:{};base64,{}",
        mime,
        BASE64_STANDARD.encode(bytes)
    ))
}

fn preview_image_mime(rel_path: &str) -> Option<&'static str> {
    let ext = Path::new(rel_path)
        .extension()
        .and_then(|s| s.to_str())?
        .to_ascii_lowercase();
    match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "svg" => Some("image/svg+xml"),
        "bmp" => Some("image/bmp"),
        _ => None,
    }
}

/// 保存 content/manifest.json。原始 JSON 经过与读取相同的 embedded contract gate。
pub(crate) fn save_manifest(
    project_path: String,
    manifest: serde_json::Value,
    expected_revision: Option<serde_json::Value>,
) -> Result<Option<FileRevision>, String> {
    validate_write_contract(
        contracts::ContractSchemaKind::Manifest,
        &manifest,
        "manifest",
    )?;
    let project_root = ProjectRoot::open(Path::new(&project_path))?;
    let content_root = project_root.content_root()?;
    ensure_expected_revision(
        project_root.path(),
        "content/manifest.json",
        expected_revision,
    )?;

    let manifest_path = content_root.resolve_write_target("manifest.json")?;
    write_json(&manifest_path, &manifest)?;
    project_root.revision("content/manifest.json")
}

pub(crate) fn save_project_meta(
    project_path: String,
    meta: ProjectMeta,
    expected_revision: Option<serde_json::Value>,
) -> Result<Option<FileRevision>, String> {
    let project_root = ProjectRoot::open(Path::new(&project_path))?;
    ensure_expected_revision(project_root.path(), "gal.project.json", expected_revision)?;
    write_json(
        &project_root.path().join("gal.project.json"),
        &serde_json::to_value(&meta).unwrap(),
    )?;
    project_root.revision("gal.project.json")
}
use super::contracts;
use super::fs::{
    atomic_write_text, ensure_existing_path_within, ensure_expected_revision,
    move_project_file_to_trash, parse_expected_revision, read_json, safe_relative_path,
    validate_plain_name, write_json, ProjectRoot,
};
use super::model::{AssetEntry, FileRevision, GraphPositionPatchInput, ProjectMeta};
use super::project::{initialize_project_root, list_asset_entries};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::path::{Component, Path, PathBuf};

const MAX_ASSET_PREVIEW_BYTES: u64 = 16 * 1024 * 1024;
