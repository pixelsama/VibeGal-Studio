use super::support::*;

#[test]
fn initialize_project_root_adds_project_files_to_selected_directory() {
    let root = unique_temp_dir("init-root");
    let renderer_template = root.join("template");
    let project = root.join("Existing Story");
    write_text(&renderer_template.join("index.tsx"), "export default {};");
    fs::create_dir_all(&project).unwrap();

    initialize_project_root(&project, "Existing Story", &renderer_template).unwrap();

    assert!(project.join("gal.project.json").is_file());
    assert!(project.join("content/manifest.json").is_file());
    assert!(project.join("content/meta.json").is_file());
    assert!(project.join("content/graph.json").is_file());
    assert!(project.join("content/nodes/start.json").is_file());
    assert!(!project.join("content/chapters").exists());
    assert!(project.join("content/assets").is_dir());
    assert!(project.join("AGENTS.md").is_file());
    assert!(project.join(".galstudio/README.md").is_file());
    assert!(project.join(".galstudio/renderer-contract.md").is_file());
    for schema_name in ["graph", "nodeFile", "manifest", "meta"] {
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
    assert!(agent_instructions.contains("Instruction[]"));
    assert!(agent_instructions.contains("renderers/<id>/index.tsx"));
    assert!(agent_instructions.contains("vibegal-cli validate . --format json"));
    assert!(agent_instructions.contains(
        "/Applications/VibeGal-Studio.app/Contents/Resources/bin/vibegal-cli validate . --format json"
    ));
    assert!(agent_instructions.contains("missing_graph"));
    assert!(agent_instructions.contains("content/chapters/"));
    let project_readme = fs::read_to_string(project.join(".galstudio/README.md")).unwrap();
    assert!(project_readme.contains("content/graph.json"));
    assert!(project_readme.contains("missing_graph"));
    assert!(project_readme.contains("Legacy Chapters"));
    assert!(project_readme.contains("content/chapters/"));
    assert!(project_readme.contains(".galstudio/renderer-contract.md"));
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
    let graph = opened.graph.expect("新项目应有 graph.json");
    assert_eq!(graph.entry_node_id, "start");
    assert_eq!(graph.nodes[0].file, "nodes/start.json");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn ensure_project_self_description_backfills_missing_files_without_overwriting() {
    let root = unique_temp_dir("ensure-self-description");
    let renderer_template = root.join("template");
    let project = root.join("story");
    write_text(&renderer_template.join("index.tsx"), "export default {};");
    initialize_project_root(&project, "story", &renderer_template).unwrap();

    // 删除部分自描述文件 + 篡改一个既有文件
    fs::remove_file(project.join("tsconfig.json")).unwrap();
    fs::remove_file(project.join(".galstudio/types/engine.d.ts")).unwrap();
    write_text(&project.join(".galstudio/README.md"), "user edited");

    ensure_project_self_description(&project).unwrap();

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
    assert_eq!(
        fs::read_to_string(project.join(".galstudio/README.md")).unwrap(),
        "user edited",
        "已存在的文件不能被覆盖"
    );
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn initialize_project_root_does_not_overwrite_existing_files() {
    let root = unique_temp_dir("init-conflict");
    let renderer_template = root.join("template");
    let project = root.join("story");
    write_text(&renderer_template.join("index.tsx"), "export default {};");
    write_text(&project.join("content/meta.json"), "keep me");

    let result = initialize_project_root(&project, "story", &renderer_template);

    assert!(result.is_err());
    assert_eq!(
        fs::read_to_string(project.join("content/meta.json")).unwrap(),
        "keep me"
    );
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

    let result = initialize_project_root(&project, "story", &renderer_template);

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

    state.record(ProjectChangedPayload::new(root.clone(), false), start);
    assert_eq!(
        state.due(start + std::time::Duration::from_millis(249), delay),
        None
    );

    state.record(
        ProjectChangedPayload::new(root.clone(), true),
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
    assert_eq!(
        state.due(start + std::time::Duration::from_millis(700), delay),
        None
    );
}
