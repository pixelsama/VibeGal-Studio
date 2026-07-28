use super::support::*;

#[test]
fn initialize_project_root_adds_project_files_to_selected_directory() {
    let root = unique_temp_dir("init-root");
    let renderer_template = root.join("template");
    let project = root.join("Existing Story");
    write_text(&renderer_template.join("index.tsx"), "export default {};");
    fs::create_dir_all(&project).unwrap();

    initialize_project_root(&project, "Existing Story", "default", &renderer_template).unwrap();

    assert!(project.join("gal.project.json").is_file());
    assert!(project.join("content/manifest.json").is_file());
    assert!(project.join("content/meta.json").is_file());
    assert!(project.join("content/graph.json").is_file());
    assert!(project.join("content/nodes/start.json").is_file());
    assert!(!project.join("content/chapters").exists());
    assert!(project.join("content/assets").is_dir());
    assert!(project.join("AGENTS.md").is_file());
    assert_eq!(
        fs::read_to_string(project.join(".gitignore")).unwrap(),
        super::super::project::templates::PROJECT_GITIGNORE
    );
    assert!(project.join(".galstudio/README.md").is_file());
    assert!(project.join(".galstudio/renderer-contract.md").is_file());
    for schema_name in [
        "graph",
        "nodeFile",
        "manifest",
        "meta",
        "fixture",
        "variables",
        "locale",
    ] {
        let schema_path = project.join(format!(".galstudio/schemas/{schema_name}.json"));
        assert!(schema_path.is_file(), "missing schema {}", schema_name);
        assert_eq!(
            fs::read(&schema_path).unwrap(),
            fs::read(
                Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join(format!("generated/contracts/{schema_name}.schema.json")),
            )
            .unwrap(),
            "project template schema must match the embedded Rust artifact byte-for-byte"
        );
        let schema: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(schema_path).unwrap()).unwrap();
        assert!(
            schema.get("type").is_some(),
            "schema {} should be valid JSON Schema",
            schema_name
        );
    }
    let graph_schema: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(project.join(".galstudio/schemas/graph.json")).unwrap(),
    )
    .unwrap();
    assert!(graph_schema["properties"].get("entryNodeId").is_some());
    assert!(graph_schema["properties"].get("chapters").is_some());
    assert!(graph_schema["properties"].get("nodes").is_some());
    let node_schema: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(project.join(".galstudio/schemas/nodeFile.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(node_schema["type"], "array");
    let manifest_schema: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(project.join(".galstudio/schemas/manifest.json")).unwrap(),
    )
    .unwrap();
    assert!(manifest_schema["properties"].get("characters").is_some());
    assert!(manifest_schema["properties"].get("backgrounds").is_some());
    assert!(manifest_schema["properties"].get("audio").is_some());
    let meta_schema: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(project.join(".galstudio/schemas/meta.json")).unwrap(),
    )
    .unwrap();
    assert!(meta_schema["properties"].get("title").is_some());
    assert!(meta_schema["properties"].get("typingSpeedCps").is_some());
    let agent_instructions = fs::read_to_string(project.join("AGENTS.md")).unwrap();
    assert!(agent_instructions.contains("content/graph.json"));
    assert!(agent_instructions.contains("content/nodes/*.json"));
    assert!(agent_instructions.contains("nodes[].chapterId"));
    assert!(agent_instructions.contains("Instruction[]"));
    assert!(agent_instructions.contains("renderers/<id>/index.tsx"));
    assert!(agent_instructions.contains("vibegal-cli validate . --format json"));
    assert!(agent_instructions.contains("vibegal-cli instruction-ids assign . --format json"));
    assert!(agent_instructions.contains("Identity-sensitive operations"));
    assert!(agent_instructions.contains("vibegal-cli node insert . <node-id>"));
    assert!(agent_instructions.contains("vibegal-cli node update . <node-id>"));
    assert!(agent_instructions.contains("vibegal-cli node move . <node-id>"));
    assert!(agent_instructions.contains("vibegal-cli node duplicate . <node-id>"));
    assert!(agent_instructions.contains("vibegal-cli node delete . <node-id>"));
    assert!(agent_instructions.contains("build . --target desktop --out dist-desktop"));
    assert!(agent_instructions.contains("--runtime tauri --out dist-light"));
    assert!(agent_instructions.contains(
        "/Applications/VibeGal-Studio.app/Contents/Resources/bin/vibegal-cli validate . --format json"
    ));
    assert!(agent_instructions.contains("missing_graph"));
    assert!(agent_instructions.contains("content/chapters/"));
    let project_readme = fs::read_to_string(project.join(".galstudio/README.md")).unwrap();
    assert!(project_readme.contains("content/graph.json"));
    assert!(project_readme.contains("nodes[].chapterId"));
    assert!(project_readme.contains("missing_graph"));
    assert!(project_readme.contains("Legacy Chapters"));
    assert!(project_readme.contains("content/chapters/"));
    assert!(project_readme.contains("Stable Instruction Identity"));
    assert!(project_readme.contains("sp_<UUIDv4>"));
    assert!(project_readme.contains(".galstudio/renderer-contract.md"));
    assert!(project_readme.contains("--target desktop --runtime electron|tauri"));
    assert!(project_readme.contains(
        "/Applications/VibeGal-Studio.app/Contents/Resources/bin/vibegal-cli validate . --format json"
    ));
    let renderer_contract =
        fs::read_to_string(project.join(".galstudio/renderer-contract.md")).unwrap();
    assert!(renderer_contract.contains("RendererManifest"));
    assert!(renderer_contract.contains("renderers/<id>/index.tsx"));
    assert!(renderer_contract.contains("@vibegal/engine"));
    let studio_root = Path::new(env!("CARGO_MANIFEST_DIR"));
    assert_eq!(
        fs::read(project.join(".galstudio/types/engine.d.ts")).unwrap(),
        fs::read(studio_root.join("generated/engine-types/engine.d.ts")).unwrap(),
        "engine.d.ts 必须与嵌入的生成物逐字节一致"
    );
    assert_eq!(
        fs::read(project.join(".galstudio/types/react.d.ts")).unwrap(),
        fs::read(studio_root.join("../templates/react-shim/react.d.ts")).unwrap(),
        "react.d.ts 必须与模板逐字节一致"
    );
    assert_eq!(
        fs::read_to_string(project.join("tsconfig.json")).unwrap(),
        fs::read_to_string(studio_root.join("../templates/project-tsconfig.json")).unwrap(),
        "tsconfig.json 必须与模板一致"
    );
    assert_eq!(
        fs::read_to_string(project.join("renderers/default/index.tsx")).unwrap(),
        "export default {};"
    );
    let opened = open_project_inner(project.to_string_lossy().as_ref()).unwrap();
    assert_eq!(opened.meta.name, "Existing Story");
    assert_eq!(opened.renderer_ids, vec!["default".to_string()]);
    assert!(opened.galstudio_ignored);
    let graph = opened.graph.expect("新项目应有 graph.json");
    assert_eq!(graph.entry_node_id, "start");
    assert_eq!(graph.chapters.len(), 1);
    assert_eq!(graph.chapters[0].title, "第一章");
    assert_eq!(graph.nodes[0].chapter_id, "chapter_1");
    assert_eq!(graph.nodes[0].file, "nodes/start.json");
    let start_node = opened
        .nodes
        .expect("新项目应加载默认节点")
        .into_iter()
        .find(|node| node.rel_path == "nodes/start.json")
        .and_then(|node| node.data)
        .expect("默认节点应可读取");
    let start_id = start_node[0]["id"]
        .as_str()
        .expect("默认旁白应由共享身份服务分配 ID");
    assert!(start_id.starts_with("sp_"));
    assert!(opened
        .project_report
        .expect("新项目应有校验报告")
        .project_issues
        .is_empty());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn existing_project_gitignore_is_read_only_and_warns_when_galstudio_is_tracked() {
    let root = unique_temp_dir("gitignore-boundary");
    let project = root.join("story");
    write_graph_project(
        &project,
        serde_json::json!({
            "version": 1,
            "entryNodeId": "start",
            "nodes": [{
                "id": "start",
                "title": "Start",
                "file": "nodes/start.json",
                "position": { "x": 0, "y": 0 }
            }],
            "edges": []
        }),
        &[("nodes/start.json", serde_json::json!([]))],
    );
    let existing = "dist/\n# keep project policy\n";
    write_text(&project.join(".gitignore"), existing);

    let opened = open_project_inner(project.to_string_lossy().as_ref()).unwrap();

    assert!(!opened.galstudio_ignored);
    assert_eq!(fs::read_to_string(project.join(".gitignore")).unwrap(), existing);
    assert!(!project.join(".galstudio").exists());

    write_text(&project.join(".gitignore"), "dist/\n/.galstudio/\n");
    let ignored = open_project_inner(project.to_string_lossy().as_ref()).unwrap();
    assert!(ignored.galstudio_ignored);
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn project_self_description_reports_missing_files_and_repairs_only_on_request() {
    let root = unique_temp_dir("ensure-self-description");
    let renderer_template = root.join("template");
    let project = root.join("story");
    write_text(&renderer_template.join("index.tsx"), "export default {};");
    initialize_project_root(&project, "story", "default", &renderer_template).unwrap();

    // 删除部分自描述文件 + 篡改一个既有文件。
    fs::remove_file(project.join("tsconfig.json")).unwrap();
    fs::remove_file(project.join(".galstudio/types/engine.d.ts")).unwrap();
    fs::remove_file(project.join(".galstudio/schemas/variables.json")).unwrap();
    write_text(&project.join(".galstudio/README.md"), "user edited");

    let missing = missing_project_self_description_files(&project).unwrap();
    assert_eq!(
        missing,
        vec![
            ".galstudio/schemas/variables.json".to_string(),
            ".galstudio/types/engine.d.ts".to_string(),
            "tsconfig.json".to_string(),
        ]
    );
    assert!(!project.join("tsconfig.json").exists());
    assert!(!project.join(".galstudio/types/engine.d.ts").exists());
    assert!(!project.join(".galstudio/schemas/variables.json").exists());

    let project_root = ProjectRoot::open(&project).unwrap();
    let repaired = ensure_project_self_description(&project_root).unwrap();
    assert_eq!(repaired, missing);

    let studio_root = Path::new(env!("CARGO_MANIFEST_DIR"));
    assert_eq!(
        fs::read_to_string(project.join("tsconfig.json")).unwrap(),
        fs::read_to_string(studio_root.join("../templates/project-tsconfig.json")).unwrap(),
        "缺失的 tsconfig.json 应被回填"
    );
    assert_eq!(
        fs::read(project.join(".galstudio/types/engine.d.ts")).unwrap(),
        fs::read(studio_root.join("generated/engine-types/engine.d.ts")).unwrap(),
        "缺失的 engine.d.ts 应被回填"
    );
    assert!(project.join(".galstudio/schemas/variables.json").is_file());
    assert_eq!(
        fs::read_to_string(project.join(".galstudio/README.md")).unwrap(),
        "user edited",
        "已存在的文件不能被覆盖"
    );
    let _ = fs::remove_dir_all(&root);
}

#[cfg(unix)]
#[test]
fn project_self_description_repair_rejects_symlinked_parent_directory() {
    use std::os::unix::fs::symlink;

    let root = unique_temp_dir("repair-self-description-symlink");
    let renderer_template = root.join("template");
    let project = root.join("story");
    let outside = root.join("outside");
    write_text(&renderer_template.join("index.tsx"), "export default {};");
    initialize_project_root(&project, "story", "default", &renderer_template).unwrap();
    fs::remove_dir_all(project.join(".galstudio/schemas")).unwrap();
    fs::create_dir_all(&outside).unwrap();
    symlink(&outside, project.join(".galstudio/schemas")).unwrap();

    let project_root = ProjectRoot::open(&project).unwrap();
    let error = ensure_project_self_description(&project_root).unwrap_err();

    assert!(error.contains("符号链接"), "unexpected error: {error}");
    assert!(fs::read_dir(&outside).unwrap().next().is_none());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn example_project_preflight_checks_every_content_target_before_writing() {
    let root = unique_temp_dir("example-init-conflict");
    let renderer_template = root.join("renderer-template");
    let project = root.join("story");
    let example_content = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/example-content");
    let conflict = project.join("content/assets/backgrounds/ocean_dawn.svg");
    write_text(&renderer_template.join("index.tsx"), "export default {};");
    write_text(&conflict, "keep me");

    let error = initialize_project_root_from_example(
        &project,
        "Story",
        "default",
        &renderer_template,
        &example_content,
    )
    .unwrap_err();

    assert!(error.contains("覆盖已有文件"), "unexpected error: {error}");
    assert_eq!(fs::read_to_string(conflict).unwrap(), "keep me");
    assert!(!project.join("gal.project.json").exists());
    assert!(!project.join("content/graph.json").exists());
    assert!(!project.join("renderers/default/index.tsx").exists());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn initialize_project_root_does_not_overwrite_existing_files() {
    let root = unique_temp_dir("init-conflict");
    let renderer_template = root.join("template");
    let project = root.join("story");
    write_text(&renderer_template.join("index.tsx"), "export default {};");
    write_text(&project.join("content/meta.json"), "keep me");

    let result = initialize_project_root(&project, "story", "default", &renderer_template);

    assert!(result.is_err());
    assert_eq!(
        fs::read_to_string(project.join("content/meta.json")).unwrap(),
        "keep me"
    );
    assert!(!project.join("gal.project.json").exists());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn initialize_project_root_refuses_to_overwrite_existing_gitignore() {
    let root = unique_temp_dir("init-gitignore-conflict");
    let renderer_template = root.join("template");
    let project = root.join("story");
    write_text(&renderer_template.join("index.tsx"), "export default {};");
    write_text(&project.join(".gitignore"), "keep me\n");

    let result = initialize_project_root(&project, "story", "default", &renderer_template);

    assert!(result.is_err());
    assert_eq!(fs::read_to_string(project.join(".gitignore")).unwrap(), "keep me\n");
    assert!(!project.join("gal.project.json").exists());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn initialize_project_root_does_not_overwrite_self_description_files() {
    let root = unique_temp_dir("init-self-description-conflict");
    let renderer_template = root.join("template");
    let project = root.join("story");
    write_text(&renderer_template.join("index.tsx"), "export default {};");
    write_text(&project.join("AGENTS.md"), "keep me");

    let result = initialize_project_root(&project, "story", "default", &renderer_template);

    assert!(result.is_err());
    assert_eq!(
        fs::read_to_string(project.join("AGENTS.md")).unwrap(),
        "keep me"
    );
    assert!(!project.join("gal.project.json").exists());

    let project_with_schema = root.join("story-with-schema");
    write_text(
        &project_with_schema.join(".galstudio/schemas/graph.json"),
        "{}",
    );

    let result = initialize_project_root(
        &project_with_schema,
        "story-with-schema",
        "default",
        &renderer_template,
    );

    assert!(result.is_err());
    assert_eq!(
        fs::read_to_string(project_with_schema.join(".galstudio/schemas/graph.json")).unwrap(),
        "{}"
    );
    assert!(!project_with_schema.join("gal.project.json").exists());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn project_watch_filter_only_accepts_project_data_and_renderer_paths() {
    let root = Path::new("/tmp/story");

    assert_eq!(
        classify_project_watch_path(root, &root.join("content/nodes/start.json")),
        Some(ProjectWatchKind::Content)
    );
    assert_eq!(
        classify_project_watch_path(root, &root.join("renderers/default/index.tsx")),
        Some(ProjectWatchKind::Renderer)
    );
    assert_eq!(
        classify_project_watch_path(root, &root.join("gal.project.json")),
        Some(ProjectWatchKind::ProjectMeta)
    );
    assert_eq!(
        classify_project_watch_path(root, &root.join("node_modules/pkg/index.js")),
        None
    );
    assert_eq!(
        classify_project_watch_path(root, &root.join("README.md")),
        None
    );
}

#[test]
fn debounce_state_coalesces_changes_until_quiet_window() {
    let root = "/tmp/story".to_string();
    let mut state = ProjectDebounceState::default();
    let start = std::time::Instant::now();
    let delay = std::time::Duration::from_millis(250);

    state.record(
        ProjectChangedPayload::new(
            root.clone(),
            false,
            ProjectFileChange {
                kind: ProjectFileChangeKind::Modify,
                paths: vec!["content/nodes/start.json".to_string()],
            },
        ),
        start,
    );
    assert_eq!(
        state.due(start + std::time::Duration::from_millis(249), delay),
        None
    );

    state.record(
        ProjectChangedPayload::new(
            root.clone(),
            true,
            ProjectFileChange {
                kind: ProjectFileChangeKind::Rename,
                paths: vec![
                    "content/nodes/start.json".to_string(),
                    "content/nodes/renamed.json".to_string(),
                ],
            },
        ),
        start + std::time::Duration::from_millis(100),
    );
    assert_eq!(
        state.due(start + std::time::Duration::from_millis(300), delay),
        None
    );

    let payload = state
        .due(start + std::time::Duration::from_millis(351), delay)
        .unwrap();
    assert_eq!(payload.project_path, root);
    assert!(payload.renderer_changed);
    assert_eq!(payload.event_count, 2);
    assert_eq!(
        payload.changes,
        vec![
            ProjectFileChange {
                kind: ProjectFileChangeKind::Modify,
                paths: vec!["content/nodes/start.json".to_string()],
            },
            ProjectFileChange {
                kind: ProjectFileChangeKind::Rename,
                paths: vec![
                    "content/nodes/start.json".to_string(),
                    "content/nodes/renamed.json".to_string(),
                ],
            },
        ],
    );
    assert_eq!(
        state.due(start + std::time::Duration::from_millis(700), delay),
        None
    );
}

#[test]
fn watcher_event_kinds_preserve_delete_and_rename_states() {
    use notify::event::{ModifyKind, RemoveKind, RenameMode};
    use notify::EventKind;

    assert_eq!(
        project_file_change_kind(&EventKind::Remove(RemoveKind::File)),
        ProjectFileChangeKind::Remove,
    );
    assert_eq!(
        project_file_change_kind(&EventKind::Modify(ModifyKind::Name(
            RenameMode::Both,
        ))),
        ProjectFileChangeKind::Rename,
    );
}

#[test]
fn watcher_reports_external_missing_id_change_without_rewriting_the_node() {
    use std::sync::mpsc;
    use std::time::Duration;

    let root = unique_temp_dir("watcher-missing-id-no-repair");
    let project = root.join("project");
    write_graph_project(
        &project,
        serde_json::json!({
            "version": 1,
            "entryNodeId": "start",
            "nodes": [{
                "id": "start",
                "title": "Start",
                "file": "nodes/start.json",
                "position": { "x": 0, "y": 0 }
            }],
            "edges": []
        }),
        &[(
            "nodes/start.json",
            serde_json::json!([{ "t": "narrate", "id": "sp_existing", "text": "Before" }]),
        )],
    );
    let watchers = ProjectWatchers::default();
    let (tx, rx) = mpsc::channel();
    watch(project.to_str().unwrap(), &watchers, move |payload| {
        let _ = tx.send(payload);
    })
    .unwrap();

    let node_path = project.join("content/nodes/start.json");
    let external_text = "[\n  { \"t\": \"narrate\", \"text\": \"External draft\" }\n]\n";
    fs::write(&node_path, external_text).unwrap();

    let payload = rx
        .recv_timeout(Duration::from_secs(5))
        .expect("watcher should report the external content change");
    assert_eq!(
        payload.project_path,
        project.canonicalize().unwrap().to_string_lossy()
    );
    assert!(!payload.renderer_changed);
    std::thread::sleep(Duration::from_millis(500));
    assert_eq!(fs::read_to_string(&node_path).unwrap(), external_text);

    unwatch(project.to_str().unwrap(), &watchers).unwrap();
    let _ = fs::remove_dir_all(&root);
}
