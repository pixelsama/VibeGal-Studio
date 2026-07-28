//! Project initialization and content mutation services.

/// 在 parent_dir 下创建新项目：建目录结构 + 复制所选渲染层模板 + 写 gal.project.json
pub(crate) fn create_project(
    parent_dir: &str,
    name: &str,
    template: ProjectTemplate,
    renderer_template: RendererTemplate,
    renderer_template_dir: &Path,
    example_content_dir: &Path,
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

    let renderer_id = renderer_template.id();
    match template {
        ProjectTemplate::Blank => {
            initialize_project_root(&project_path, name, renderer_id, renderer_template_dir)?;
        }
        ProjectTemplate::Example => initialize_project_root_from_example(
            &project_path,
            name,
            renderer_id,
            renderer_template_dir,
            example_content_dir,
        )?,
    }
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
    initialize_project_root(&project_path, &name, "default", default_renderer_dir)?;
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
            contracts::ContractSchemaKind::Variables => {
                return save_variables(project_path, value, expected_revision);
            }
            contracts::ContractSchemaKind::Locale => {
                let locale = Path::new(&rel_path).file_stem().and_then(|stem| stem.to_str())
                    .ok_or_else(|| format!("非法语言文件路径: {rel_path}"))?.to_string();
                return save_locale(project_path, locale, value, expected_revision);
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

/// Save a graph-referenced node through the identity-aware persistence boundary.
pub(crate) fn save_node(
    project_path: String,
    node_file: String,
    instructions: serde_json::Value,
    expected_revision: Option<serde_json::Value>,
) -> Result<SaveNodeResult, String> {
    let project_root = ProjectRoot::open(Path::new(&project_path))?;
    let content_root = project_root.content_root()?;
    let graph = content_root.read_control_json("graph.json")?;
    validate_write_contract(contracts::ContractSchemaKind::Graph, &graph, "graph")?;

    let matches = graph["nodes"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|node| node.get("file").and_then(serde_json::Value::as_str) == Some(&node_file))
        .collect::<Vec<_>>();
    if matches.len() != 1 {
        return Err(format!(
            "node file must be referenced by exactly one graph node: {node_file}"
        ));
    }
    let node_id = matches[0]["id"]
        .as_str()
        .expect("validated graph node id")
        .to_string();
    let node_path = content_root.resolve_write_target(&node_file)?;
    let project_rel_path = PathBuf::from("content")
        .join(safe_relative_path(&node_file)?)
        .to_string_lossy()
        .replace('\\', "/");
    ensure_expected_revision(project_root.path(), &project_rel_path, expected_revision)?;

    let assignment = assign_missing_story_point_ids(
        &instructions,
        &InstructionIdentityContext::new(project_rel_path.clone(), node_id.clone()),
    )
    .map_err(|error| format!("instruction ID assignment failed: {error}"))?;
    let variables = if content_root.path().join("variables.json").is_file() {
        content_root.read_control_json("variables.json")?
    } else {
        serde_json::json!({ "version": 1, "variables": {} })
    };
    let normalized_node = assign_missing_persistent_effect_ids(assignment.node, &variables, &project_rel_path, &node_id);
    validate_write_contract(
        contracts::ContractSchemaKind::NodeFile,
        &normalized_node,
        "节点内容",
    )?;
    write_json(&node_path, &normalized_node)?;
    let revision = project_root
        .revision(&project_rel_path)?
        .ok_or_else(|| format!("failed to read saved node revision: {project_rel_path}"))?;
    let serialized_text = serde_json::to_string_pretty(&normalized_node)
        .map_err(|error| format!("serialize saved node failed: {error}"))?;

    Ok(SaveNodeResult {
        instructions: normalized_node,
        serialized_text,
        revision,
        assigned: assignment.assigned,
    })
}

fn assign_missing_persistent_effect_ids(
    node: serde_json::Value,
    variables: &serde_json::Value,
    file: &str,
    node_id: &str,
) -> serde_json::Value {
    let globals = variables.get("variables").and_then(serde_json::Value::as_object);
    let mut instructions = node.as_array().cloned().unwrap_or_default();
    for (index, instruction) in instructions.iter_mut().enumerate() {
        let persistent = instruction.get("t").and_then(serde_json::Value::as_str) == Some("completeEnding")
            || (instruction.get("t").and_then(serde_json::Value::as_str) == Some("set")
                && instruction.get("key").and_then(serde_json::Value::as_str).and_then(|key| globals.and_then(|items| items.get(key))).and_then(|declaration| declaration.get("scope")).and_then(serde_json::Value::as_str) == Some("global"));
        if !persistent || instruction.get("id").and_then(serde_json::Value::as_str).is_some_and(|id| !id.is_empty()) { continue; }
        let seed = format!("{file}:{node_id}:{index}:{}", instruction.get("t").and_then(serde_json::Value::as_str).unwrap_or("effect"));
        use sha2::{Digest, Sha256};
        let digest = format!("{:x}", Sha256::digest(seed.as_bytes()));
        let id = format!("pe_{}", &digest[..16]);
        instruction.as_object_mut().expect("validated instruction object").insert("id".to_string(), serde_json::Value::String(id));
    }
    serde_json::Value::Array(instructions)
}

/// 保存 content/graph.json。节点文件生命周期由 save_file/delete_file 单独管理。
pub(crate) fn save_graph(
    project_path: String,
    graph: serde_json::Value,
    expected_revision: Option<serde_json::Value>,
) -> Result<Option<FileRevision>, String> {
    validate_write_contract(contracts::ContractSchemaKind::Graph, &graph, "graph")?;
    validate_graph_chapter_references(&graph)?;
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

fn validate_graph_chapter_references(graph: &serde_json::Value) -> Result<(), String> {
    let chapter_ids = graph["chapters"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|chapter| chapter["id"].as_str())
        .collect::<std::collections::HashSet<_>>();
    for (index, node) in graph["nodes"].as_array().into_iter().flatten().enumerate() {
        let chapter_id = node["chapterId"]
            .as_str()
            .expect("validated graph node chapterId");
        if !chapter_ids.contains(chapter_id) {
            return Err(format!(
                "graph 不符合内容契约（$.nodes[{index}].chapterId missing_chapter_ref）"
            ));
        }
    }
    Ok(())
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

pub(crate) fn validate_node_contract(value: &serde_json::Value) -> Result<(), String> {
    validate_write_contract(contracts::ContractSchemaKind::NodeFile, value, "节点内容")
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

fn is_locale_file_path(rel_path: &str) -> bool {
    let Ok(path) = safe_relative_path(rel_path) else { return false };
    let mut components = path.components();
    matches!(components.next(), Some(Component::Normal(part)) if part == "content")
        && matches!(components.next(), Some(Component::Normal(part)) if part == "locales")
        && matches!(components.next(), Some(Component::Normal(_)))
        && components.next().is_none()
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
    } else if path == Path::new("content/variables.json") {
        Some((contracts::ContractSchemaKind::Variables, "variables"))
    } else if is_locale_file_path(rel_path) {
        Some((contracts::ContractSchemaKind::Locale, "语言表"))
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

/// 读取有界缩略图。位图在 Rust 侧解码并缩放，避免每个资产卡片把完整原图送进 WebView；
/// SVG 在 WebView 中天然按目标盒子缩放；GIF 缩略图只取首帧，避免传输完整动画。
pub(crate) fn read_asset_thumbnail_data_url(
    project_path: String,
    rel_path: String,
    max_size: u32,
) -> Result<String, String> {
    if !(32..=1024).contains(&max_size) {
        return Err(format!("缩略图尺寸必须在 32 到 1024 之间: {max_size}"));
    }
    let content_root = ProjectRoot::open(Path::new(&project_path))?.content_root()?;
    let target = content_root.resolve_existing_file(&rel_path)?;
    let mime = preview_image_mime(&rel_path)
        .ok_or_else(|| format!("不支持预览的图片类型: {rel_path}"))?;
    let size = fs::metadata(&target)
        .map_err(|e| format!("读取资产信息失败 ({}): {}", target.display(), e))?
        .len();
    if size > MAX_ASSET_PREVIEW_BYTES {
        return Err(format!(
            "资产预览过大（{} bytes），超过 {} bytes",
            size, MAX_ASSET_PREVIEW_BYTES
        ));
    }

    if mime == "image/svg+xml" {
        let bytes = fs::read(&target)
            .map_err(|e| format!("读取资产预览失败 ({}): {}", target.display(), e))?;
        return Ok(format!("data:{mime};base64,{}", BASE64_STANDARD.encode(bytes)));
    }

    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_ASSET_PREVIEW_DIMENSION);
    limits.max_image_height = Some(MAX_ASSET_PREVIEW_DIMENSION);
    limits.max_alloc = Some(MAX_ASSET_PREVIEW_ALLOC_BYTES);
    let mut reader = image::ImageReader::open(&target)
        .map_err(|error| format!("读取资产预览失败 ({}): {error}", target.display()))?;
    reader.limits(limits);
    let image = reader
        .decode()
        .map_err(|error| format!("解码资产预览失败 ({}): {error}", target.display()))?;
    let thumbnail = image.thumbnail(max_size, max_size);
    let mut bytes = std::io::Cursor::new(Vec::new());
    thumbnail
        .write_to(&mut bytes, image::ImageFormat::Png)
        .map_err(|error| format!("生成资产缩略图失败 ({}): {error}", target.display()))?;
    Ok(format!(
        "data:image/png;base64,{}",
        BASE64_STANDARD.encode(bytes.into_inner())
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

pub(crate) fn save_variables(
    project_path: String,
    variables: serde_json::Value,
    expected_revision: Option<serde_json::Value>,
) -> Result<Option<FileRevision>, String> {
    validate_write_contract(contracts::ContractSchemaKind::Variables, &variables, "variables")?;
    let project_root = ProjectRoot::open(Path::new(&project_path))?;
    let content_root = project_root.content_root()?;
    ensure_expected_revision(project_root.path(), "content/variables.json", expected_revision)?;
    write_json(&content_root.resolve_write_target("variables.json")?, &variables)?;
    project_root.revision("content/variables.json")
}

pub(crate) fn save_locale(
    project_path: String,
    locale: String,
    value: serde_json::Value,
    expected_revision: Option<serde_json::Value>,
) -> Result<Option<FileRevision>, String> {
    validate_plain_name(&locale, "语言标签")?;
    let canonical_locale = contracts::canonicalize_locale_tag(&locale)
        .ok_or_else(|| format!("语言标签不是有效的 BCP 47 标签: {locale}"))?;
    if canonical_locale != locale {
        return Err(format!("语言标签必须使用规范大小写: {canonical_locale}"));
    }
    validate_write_contract(contracts::ContractSchemaKind::Locale, &value, "语言表")?;
    let project_root = ProjectRoot::open(Path::new(&project_path))?;
    let content_root = project_root.content_root()?;
    let content_rel_path = format!("locales/{locale}.json");
    let project_rel_path = format!("content/{content_rel_path}");
    ensure_expected_revision(project_root.path(), &project_rel_path, expected_revision)?;
    let target = content_root.resolve_write_target(&content_rel_path)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建语言目录失败: {error}"))?;
        ensure_existing_path_within(content_root.path(), parent)?;
    }
    write_json(&target, &value)?;
    project_root.revision(&project_rel_path)
}

/// Rename a declared variable and rewrite every reference to it, atomically.
///
/// Renaming touches three kinds of file at once: the registry, every graph edge
/// condition, and every `set` instruction across all node files. The frontend
/// cannot do this safely — each save command carries its own revision guard, so
/// a mid-sequence failure would leave the project half-renamed, with conditions
/// pointing at a variable that no longer exists.
///
/// Everything is validated and staged in memory first; nothing is written until
/// every document is known-good.
pub(crate) fn rename_variable(
    project_path: String,
    from: String,
    to: String,
) -> Result<RenameVariableResult, String> {
    if from == to {
        return Err("新旧名称相同".to_string());
    }
    if to.trim().is_empty() {
        return Err("新名称不能为空".to_string());
    }

    let project_root = ProjectRoot::open(Path::new(&project_path))?;
    let content_root = project_root.content_root()?;

    // ── 1. 注册表：改键，保持插入顺序之外的一切不变 ──
    let variables_path = content_root.resolve_write_target("variables.json")?;
    let mut variables: serde_json::Value = read_json(&variables_path)?;
    let table = variables
        .get_mut("variables")
        .and_then(serde_json::Value::as_object_mut)
        .ok_or_else(|| "variables.json 结构不正确".to_string())?;
    if !table.contains_key(&from) {
        return Err(format!("变量 {from} 不存在"));
    }
    if table.contains_key(&to) {
        return Err(format!("变量 {to} 已存在"));
    }
    let declaration = table.remove(&from).expect("checked above");
    table.insert(to.clone(), declaration);
    validate_write_contract(contracts::ContractSchemaKind::Variables, &variables, "variables")?;

    // ── 2. 图：改写 auto 边条件 ──
    let graph_path = content_root.resolve_write_target("graph.json")?;
    let mut graph: serde_json::Value = read_json(&graph_path)?;
    let mut condition_updates = 0usize;
    let mut effect_updates = 0usize;
    for edge in graph
        .get_mut("edges")
        .and_then(serde_json::Value::as_array_mut)
        .into_iter()
        .flatten()
    {
        if let Some(condition) = edge.get("condition").and_then(serde_json::Value::as_str) {
            let rewritten = validation::rename_identifier(condition, &from, &to)?;
            if rewritten != condition {
                condition_updates += 1;
                edge["condition"] = serde_json::Value::String(rewritten);
            }
        }
        // 出口效果里的 set 也要跟着改名，否则改完名字这些效果会写到一个不存在的状态上。
        for effect in edge
            .get_mut("effects")
            .and_then(serde_json::Value::as_array_mut)
            .into_iter()
            .flatten()
        {
            let mut touched = false;
            if effect.get("key").and_then(serde_json::Value::as_str) == Some(from.as_str()) {
                effect["key"] = serde_json::Value::String(to.clone());
                touched = true;
            }
            if let Some(expression) = effect.get("expr").and_then(serde_json::Value::as_str) {
                let rewritten = validation::rename_identifier(expression, &from, &to)?;
                if rewritten != expression {
                    effect["expr"] = serde_json::Value::String(rewritten);
                    touched = true;
                }
            }
            if touched {
                effect_updates += 1;
            }
        }
    }
    validate_write_contract(contracts::ContractSchemaKind::Graph, &graph, "graph")?;

    // ── 3. 节点：改写 set 指令的目标与赋值表达式 ──
    let mut node_updates = 0usize;
    let mut staged_nodes: Vec<(PathBuf, serde_json::Value)> = vec![];
    for node in graph["nodes"].as_array().into_iter().flatten() {
        let Some(file) = node["file"].as_str() else { continue };
        let node_path = content_root.resolve_write_target(file)?;
        if !node_path.exists() {
            continue;
        }
        ensure_existing_path_within(content_root.path(), &node_path)?;
        let mut instructions: serde_json::Value = read_json(&node_path)?;
        let mut changed = false;
        for instruction in instructions.as_array_mut().into_iter().flatten() {
            if instruction.get("t").and_then(serde_json::Value::as_str) != Some("set") {
                continue;
            }
            if instruction.get("key").and_then(serde_json::Value::as_str) == Some(from.as_str()) {
                instruction["key"] = serde_json::Value::String(to.clone());
                changed = true;
            }
            if let Some(expression) = instruction.get("expr").and_then(serde_json::Value::as_str) {
                let rewritten = validation::rename_identifier(expression, &from, &to)?;
                if rewritten != expression {
                    instruction["expr"] = serde_json::Value::String(rewritten);
                    changed = true;
                }
            }
        }
        if changed {
            validate_node_contract(&instructions)?;
            node_updates += 1;
            staged_nodes.push((node_path, instructions));
        }
    }

    // ── 4. 全部校验通过后才落盘 ──
    write_json(&variables_path, &variables)?;
    write_json(&graph_path, &graph)?;
    for (path, instructions) in &staged_nodes {
        write_json(path, instructions)?;
    }

    Ok(RenameVariableResult {
        variables_revision: project_root.revision("content/variables.json")?,
        graph_revision: project_root.revision("content/graph.json")?,
        updated_conditions: condition_updates,
        updated_edge_effects: effect_updates,
        updated_nodes: node_updates,
    })
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
use super::validation;
use super::fs::{
    atomic_write_text, ensure_existing_path_within, ensure_expected_revision,
    move_project_file_to_trash, parse_expected_revision, read_json, safe_relative_path,
    validate_plain_name, write_json, ProjectRoot,
};
use super::identity::{
    assign_missing_story_point_ids, AssignedInstructionId, InstructionIdentityContext,
};
use super::model::{
    AssetEntry, FileRevision, GraphPositionPatchInput, ProjectMeta, ProjectTemplate,
    RendererTemplate,
};
use super::project::{
    initialize_project_root, initialize_project_root_from_example, list_asset_entries,
};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::path::{Component, Path, PathBuf};

const MAX_ASSET_PREVIEW_BYTES: u64 = 16 * 1024 * 1024;
const MAX_ASSET_PREVIEW_DIMENSION: u32 = 16_384;
const MAX_ASSET_PREVIEW_ALLOC_BYTES: u64 = 128 * 1024 * 1024;

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RenameVariableResult {
    pub variables_revision: Option<FileRevision>,
    pub graph_revision: Option<FileRevision>,
    pub updated_conditions: usize,
    /// 出口效果里被改写的 set 条数，与条件分开计数便于向作者交代改了什么。
    pub updated_edge_effects: usize,
    pub updated_nodes: usize,
}

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SaveNodeResult {
    pub instructions: serde_json::Value,
    pub serialized_text: String,
    pub revision: FileRevision,
    pub assigned: Vec<AssignedInstructionId>,
}
