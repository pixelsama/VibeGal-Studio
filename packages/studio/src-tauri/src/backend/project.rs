pub fn read_project_meta(project_path: &Path) -> Result<ProjectMeta, String> {
    let meta_file = project_path.join("gal.project.json");
    let text = fs::read_to_string(&meta_file).map_err(|e| {
        format!(
            "读取 gal.project.json 失败 ({}): {}",
            meta_file.display(),
            e
        )
    })?;
    serde_json::from_str::<ProjectMeta>(&text)
        .map_err(|e| format!("解析 gal.project.json 失败: {}", e))
}

/// 列出工作区目录下的所有项目（含 gal.project.json 的直接子目录）
#[tauri::command]
fn list_projects(workspace_dir: String) -> Result<Vec<ProjectListItem>, String> {
    let root = Path::new(&workspace_dir);
    if !root.is_dir() {
        return Ok(vec![]);
    }
    let mut items = vec![];
    let entries = fs::read_dir(root).map_err(|e| format!("读取目录失败: {}", e))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() && path.join("gal.project.json").exists() {
            if let Ok(meta) = read_project_meta(&path) {
                items.push(ProjectListItem {
                    path: path.to_string_lossy().into_owned(),
                    meta,
                });
            }
        }
    }
    Ok(items)
}

/// 读取项目内 renderers/ 子目录名
fn list_renderer_ids(project_path: &Path) -> Vec<String> {
    let renderers_dir = project_path.join("renderers");
    if !renderers_dir.is_dir() {
        return vec![];
    }
    let mut ids = vec![];
    if let Ok(entries) = fs::read_dir(&renderers_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            // 一个渲染层 = 含 index.tsx 的子目录
            if p.is_dir() && p.join("index.tsx").exists() {
                if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                    ids.push(name.to_string());
                }
            }
        }
    }
    ids
}

/// 打开项目：读 gal.project.json + content + 渲染层列表
#[tauri::command]
fn open_project(path: String, app_handle: tauri::AppHandle) -> Result<ProjectData, String> {
    open_project_for_app(&path, &app_handle)
}

/// 供 CLI 直接调用的项目打开入口（无 #[tauri::command] 宏，可跨 crate 调）。
pub fn open_project_for_cli(path: &str) -> Result<ProjectData, String> {
    open_project_inner(path)
}

fn open_project_for_app(path: &str, app_handle: &tauri::AppHandle) -> Result<ProjectData, String> {
    let data = open_project_inner(path)?;
    allow_project_content_assets(app_handle, Path::new(&data.path))?;
    Ok(data)
}

fn allow_project_content_assets(
    app_handle: &tauri::AppHandle,
    project_path: &Path,
) -> Result<(), String> {
    let content_dir = project_path.join("content").canonicalize().map_err(|e| {
        format!(
            "无法定位 content 资源目录 {}: {}",
            project_path.display(),
            e
        )
    })?;
    app_handle
        .asset_protocol_scope()
        .allow_directory(&content_dir, true)
        .map_err(|e| format!("授权渲染资产目录失败 ({}): {}", content_dir.display(), e))
}

fn open_project_inner(path: &str) -> Result<ProjectData, String> {
    let project_path = canonical_project_root(Path::new(path))?;
    let meta = read_project_meta(&project_path)?;

    let content_dir = project_path.join("content");
    let content_root = content_dir
        .canonicalize()
        .map_err(|e| format!("无法定位 content 目录 {}: {}", content_dir.display(), e))?;
    let manifest = read_json(&content_dir.join("manifest.json"))?;
    let meta_json = read_json(&content_dir.join("meta.json"))?;

    let renderer_ids = list_renderer_ids(&project_path);
    let project_revision = file_revision(&project_path, "gal.project.json")?;
    let (graph, nodes, mut graph_issues) = load_project_graph_data(&content_root)?;
    let graph_revision = file_revision(&project_path, "content/graph.json")?;
    let manifest_revision = file_revision(&project_path, "content/manifest.json")?;
    let meta_revision = file_revision(&project_path, "content/meta.json")?;
    let mut node_revisions = HashMap::new();
    for node in &nodes {
        node_revisions.insert(
            node.rel_path.clone(),
            file_revision(&project_path, &format!("content/{}", node.rel_path))?,
        );
    }
    graph_issues.extend(legacy_chapter_layout_issues(&content_root, &meta_json));
    graph_issues.extend(validate_graph(&graph, &nodes));
    let graph_report = GraphReport { graph_issues };
    let asset_report = AssetReport {
        asset_issues: validate_assets(&content_root, &manifest),
    };

    // 全局聚合：图结构 + 节点内容 + 资产 + manifest 结构问题汇总成一个报告
    let node_issues = validate_node_contents(&graph, &nodes, &manifest);
    let manifest_issues = validate_manifest_structure(&manifest);
    let meta_issues = validate_meta_structure(&meta_json);
    let mut project_issues: Vec<ProjectIssue> = vec![];
    project_issues.extend(
        graph_report
            .graph_issues
            .iter()
            .map(|i| graph_issue_to_project(i, "graph")),
    );
    project_issues.extend(node_issues);
    project_issues.extend(
        asset_report
            .asset_issues
            .iter()
            .map(|i| graph_issue_to_project(i, "asset")),
    );
    project_issues.extend(manifest_issues);
    project_issues.extend(meta_issues);
    project_issues.sort_by(|a, b| {
        (
            project_issue_source_order(&a.source),
            a.severity != GraphIssueSeverity::Error,
            a.file.as_deref().unwrap_or(""),
            a.json_path.as_deref().unwrap_or(""),
        )
            .cmp(&(
                project_issue_source_order(&b.source),
                b.severity != GraphIssueSeverity::Error,
                b.file.as_deref().unwrap_or(""),
                b.json_path.as_deref().unwrap_or(""),
            ))
    });
    let project_report = ProjectReport { project_issues };

    Ok(ProjectData {
        path: project_path.to_string_lossy().into_owned(),
        meta,
        content: ProjectContent {
            manifest,
            meta: meta_json,
        },
        renderer_ids,
        project_revision,
        graph: Some(graph),
        nodes: Some(nodes),
        graph_revision,
        manifest_revision,
        meta_revision,
        node_revisions: Some(node_revisions),
        graph_report: Some(graph_report),
        asset_report: Some(asset_report),
        project_report: Some(project_report),
    })
}

fn project_issue_source_order(source: &str) -> u8 {
    match source {
        "graph" => 0,
        "node" => 1,
        "asset" => 2,
        "meta" => 3,
        "manifest" => 4,
        _ => 5,
    }
}

