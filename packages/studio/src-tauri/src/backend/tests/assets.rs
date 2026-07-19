use super::support::*;

// ── 资产命令测试 ──

#[test]
fn list_assets_returns_empty_when_no_assets() {
    let dir = unique_temp_dir("list-assets-empty");
    write_asset_project(
        &dir,
        r#"{"characters":{},"backgrounds":{},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
        &[],
    );

    let entries = list_assets(dir.to_string_lossy().to_string()).unwrap();
    assert!(entries.is_empty());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn list_assets_classifies_kind_by_path() {
    let dir = unique_temp_dir("list-assets-kind");
    write_asset_project(
        &dir,
        r#"{"characters":{},"backgrounds":{},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
        &[
            "assets/backgrounds/sky.png",
            "assets/characters/hero_default.png",
            "assets/audio/bgm/theme.mp3",
            "assets/audio/sfx/boom.wav",
            "assets/audio/voice/v01.mp3",
            "assets/cg/rooftop.png",
            "assets/videos/op.mp4",
            "assets/fonts/body.ttf",
            "assets/ui/classic/frame.png",
            "assets/atlases/heroine.png",
            "assets/misc/unknown.bin",
        ],
    );

    let entries = list_assets(dir.to_string_lossy().to_string()).unwrap();
    let kinds: Vec<_> = entries.iter().map(|e| e.kind.clone()).collect();
    assert!(kinds.contains(&AssetKind::Background));
    assert!(kinds.contains(&AssetKind::Character));
    assert!(kinds.contains(&AssetKind::Bgm));
    assert!(kinds.contains(&AssetKind::Sfx));
    assert!(kinds.contains(&AssetKind::Voice));
    assert!(kinds.contains(&AssetKind::Cg));
    assert!(kinds.contains(&AssetKind::Video));
    assert!(kinds.contains(&AssetKind::Font));
    assert!(kinds.contains(&AssetKind::Ui));
    assert!(kinds.contains(&AssetKind::Animation));
    assert!(kinds.contains(&AssetKind::Unknown));
    let _ = fs::remove_dir_all(&dir);
}

#[cfg(unix)]
#[test]
fn list_assets_rejects_symlinked_asset_directory_even_when_empty() {
    use std::os::unix::fs::symlink;

    let root = unique_temp_dir("list-assets-dir-symlink");
    let project = root.join("project");
    let external = root.join("external-assets");
    write_asset_project(
        &project,
        r#"{"characters":{},"backgrounds":{},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
        &[],
    );
    fs::create_dir_all(project.join("content/assets")).unwrap();
    fs::create_dir_all(&external).unwrap();
    symlink(&external, project.join("content/assets/external")).unwrap();

    let error = list_assets(project.to_string_lossy().into_owned())
        .err()
        .expect("asset directory symlinks must be rejected");
    assert!(error.contains("符号链接"), "unexpected error: {error}");

    let _ = fs::remove_dir_all(&root);
}

#[cfg(unix)]
#[test]
fn list_assets_rejects_symlinked_assets_root() {
    use std::os::unix::fs::symlink;

    let root = unique_temp_dir("list-assets-root-symlink");
    let project = root.join("project");
    let external = root.join("external-assets");
    write_asset_project(
        &project,
        r#"{"characters":{},"backgrounds":{},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
        &[],
    );
    fs::create_dir_all(project.join("content/assets")).unwrap();
    fs::create_dir_all(&external).unwrap();
    fs::remove_dir(project.join("content/assets")).unwrap();
    symlink(&external, project.join("content/assets")).unwrap();

    let error = list_assets(project.to_string_lossy().into_owned())
        .err()
        .expect("assets root symlinks must be rejected");
    assert!(error.contains("符号链接"), "unexpected error: {error}");

    let _ = fs::remove_dir_all(&root);
}

#[cfg(unix)]
#[test]
fn list_assets_rejects_symlink_directory_cycles_explicitly() {
    use std::os::unix::fs::symlink;

    let root = unique_temp_dir("list-assets-dir-cycle");
    write_asset_project(
        &root,
        r#"{"characters":{},"backgrounds":{},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
        &[],
    );
    let assets = root.join("content/assets");
    fs::create_dir_all(&assets).unwrap();
    symlink(&assets, assets.join("loop")).unwrap();

    let error = list_assets(root.to_string_lossy().into_owned())
        .err()
        .expect("asset symlink cycles must be rejected");
    assert!(error.contains("符号链接"), "unexpected error: {error}");

    let _ = fs::remove_dir_all(&root);
}

#[cfg(unix)]
#[test]
fn open_project_reports_asset_scan_symlinks_instead_of_treating_assets_as_empty() {
    use std::os::unix::fs::symlink;

    let root = unique_temp_dir("project-asset-scan-symlink");
    let project = root.join("project");
    let external = root.join("external-assets");
    write_asset_project(
        &project,
        r#"{"characters":{},"backgrounds":{},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
        &[],
    );
    fs::create_dir_all(project.join("content/assets")).unwrap();
    fs::create_dir_all(&external).unwrap();
    symlink(&external, project.join("content/assets/external")).unwrap();

    let opened = open_project_inner(project.to_string_lossy().as_ref()).unwrap();
    let issue = opened
        .asset_report
        .unwrap()
        .asset_issues
        .into_iter()
        .find(|issue| issue.code == "unsafe_asset_path")
        .expect("unsafe asset scan must produce a stable issue");
    assert_eq!(issue.severity, GraphIssueSeverity::Error);
    assert!(issue.message.contains("符号链接"));

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn import_asset_copies_file_and_creates_dirs() {
    let dir = unique_temp_dir("import-asset");
    write_asset_project(
        &dir,
        r#"{"characters":{},"backgrounds":{},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
        &[],
    );
    // 准备一个外部源文件
    let src = dir.join("_src_sample.png");
    write_text(&src, "png-bytes");

    import_asset(
        dir.to_string_lossy().to_string(),
        src.to_string_lossy().to_string(),
        "assets/backgrounds/imported.png".to_string(),
    )
    .unwrap();

    let copied = dir.join("content/assets/backgrounds/imported.png");
    assert!(copied.is_file());
    assert_eq!(fs::read_to_string(&copied).unwrap(), "png-bytes");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn import_asset_rejects_traversal() {
    let dir = unique_temp_dir("import-traversal");
    write_asset_project(
        &dir,
        r#"{"characters":{},"backgrounds":{},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
        &[],
    );
    let src = dir.join("_src.png");
    write_text(&src, "x");

    let result = import_asset(
        dir.to_string_lossy().to_string(),
        src.to_string_lossy().to_string(),
        "../../etc/evil.png".to_string(),
    );
    assert!(result.is_err());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn import_asset_rejects_existing_target() {
    let dir = unique_temp_dir("import-exists");
    write_asset_project(
        &dir,
        r#"{"characters":{},"backgrounds":{},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
        &["assets/backgrounds/exists.png"],
    );
    let src = dir.join("_src.png");
    write_text(&src, "x");

    let result = import_asset(
        dir.to_string_lossy().to_string(),
        src.to_string_lossy().to_string(),
        "assets/backgrounds/exists.png".to_string(),
    );
    assert!(result.is_err(), "不应静默覆盖已有文件");
    let _ = fs::remove_dir_all(&dir);
}

#[cfg(unix)]
#[test]
fn import_asset_rejects_dangling_destination_symlink() {
    use std::os::unix::fs::symlink;

    let root = unique_temp_dir("import-dangling-symlink");
    let project = root.join("project");
    write_asset_project(
        &project,
        r#"{"characters":{},"backgrounds":{},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
        &[],
    );
    let source = root.join("source.png");
    let outside = root.join("outside-created.png");
    write_text(&source, "source");
    fs::create_dir_all(project.join("content/assets/backgrounds")).unwrap();
    symlink(
        &outside,
        project.join("content/assets/backgrounds/escape.png"),
    )
    .unwrap();

    let result = import_asset(
        project.to_string_lossy().into_owned(),
        source.to_string_lossy().into_owned(),
        "assets/backgrounds/escape.png".to_string(),
    );

    assert!(result.is_err());
    assert!(!outside.exists(), "导入不得沿 dangling symlink 写到项目外");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn delete_asset_is_idempotent() {
    let dir = unique_temp_dir("delete-asset");
    write_asset_project(
        &dir,
        r#"{"characters":{},"backgrounds":{},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
        &["assets/backgrounds/gone.png"],
    );

    delete_asset(
        dir.to_string_lossy().to_string(),
        "assets/backgrounds/gone.png".to_string(),
        None,
    )
    .unwrap();
    // 再次删除已不存在的文件也应成功
    delete_asset(
        dir.to_string_lossy().to_string(),
        "assets/backgrounds/gone.png".to_string(),
        None,
    )
    .unwrap();
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn delete_asset_moves_to_trash_with_revision() {
    let dir = unique_temp_dir("delete-asset-trash");
    write_asset_project(
        &dir,
        r#"{"characters":{},"backgrounds":{},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
        &["assets/backgrounds/gone.png"],
    );
    let expected = file_revision(&dir, "content/assets/backgrounds/gone.png")
        .unwrap()
        .unwrap();

    delete_asset(
        dir.to_string_lossy().to_string(),
        "assets/backgrounds/gone.png".to_string(),
        Some(serde_json::to_value(&expected).unwrap()),
    )
    .unwrap();

    assert!(!dir.join("content/assets/backgrounds/gone.png").exists());
    let trash_dir = fs::read_dir(dir.join(".galstudio/trash"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    assert!(trash_dir
        .join("content/assets/backgrounds/gone.png")
        .exists());
    let manifest: serde_json::Value = read_json(&trash_dir.join("trash.json")).unwrap();
    assert_eq!(manifest["command"], "delete_asset");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn save_manifest_roundtrip() {
    let dir = unique_temp_dir("save-manifest");
    write_asset_project(
        &dir,
        r#"{"characters":{},"backgrounds":{},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
        &[],
    );

    let manifest = serde_json::json!({
        "characters": { "hero": { "name": "主角", "color": "#9fc8e3", "sprites": { "default": "assets/characters/hero.svg" } } },
        "backgrounds": { "sky": "assets/backgrounds/sky.png" },
        "audio": { "bgm": { "theme": "assets/audio/bgm/theme.mp3" }, "sfx": {}, "voice": {} },
        "cg": { "cg_rooftop": { "path": "assets/cg/rooftop.png", "name": "屋顶", "tags": ["night"], "thumbnail": "assets/cg/thumbs/rooftop.png", "group": "memory", "unlockId": "cg_rooftop_unlock" } },
        "videos": { "op": { "path": "assets/videos/op.mp4", "name": "OP", "tags": [], "poster": "assets/videos/op.jpg", "skippable": true } },
        "fonts": { "body": { "path": "assets/fonts/body.ttf", "family": "Body Sans", "weight": "400" } },
        "uiSkins": { "classic": { "name": "Classic", "assets": { "frame": "assets/ui/classic/frame.png" }, "tokens": { "radius": 8, "accent": "#f09" } } },
        "animationAtlases": { "heroine": { "image": "assets/atlases/heroine.png", "json": "assets/atlases/heroine.json", "frameWidth": 320, "frameHeight": 240 } },
        "unlocks": {
            "cg": { "cg_rooftop_unlock": { "assetId": "cg_rooftop", "title": "屋顶 CG" } },
            "music": { "theme_unlock": { "audioId": "theme", "title": "主题曲" } },
            "replay": { "start_replay": { "nodeId": "start", "title": "序章" } },
            "endings": { "true_end": { "title": "True End", "nodeId": "ending" } }
        }
    });

    save_manifest(dir.to_string_lossy().to_string(), manifest, None).unwrap();

    let written = fs::read_to_string(dir.join("content/manifest.json")).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&written).unwrap();
    assert_eq!(parsed["characters"]["hero"]["name"], "主角");
    assert_eq!(
        parsed["audio"]["bgm"]["theme"],
        "assets/audio/bgm/theme.mp3"
    );
    assert_eq!(parsed["cg"]["cg_rooftop"]["path"], "assets/cg/rooftop.png");
    assert_eq!(parsed["cg"]["cg_rooftop"]["unlockId"], "cg_rooftop_unlock");
    assert_eq!(parsed["videos"]["op"]["poster"], "assets/videos/op.jpg");
    assert_eq!(parsed["fonts"]["body"]["family"], "Body Sans");
    assert_eq!(
        parsed["uiSkins"]["classic"]["assets"]["frame"],
        "assets/ui/classic/frame.png"
    );
    assert_eq!(
        parsed["animationAtlases"]["heroine"]["image"],
        "assets/atlases/heroine.png"
    );
    assert_eq!(
        parsed["unlocks"]["cg"]["cg_rooftop_unlock"]["assetId"],
        "cg_rooftop"
    );
    assert!(parsed["audio"]["sfx"].is_object());
    assert!(parsed["audio"]["voice"].is_object());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn validate_assets_flags_orphan_and_dangling() {
    let dir = unique_temp_dir("validate-assets");
    // manifest 声明了 sky（存在）和 ghost（不存在）；磁盘上还有一个未登记的 orphan.png
    write_asset_project(
        &dir,
        r#"{"characters":{},"backgrounds":{"sky":"assets/backgrounds/sky.png","ghost":"assets/backgrounds/ghost.png"},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
        &[
            "assets/backgrounds/sky.png",
            "assets/backgrounds/orphan.png",
        ],
    );

    let content_root = dir.join("content").canonicalize().unwrap();
    let manifest = read_json(&dir.join("content/manifest.json")).unwrap();
    let issues = validate_assets_for_project(&content_root, &manifest);

    let codes: Vec<_> = issues.iter().map(|i| i.code.as_str()).collect();
    assert!(
        codes.contains(&"missing_asset"),
        "应检出悬空引用 ghost: {codes:?}"
    );
    assert!(
        codes.contains(&"orphan_asset"),
        "应检出孤儿文件 orphan.png: {codes:?}"
    );

    let missing = issues.iter().find(|i| i.code == "missing_asset").unwrap();
    assert_eq!(missing.severity, GraphIssueSeverity::Error);
    let orphan = issues.iter().find(|i| i.code == "orphan_asset").unwrap();
    assert_eq!(orphan.severity, GraphIssueSeverity::Error);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn validate_assets_clean_when_consistent() {
    let dir = unique_temp_dir("validate-assets-clean");
    // 磁盘和 manifest 完全一致 → 无问题
    write_asset_project(
        &dir,
        r##"{"characters":{"hero":{"name":"主角","color":"#fff","sprites":{"default":"assets/characters/hero.svg"}}},"backgrounds":{"sky":"assets/backgrounds/sky.png"},"audio":{"bgm":{"theme":"assets/audio/bgm/theme.mp3"},"sfx":{},"voice":{}}}"##,
        &[
            "assets/characters/hero.svg",
            "assets/backgrounds/sky.png",
            "assets/audio/bgm/theme.mp3",
        ],
    );

    let content_root = dir.join("content").canonicalize().unwrap();
    let manifest = read_json(&dir.join("content/manifest.json")).unwrap();
    let issues = validate_assets_for_project(&content_root, &manifest);
    assert!(issues.is_empty(), "一致时应无问题: {issues:?}");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn validate_assets_flags_duplicate_ref() {
    let dir = unique_temp_dir("validate-assets-dup");
    // 同一文件被两个 background id 引用
    write_asset_project(
        &dir,
        r#"{"characters":{},"backgrounds":{"a":"assets/backgrounds/sky.png","b":"assets/backgrounds/sky.png"},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
        &["assets/backgrounds/sky.png"],
    );

    let content_root = dir.join("content").canonicalize().unwrap();
    let manifest = read_json(&dir.join("content/manifest.json")).unwrap();
    let issues = validate_assets_for_project(&content_root, &manifest);

    let dup = issues.iter().find(|i| i.code == "duplicate_asset_ref");
    assert!(dup.is_some(), "应检出重复引用: {issues:?}");
    assert_eq!(dup.unwrap().severity, GraphIssueSeverity::Warn);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn validate_assets_reports_missing_expanded_registry_files() {
    let dir = unique_temp_dir("validate-assets-expanded-missing");
    write_asset_project(
        &dir,
        r#"{
            "characters":{},
            "backgrounds":{},
            "audio":{"bgm":{},"sfx":{},"voice":{}},
            "cg":{"cg_rooftop":{"path":"assets/cg/rooftop.png","thumbnail":"assets/cg/thumbs/rooftop.png"}},
            "videos":{"op":{"path":"assets/videos/op.mp4","poster":"assets/videos/op.jpg"}},
            "fonts":{"body":{"path":"assets/fonts/body.ttf","family":"Body Sans"}},
            "uiSkins":{"classic":{"assets":{"frame":"assets/ui/classic/frame.png"}}},
            "animationAtlases":{"heroine":{"image":"assets/atlases/heroine.png","json":"assets/atlases/heroine.json"}},
            "unlocks":{"cg":{},"music":{},"replay":{},"endings":{}}
        }"#,
        &[],
    );

    let content_root = dir.join("content").canonicalize().unwrap();
    let manifest = read_json(&dir.join("content/manifest.json")).unwrap();
    let issues = validate_assets_for_project(&content_root, &manifest);
    let missing_paths = issues
        .iter()
        .filter(|issue| issue.code == "missing_asset")
        .filter_map(|issue| issue.json_path.as_deref())
        .collect::<Vec<_>>();

    assert!(missing_paths.contains(&"$.cg.cg_rooftop.path"));
    assert!(missing_paths.contains(&"$.cg.cg_rooftop.thumbnail"));
    assert!(missing_paths.contains(&"$.videos.op.path"));
    assert!(missing_paths.contains(&"$.videos.op.poster"));
    assert!(missing_paths.contains(&"$.fonts.body.path"));
    assert!(missing_paths.contains(&"$.uiSkins.classic.assets.frame"));
    assert!(missing_paths.contains(&"$.animationAtlases.heroine.image"));
    assert!(missing_paths.contains(&"$.animationAtlases.heroine.json"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn open_project_includes_asset_report() {
    let dir = unique_temp_dir("open-asset-report");
    write_asset_project(
        &dir,
        r#"{"characters":{},"backgrounds":{},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
        &["assets/backgrounds/orphan.png"],
    );

    let data = open_project_inner(dir.to_string_lossy().as_ref()).unwrap();
    let report = data.asset_report.expect("open_project 应返回 asset_report");
    // orphan.png 没在 manifest 登记 → 应有 orphan_asset 问题
    assert!(report.asset_issues.iter().any(|i| i.code == "orphan_asset"));
    let _ = fs::remove_dir_all(&dir);
}

// ── 全局报告聚合 + manifest 结构校验测试 ──

#[test]
fn validate_manifest_structure_flags_flat_audio() {
    // 旧 flat audio：audio: { bgm_main: ... }，缺少 bgm/sfx/voice 子表
    let manifest = serde_json::json!({
        "characters": {},
        "backgrounds": {},
        "audio": { "bgm_main": "x.mp3" }
    });
    let issues = validate_manifest_structure(&manifest);
    let codes: Vec<_> = issues.iter().map(|i| i.code.as_str()).collect();
    assert!(
        codes.iter().all(|c| *c == "manifest_invalid_audio"),
        "应检出 audio 结构错误: {codes:?}"
    );
    assert_eq!(issues[0].source, "manifest");
    assert_eq!(issues[0].severity, GraphIssueSeverity::Error);
}

#[test]
fn validate_manifest_structure_clean_for_new_format() {
    let manifest = serde_json::json!({
        "characters": {},
        "backgrounds": {},
        "audio": { "bgm": {}, "sfx": {}, "voice": {} }
    });
    let issues = validate_manifest_structure(&manifest);
    assert!(issues.is_empty(), "新格式应无结构问题: {issues:?}");
}

// ── 单 skin 收敛：多套 uiSkins 出 Warn 级 project issue（Spec 19 §4.4） ──

#[test]
fn validate_ui_skin_convergence_flags_multiple_skins() {
    let manifest = serde_json::json!({
        "characters": {},
        "backgrounds": {},
        "audio": { "bgm": {}, "sfx": {}, "voice": {} },
        "uiSkins": {
            "default": { "assets": {} },
            "classic": { "assets": { "frame": "assets/ui/classic/frame.png" } }
        }
    });
    let issues = validate_ui_skin_convergence(&manifest);
    assert_eq!(issues.len(), 1, "多套 uiSkins 应恰好产出一个 issue: {issues:?}");
    assert_eq!(issues[0].severity, GraphIssueSeverity::Warn);
    assert_eq!(issues[0].source, "manifest");
    assert_eq!(issues[0].code, "multiple_ui_skins");
    assert_eq!(issues[0].file.as_deref(), Some("content/manifest.json"));
    assert_eq!(issues[0].json_path.as_deref(), Some("$.uiSkins"));
    assert!(
        issues[0].message.contains("多余的外观资源条目不会被消费"),
        "issue 文案应说明多余条目不会被消费: {}",
        issues[0].message
    );
}

#[test]
fn validate_ui_skin_convergence_clean_for_single_or_no_skin() {
    let cases = vec![
        serde_json::json!({ "uiSkins": { "default": { "assets": {} } } }),
        serde_json::json!({ "uiSkins": {} }),
        serde_json::json!({}),
    ];
    for manifest in cases {
        let issues = validate_ui_skin_convergence(&manifest);
        assert!(issues.is_empty(), "单 skin / 无 skin 不应出 issue: {issues:?}");
    }
}

#[test]
fn open_project_report_includes_multiple_ui_skins_warning() {
    let dir = unique_temp_dir("report-multi-ui-skins");
    write_asset_project(
        &dir,
        r#"{
            "characters":{},
            "backgrounds":{},
            "audio":{"bgm":{},"sfx":{},"voice":{}},
            "uiSkins":{
                "default":{"assets":{}},
                "classic":{"assets":{"frame":"assets/ui/classic/frame.png"}}
            }
        }"#,
        &["assets/ui/classic/frame.png"],
    );

    let data = open_project_inner(dir.to_string_lossy().as_ref()).unwrap();
    let report = data.project_report.expect("应有 project_report");
    let issue = report
        .project_issues
        .iter()
        .find(|issue| issue.code == "multiple_ui_skins")
        .expect("多套 uiSkins 应进入 project_report");
    assert_eq!(issue.severity, GraphIssueSeverity::Warn);
    assert_eq!(issue.source, "manifest");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn open_project_aggregates_project_report() {
    let dir = unique_temp_dir("aggregate-report");
    // 制造三类问题：
    // - graph: 入口指向不存在节点（missing_entry_node, error）
    // - asset: 孤儿文件（orphan_asset, error）
    // - manifest: 格式正确（无问题）
    write_asset_project(
        &dir,
        r#"{"characters":{},"backgrounds":{},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
        &["assets/backgrounds/orphan.png"],
    );
    write_text(
        &dir.join("content/graph.json"),
        r#"{"version":1,"entryNodeId":"ghost","nodes":[{"id":"a","title":"A","file":"nodes/a.json","position":{"x":0,"y":0}}],"edges":[]}"#,
    );
    write_text(&dir.join("content/nodes/a.json"), "[]");

    let data = open_project_inner(dir.to_string_lossy().as_ref()).unwrap();
    let report = data
        .project_report
        .expect("open_project 应返回 project_report");

    let sources: Vec<_> = report
        .project_issues
        .iter()
        .map(|i| i.source.as_str())
        .collect();
    assert!(sources.contains(&"graph"), "应含图结构问题: {sources:?}");
    assert!(sources.contains(&"asset"), "应含资产问题: {sources:?}");
    // manifest 格式正确 → 不应有 manifest source
    assert!(!sources.contains(&"manifest"), "manifest 正确时不应有问题");

    // 每个 issue 都应有 source 字段
    assert!(report.project_issues.iter().all(|i| !i.source.is_empty()));
    let graph_issue = report
        .project_issues
        .iter()
        .find(|i| i.source == "graph" && i.code == "missing_entry_node")
        .expect("应保留 missing_entry_node");
    assert_eq!(graph_issue.node_id.as_deref(), Some("ghost"));
    assert_eq!(graph_issue.edge_id, None);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn open_project_aggregates_node_issues() {
    let dir = unique_temp_dir("aggregate-node-report");
    write_graph_project(
        &dir,
        serde_json::json!({
            "version": 1,
            "entryNodeId": "start",
            "nodes": [
                {
                    "id": "start",
                    "title": "Start",
                    "file": "nodes/start.json",
                    "position": { "x": 0, "y": 0 }
                }
            ],
            "edges": []
        }),
        &[(
            "nodes/start.json",
            serde_json::json!([{ "t": "say", "id": "ghost_01", "who": "ghost", "text": "Hi" }]),
        )],
    );

    let data = open_project_inner(dir.to_string_lossy().as_ref()).unwrap();
    let report = data.project_report.expect("应有 project_report");
    let issue = report
        .project_issues
        .iter()
        .find(|issue| issue.source == "node" && issue.code == "missing_character_ref")
        .expect("节点内容引用错误应进入 project_report");

    assert_eq!(issue.severity, GraphIssueSeverity::Error);
    assert_eq!(issue.file.as_deref(), Some("content/nodes/start.json"));
    assert_eq!(issue.json_path.as_deref(), Some("$[0].who"));
    assert_eq!(issue.node_id.as_deref(), Some("start"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn open_project_report_includes_manifest_error() {
    let dir = unique_temp_dir("report-manifest-err");
    // 旧 flat audio manifest → manifest 结构错误应进 project_report
    write_asset_project(
        &dir,
        r#"{"characters":{},"backgrounds":{},"audio":{"bgm_main":"x.mp3"}}"#,
        &[],
    );

    let data = open_project_inner(dir.to_string_lossy().as_ref()).unwrap();
    let report = data.project_report.expect("应有 project_report");
    assert!(
        report
            .project_issues
            .iter()
            .any(|i| i.source == "manifest" && i.code == "manifest_invalid_audio"),
        "应含 manifest 结构错误: {:?}",
        report
            .project_issues
            .iter()
            .map(|i| &i.code)
            .collect::<Vec<_>>()
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn open_project_report_includes_meta_stage_error() {
    let dir = unique_temp_dir("report-meta-stage-err");
    write_minimal_project(&dir);
    write_text(
        &dir.join("content/meta.json"),
        r#"{"title":"T","stage":{"width":100,"height":720}}"#,
    );

    let data = open_project_inner(dir.to_string_lossy().as_ref()).unwrap();
    let report = data.project_report.expect("应有 project_report");
    let issue = report
        .project_issues
        .iter()
        .find(|issue| issue.source == "meta" && issue.code == "meta_invalid_stage")
        .expect("meta stage 错误应进入 project_report");

    assert_eq!(issue.file.as_deref(), Some("content/meta.json"));
    assert_eq!(issue.json_path.as_deref(), Some("$.stage.width"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn read_asset_preview_data_url_reads_image_under_content() {
    let dir = unique_temp_dir("asset-preview-data-url");
    write_asset_project(
        &dir,
        r#"{"characters":{},"backgrounds":{"sky":"assets/backgrounds/sky.png"},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
        &["assets/backgrounds/sky.png"],
    );

    let data_url = read_asset_preview_data_url(
        dir.to_string_lossy().to_string(),
        "assets/backgrounds/sky.png".to_string(),
    )
    .unwrap();

    assert!(data_url.starts_with("data:image/png;base64,"));
    assert!(data_url.ends_with("ZmFrZQ=="));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn read_asset_preview_data_url_rejects_path_traversal() {
    let dir = unique_temp_dir("asset-preview-traversal");
    write_asset_project(
        &dir,
        r#"{"characters":{},"backgrounds":{},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
        &[],
    );

    let result = read_asset_preview_data_url(
        dir.to_string_lossy().to_string(),
        "../gal.project.json".to_string(),
    );

    assert!(result.is_err());
    let _ = fs::remove_dir_all(&dir);
}
