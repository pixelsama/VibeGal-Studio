/// 在 parent_dir 下创建新项目：建目录结构 + 复制默认渲染层模板 + 写 gal.project.json
#[tauri::command]
fn create_project(
    parent_dir: String,
    name: String,
    app_handle: tauri::AppHandle,
) -> Result<ProjectData, String> {
    // 校验项目名：只允许文件名片段，禁止路径分隔符与 ..
    validate_plain_name(&name, "项目名")?;
    let parent_root = Path::new(&parent_dir)
        .canonicalize()
        .map_err(|e| format!("无法定位父目录 {}: {}", parent_dir, e))?;
    let project_path = parent_root.join(&name);
    if project_path.exists() {
        return Err(format!("目录已存在: {}", project_path.display()));
    }

    let default_renderer_dir = default_renderer_dir(&app_handle)?;
    initialize_project_root(&project_path, &name, &default_renderer_dir)?;

    // 重新读出来返回，同时把 content/ 加进 asset protocol scope。
    open_project_for_app(project_path.to_string_lossy().as_ref(), &app_handle)
}

/// 把用户选择的当前目录初始化为 VibeGal-Studio 项目。
#[tauri::command]
fn initialize_project(path: String, app_handle: tauri::AppHandle) -> Result<ProjectData, String> {
    let project_path = Path::new(&path)
        .canonicalize()
        .map_err(|e| format!("无法定位项目目录 {}: {}", path, e))?;
    if !project_path.is_dir() {
        return Err(format!("项目路径不是目录: {}", project_path.display()));
    }
    if project_path.join("gal.project.json").is_file() {
        return open_project_for_app(project_path.to_string_lossy().as_ref(), &app_handle);
    }

    let name = project_path
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| !n.is_empty())
        .unwrap_or("VibeGal-Studio Project")
        .to_string();
    let default_renderer_dir = default_renderer_dir(&app_handle)?;
    initialize_project_root(&project_path, &name, &default_renderer_dir)?;
    open_project_for_app(project_path.to_string_lossy().as_ref(), &app_handle)
}

/// 监听项目目录内的数据/渲染层变化，debounce 后向前端发 project_changed 事件。
#[tauri::command]
fn watch_project(
    project_path: String,
    app_handle: tauri::AppHandle,
    watchers: tauri::State<'_, ProjectWatchers>,
) -> Result<(), String> {
    let root = canonical_project_root(Path::new(&project_path))?;
    let root_key = root.to_string_lossy().into_owned();

    let mut active = watchers
        .active
        .lock()
        .map_err(|_| "项目监听器状态已损坏".to_string())?;
    if active.contains_key(&root_key) {
        return Ok(());
    }

    let (tx, rx) = mpsc::channel::<WatchSignal>();
    let event_tx = tx.clone();
    let event_root = root.clone();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
        let Ok(event) = result else {
            return;
        };
        let mut relevant = false;
        let mut renderer_changed = false;
        for path in event.paths {
            match classify_project_watch_path(&event_root, &path) {
                Some(ProjectWatchKind::Renderer) => {
                    relevant = true;
                    renderer_changed = true;
                }
                Some(ProjectWatchKind::Content | ProjectWatchKind::ProjectMeta) => {
                    relevant = true;
                }
                None => {}
            }
        }
        if relevant {
            let _ = event_tx.send(WatchSignal::Changed { renderer_changed });
        }
    })
    .map_err(|e| format!("创建项目监听器失败: {}", e))?;

    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| format!("监听项目目录失败 {}: {}", root.display(), e))?;

    let worker_root = root_key.clone();
    std::thread::spawn(move || run_project_watch_debouncer(app_handle, worker_root, rx));

    active.insert(
        root_key,
        ProjectWatchHandle {
            _watcher: watcher,
            stop_tx: tx,
        },
    );
    Ok(())
}

#[tauri::command]
fn unwatch_project(
    project_path: String,
    watchers: tauri::State<'_, ProjectWatchers>,
) -> Result<(), String> {
    let root = Path::new(&project_path)
        .canonicalize()
        .map_err(|e| format!("无法定位项目目录 {}: {}", project_path, e))?;
    let root_key = root.to_string_lossy().into_owned();
    let mut active = watchers
        .active
        .lock()
        .map_err(|_| "项目监听器状态已损坏".to_string())?;
    if let Some(handle) = active.remove(&root_key) {
        let _ = handle.stop_tx.send(WatchSignal::Stop);
    }
    Ok(())
}

fn initialize_project_root(
    project_path: &Path,
    name: &str,
    default_renderer_dir: &Path,
) -> Result<(), String> {
    ensure_initialization_targets_available(project_path, default_renderer_dir)?;

    // 创建目录骨架（资源放在 content/assets/，节点放在 content/nodes/）
    fs::create_dir_all(project_path.join("content/nodes"))
        .map_err(|e| format!("创建 content/nodes 失败: {}", e))?;
    fs::create_dir_all(project_path.join("content/assets"))
        .map_err(|e| format!("创建 content/assets 失败: {}", e))?;
    fs::create_dir_all(project_path.join("renderers/default"))
        .map_err(|e| format!("创建 renderers/default 失败: {}", e))?;

    // 写最小 manifest / meta
    let manifest = serde_json::json!({
        "characters": {},
        "backgrounds": {},
        "audio": { "bgm": {}, "sfx": {}, "voice": {} }
    });
    write_json(&project_path.join("content/manifest.json"), &manifest)?;

    let meta = serde_json::json!({
        "title": &name,
        "typingSpeedCps": 30,
        "autoAdvanceMs": 1200,
        "chapterGapMs": 1500,
        "stage": { "width": 1280, "height": 720 }
    });
    write_json(&project_path.join("content/meta.json"), &meta)?;

    let graph = serde_json::json!({
        "version": 1,
        "entryNodeId": "start",
        "nodes": [
            {
                "id": "start",
                "title": "开始",
                "file": "nodes/start.json",
                "position": { "x": 120, "y": 120 }
            }
        ],
        "edges": []
    });
    write_json(&project_path.join("content/graph.json"), &graph)?;

    let start_node = serde_json::json!([
        { "t": "narrate", "text": "新的故事从这里开始。" }
    ]);
    write_json(&project_path.join("content/nodes/start.json"), &start_node)?;
    write_project_self_description(project_path)?;

    // 复制默认渲染层模板（从打包的 app resource）
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
    )?;

    Ok(())
}

/// 保存单个文件（相对项目根的路径）。校验目标必须在项目目录内。
#[tauri::command]
fn save_file(
    project_path: String,
    rel_path: String,
    content: String,
    expected_revision: Option<serde_json::Value>,
) -> Result<(), String> {
    let project_root = canonical_project_root(Path::new(&project_path))?;
    let safe_target = resolve_relative_under(&project_root, &rel_path)?;
    ensure_expected_revision(&project_root, &rel_path, expected_revision)?;
    if let Some(parent) = safe_target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
        ensure_existing_path_within(&project_root, parent)?;
    }
    if safe_target.exists() {
        ensure_existing_path_within(&project_root, &safe_target)?;
    }
    atomic_write_text(&safe_target, &content)
        .map_err(|e| format!("写文件失败 ({}): {}", safe_target.display(), e))
}

/// 保存 content/graph.json。节点文件生命周期由 save_file/delete_file 单独管理。
#[tauri::command]
fn save_graph(
    project_path: String,
    graph: ProjectGraphInput,
    expected_revision: Option<serde_json::Value>,
) -> Result<(), String> {
    let project_root = canonical_project_root(Path::new(&project_path))?;
    let content_dir = project_root.join("content");
    let content_root = content_dir
        .canonicalize()
        .map_err(|e| format!("无法定位 content 目录 {}: {}", content_dir.display(), e))?;
    ensure_expected_revision(&project_root, "content/graph.json", expected_revision)?;

    for (index, node) in graph.nodes.iter().enumerate() {
        if node.id.is_empty() {
            return Err(format!("graph.nodes[{index}].id 不能为空"));
        }
        if node.file.is_empty() {
            return Err(format!("graph.nodes[{index}].file 不能为空"));
        }
        let node_path = resolve_relative_under(&content_root, &node.file)?;
        if node_path.exists() {
            ensure_existing_path_within(&content_root, &node_path)?;
        }
    }
    for (index, edge) in graph.edges.iter().enumerate() {
        if edge.id.is_empty() {
            return Err(format!("graph.edges[{index}].id 不能为空"));
        }
        if edge.from.is_empty() {
            return Err(format!("graph.edges[{index}].from 不能为空"));
        }
        if edge.to.is_empty() {
            return Err(format!("graph.edges[{index}].to 不能为空"));
        }
        if !matches!(edge.mode.as_str(), "linear" | "choice" | "auto") {
            return Err(format!("graph.edges[{index}].mode 必须是 linear、choice 或 auto"));
        }
    }

    let value = serde_json::json!({
        "version": graph.version,
        "entryNodeId": graph.entry_node_id,
        "nodes": graph.nodes.iter().map(|node| {
            serde_json::json!({
                "id": node.id,
                "title": node.title,
                "file": node.file,
                "position": {
                    "x": node.position.x,
                    "y": node.position.y,
                },
            })
        }).collect::<Vec<_>>(),
        "edges": graph.edges.iter().map(|edge| {
            serde_json::json!({
                "id": edge.id,
                "from": edge.from,
                "to": edge.to,
                "mode": edge.mode,
                "label": edge.label,
                "condition": edge.condition,
            })
        }).collect::<Vec<_>>(),
    });
    let graph_path = content_dir.join("graph.json");
    if graph_path.exists() {
        ensure_existing_path_within(&content_root, &graph_path)?;
    }
    write_json(&graph_path, &value)
}

/// 只更新 graph.json 中指定节点的 position，保留外部新增/修改的其他节点和边。
#[tauri::command]
fn save_graph_positions(
    project_path: String,
    updates: Vec<GraphPositionPatchInput>,
    expected_revision: Option<serde_json::Value>,
) -> Result<(), String> {
    let project_root = canonical_project_root(Path::new(&project_path))?;
    let content_dir = project_root.join("content");
    let content_root = content_dir
        .canonicalize()
        .map_err(|e| format!("无法定位 content 目录 {}: {}", content_dir.display(), e))?;
    let graph_path = content_dir.join("graph.json");
    ensure_existing_path_within(&content_root, &graph_path)?;
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

    write_json(&graph_path, &graph)
}

/// 删除 content/ 下的单个文件。路径相对 content 根，缺失视为已删除。
#[tauri::command]
fn delete_file(
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
    let project_root = canonical_project_root(Path::new(&project_path))?;
    let content_dir = project_root.join("content");
    let content_root = content_dir
        .canonicalize()
        .map_err(|e| format!("无法定位 content 目录 {}: {}", content_dir.display(), e))?;
    let content_rel_path = safe_relative_path(&rel_path)?;
    let project_rel_path = PathBuf::from("content")
        .join(content_rel_path)
        .to_string_lossy()
        .replace('\\', "/");
    ensure_expected_revision(&project_root, &project_rel_path, expected_revision)?;
    let target = resolve_relative_under(&content_root, &rel_path)?;
    if target.exists() {
        ensure_existing_path_within(&content_root, &target)?;
        move_project_file_to_trash(&project_root, &target, &project_rel_path, command)?;
    }
    Ok(())
}

// ──────────────────────────────────────────────
// 资产管理命令（list / import / delete / save_manifest）
// 路径一律相对 content 根，与 manifest 引用路径一致。
// ──────────────────────────────────────────────

/// 列出 content/assets/ 下的所有资产文件（递归），含 kind 推断与大小。
#[tauri::command]
fn list_assets(project_path: String) -> Result<Vec<AssetEntry>, String> {
    let project_root = canonical_project_root(Path::new(&project_path))?;
    let content_dir = project_root.join("content");
    let content_root = content_dir
        .canonicalize()
        .map_err(|e| format!("无法定位 content 目录 {}: {}", content_dir.display(), e))?;
    list_asset_entries(&content_root)
}

/// 导入资产：把外部文件拷贝进 content/assets/。
/// - source_abs_path：来自对话框的外部文件绝对路径
/// - dest_rel_path：目标相对 content 根的路径，如 "assets/audio/bgm/battle.mp3"
/// 不静默覆盖已有文件（符合 AGENTS.md 保守用户文件原则）。
#[tauri::command]
fn import_asset(
    project_path: String,
    source_abs_path: String,
    dest_rel_path: String,
) -> Result<(), String> {
    let project_root = canonical_project_root(Path::new(&project_path))?;
    let content_dir = project_root.join("content");
    let content_root = content_dir
        .canonicalize()
        .map_err(|e| format!("无法定位 content 目录 {}: {}", content_dir.display(), e))?;

    // 目标必须在 content 内（防越界）
    let dest = resolve_relative_under(&content_root, &dest_rel_path)?;
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
        ensure_existing_path_within(&content_root, parent)?;
    }

    fs::copy(source, &dest).map_err(|e| {
        format!(
            "拷贝文件失败 ({} → {}): {}",
            source.display(),
            dest.display(),
            e
        )
    })?;
    Ok(())
}

/// 删除 content/ 下的资产文件。路径相对 content 根，幂等（缺失视为已删除）。
/// 注意：此命令只删文件，manifest 条目的移除由 save_manifest 统一负责（单一写入点）。
#[tauri::command]
fn delete_asset(
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
#[tauri::command]
fn read_asset_preview_data_url(project_path: String, rel_path: String) -> Result<String, String> {
    let project_root = canonical_project_root(Path::new(&project_path))?;
    let content_dir = project_root.join("content");
    let content_root = content_dir
        .canonicalize()
        .map_err(|e| format!("无法定位 content 目录 {}: {}", content_dir.display(), e))?;
    let target = resolve_relative_under(&content_root, &rel_path)?;

    let mime = preview_image_mime(&rel_path)
        .ok_or_else(|| format!("不支持预览的图片类型: {}", rel_path))?;
    ensure_existing_path_within(&content_root, &target)?;
    if !target.is_file() {
        return Err(format!("资产文件不存在或不是文件: {}", target.display()));
    }

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

// ── save_manifest 的输入类型 ──

#[derive(Deserialize, Clone)]
pub struct ManifestCharacterInput {
    pub name: String,
    #[serde(default = "default_color")]
    pub color: String,
    pub sprites: std::collections::HashMap<String, String>,
}

fn default_color() -> String {
    "#ffffff".to_string()
}

#[derive(Deserialize, Clone, Default)]
pub struct ManifestAudioRegistryInput {
    #[serde(default)]
    pub bgm: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub sfx: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub voice: std::collections::HashMap<String, String>,
}

#[derive(Deserialize, Serialize, Clone, Default)]
pub struct ManifestCgAssetInput {
    pub path: String,
    pub name: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub thumbnail: Option<String>,
    pub group: Option<String>,
    #[serde(rename = "unlockId")]
    pub unlock_id: Option<String>,
}

#[derive(Deserialize, Serialize, Clone, Default)]
pub struct ManifestVideoAssetInput {
    pub path: String,
    pub name: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub thumbnail: Option<String>,
    pub poster: Option<String>,
    pub skippable: Option<bool>,
}

#[derive(Deserialize, Serialize, Clone, Default)]
pub struct ManifestFontInput {
    pub path: String,
    pub family: String,
    pub weight: Option<String>,
    pub style: Option<String>,
}

#[derive(Deserialize, Serialize, Clone, Default)]
pub struct ManifestUiSkinInput {
    pub name: Option<String>,
    #[serde(default)]
    pub assets: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub tokens: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Deserialize, Serialize, Clone, Default)]
pub struct ManifestAnimationAtlasInput {
    pub image: String,
    pub json: Option<String>,
    #[serde(rename = "frameWidth")]
    pub frame_width: Option<u32>,
    #[serde(rename = "frameHeight")]
    pub frame_height: Option<u32>,
}

#[derive(Deserialize, Serialize, Clone, Default)]
pub struct ManifestCgUnlockInput {
    #[serde(rename = "assetId")]
    pub asset_id: String,
    pub title: Option<String>,
}

#[derive(Deserialize, Serialize, Clone, Default)]
pub struct ManifestMusicUnlockInput {
    #[serde(rename = "audioId")]
    pub audio_id: String,
    pub title: Option<String>,
}

#[derive(Deserialize, Serialize, Clone, Default)]
pub struct ManifestReplayUnlockInput {
    #[serde(rename = "nodeId")]
    pub node_id: String,
    pub title: Option<String>,
}

#[derive(Deserialize, Serialize, Clone, Default)]
pub struct ManifestEndingUnlockInput {
    pub title: String,
    #[serde(rename = "nodeId")]
    pub node_id: Option<String>,
}

#[derive(Deserialize, Serialize, Clone, Default)]
pub struct ManifestUnlockRegistryInput {
    #[serde(default)]
    pub cg: std::collections::HashMap<String, ManifestCgUnlockInput>,
    #[serde(default)]
    pub music: std::collections::HashMap<String, ManifestMusicUnlockInput>,
    #[serde(default)]
    pub replay: std::collections::HashMap<String, ManifestReplayUnlockInput>,
    #[serde(default)]
    pub endings: std::collections::HashMap<String, ManifestEndingUnlockInput>,
}

#[derive(Deserialize, Clone, Default)]
pub struct ManifestInput {
    #[serde(default)]
    pub characters: std::collections::HashMap<String, ManifestCharacterInput>,
    #[serde(default)]
    pub backgrounds: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub audio: ManifestAudioRegistryInput,
    #[serde(default)]
    pub cg: std::collections::HashMap<String, ManifestCgAssetInput>,
    #[serde(default)]
    pub videos: std::collections::HashMap<String, ManifestVideoAssetInput>,
    #[serde(default)]
    pub fonts: std::collections::HashMap<String, ManifestFontInput>,
    #[serde(rename = "uiSkins", default)]
    pub ui_skins: std::collections::HashMap<String, ManifestUiSkinInput>,
    #[serde(rename = "animationAtlases", default)]
    pub animation_atlases: std::collections::HashMap<String, ManifestAnimationAtlasInput>,
    #[serde(default)]
    pub unlocks: ManifestUnlockRegistryInput,
}

/// 保存 content/manifest.json。镜像 save_graph 的模式：
/// 类型化输入 → 字段校验 → canonical JSON → 写盘。
#[tauri::command]
fn save_manifest(
    project_path: String,
    manifest: ManifestInput,
    expected_revision: Option<serde_json::Value>,
) -> Result<(), String> {
    let project_root = canonical_project_root(Path::new(&project_path))?;
    let content_dir = project_root.join("content");
    let content_root = content_dir
        .canonicalize()
        .map_err(|e| format!("无法定位 content 目录 {}: {}", content_dir.display(), e))?;
    ensure_expected_revision(&project_root, "content/manifest.json", expected_revision)?;

    // 基本校验：角色名不能空
    for (id, char) in &manifest.characters {
        if id.is_empty() {
            return Err("角色 id 不能为空".to_string());
        }
        if char.name.is_empty() {
            return Err(format!("角色 {id} 的 name 不能为空"));
        }
    }

    // 序列化成 canonical JSON（characters/bgs 用 json! 构造保证对象形态）
    let characters: serde_json::Value = {
        let mut map = serde_json::Map::new();
        for (id, char) in &manifest.characters {
            map.insert(
                id.clone(),
                serde_json::json!({
                    "name": char.name,
                    "color": char.color,
                    "sprites": char.sprites,
                }),
            );
        }
        serde_json::Value::Object(map)
    };

    let value = serde_json::json!({
        "characters": characters,
        "backgrounds": manifest.backgrounds,
        "audio": {
            "bgm": manifest.audio.bgm,
            "sfx": manifest.audio.sfx,
            "voice": manifest.audio.voice,
        },
        "cg": manifest.cg,
        "videos": manifest.videos,
        "fonts": manifest.fonts,
        "uiSkins": manifest.ui_skins,
        "animationAtlases": manifest.animation_atlases,
        "unlocks": manifest.unlocks,
    });

    let manifest_path = content_dir.join("manifest.json");
    if manifest_path.exists() {
        ensure_existing_path_within(&content_root, &manifest_path)?;
    }
    write_json(&manifest_path, &value)
}
