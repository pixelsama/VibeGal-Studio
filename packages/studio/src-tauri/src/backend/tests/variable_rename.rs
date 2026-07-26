use super::support::*;

/// 建一个「变量被条件读、被指令写」的完整项目，用来验证重命名会同时改到三处。
fn write_rename_project(project: &Path) {
    write_graph_project_with_files(
        project,
        serde_json::json!({
            "version": 1,
            "entryNodeId": "start",
            "chapters": [{ "id": "c1", "title": "第一章" }],
            "nodes": [
                { "id": "start", "title": "开场", "file": "nodes/start.json", "chapterId": "c1", "position": { "x": 0, "y": 0 } },
                { "id": "love", "title": "告白", "file": "nodes/love.json", "chapterId": "c1", "position": { "x": 200, "y": 0 } },
                { "id": "plain", "title": "普通", "file": "nodes/plain.json", "chapterId": "c1", "position": { "x": 200, "y": 80 } }
            ],
            "edges": [
                { "id": "start__love", "from": "start", "to": "love", "mode": "auto", "label": null, "condition": "affection >= 60 && affection_yuki < 3" },
                { "id": "start__plain", "from": "start", "to": "plain", "mode": "auto", "label": null, "condition": null }
            ]
        }),
        &[
            (
                "nodes/start.json",
                r#"[{"t":"set","key":"affection","expr":"affection + 3"},{"t":"set","key":"affection_yuki","value":1},{"t":"set","key":"route","value":"affection"}]"#,
            ),
            ("nodes/love.json", "[]"),
            ("nodes/plain.json", "[]"),
        ],
    );
    write_json(
        &project.join("content/variables.json"),
        &serde_json::json!({
            "version": 1,
            "variables": {
                "affection": { "kind": "meter", "type": "number", "default": 0, "nullable": false, "scope": "run" },
                "affection_yuki": { "kind": "meter", "type": "number", "default": 0, "nullable": false, "scope": "run" },
                "route": { "type": "string", "default": "affection", "nullable": false, "scope": "run" }
            }
        }),
    )
    .unwrap();
}

fn read(project: &Path, rel: &str) -> serde_json::Value {
    serde_json::from_str(&fs::read_to_string(project.join(rel)).unwrap()).unwrap()
}

#[test]
fn rename_variable_rewrites_registry_conditions_and_instructions_together() {
    let root = unique_temp_dir("rename-variable");
    let project = root.join("project");
    write_rename_project(&project);

    let result = rename_variable(
        project.to_string_lossy().into_owned(),
        "affection".to_string(),
        "love_points".to_string(),
    )
    .unwrap();

    let variables = read(&project, "content/variables.json");
    assert!(variables["variables"]["love_points"].is_object());
    assert!(variables["variables"]["affection"].is_null());
    // 声明内容原样保留，只换了键。
    assert_eq!(variables["variables"]["love_points"]["kind"], "meter");

    let graph = read(&project, "content/graph.json");
    assert_eq!(
        graph["edges"][0]["condition"],
        "love_points >= 60 && affection_yuki < 3"
    );

    let start = read(&project, "content/nodes/start.json");
    assert_eq!(start[0]["key"], "love_points");
    assert_eq!(start[0]["expr"], "love_points + 3");

    assert_eq!(result.updated_conditions, 1);
    assert_eq!(result.updated_nodes, 1);
    assert!(result.variables_revision.is_some());
    assert!(result.graph_revision.is_some());

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn rename_variable_leaves_similar_names_and_string_literals_alone() {
    let root = unique_temp_dir("rename-variable-substring");
    let project = root.join("project");
    write_rename_project(&project);

    rename_variable(
        project.to_string_lossy().into_owned(),
        "affection".to_string(),
        "love_points".to_string(),
    )
    .unwrap();

    let graph = read(&project, "content/graph.json");
    // affection_yuki 只是碰巧以 affection 开头，不能被改。
    assert!(graph["edges"][0]["condition"]
        .as_str()
        .unwrap()
        .contains("affection_yuki"));

    let start = read(&project, "content/nodes/start.json");
    assert_eq!(start[1]["key"], "affection_yuki");
    // 字符串字面量 "affection" 是数据不是引用，同样不能被改。
    assert_eq!(start[2]["value"], "affection");

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn rename_variable_rejects_a_name_that_is_already_taken() {
    let root = unique_temp_dir("rename-variable-conflict");
    let project = root.join("project");
    write_rename_project(&project);

    let error = rename_variable(
        project.to_string_lossy().into_owned(),
        "affection".to_string(),
        "route".to_string(),
    )
    .unwrap_err();
    assert!(error.contains("已存在"), "unexpected error: {error}");

    // 冲突时不得留下任何部分改动。
    let variables = read(&project, "content/variables.json");
    assert!(variables["variables"]["affection"].is_object());
    let graph = read(&project, "content/graph.json");
    assert_eq!(
        graph["edges"][0]["condition"],
        "affection >= 60 && affection_yuki < 3"
    );

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn rename_variable_rejects_an_unknown_source() {
    let root = unique_temp_dir("rename-variable-missing");
    let project = root.join("project");
    write_rename_project(&project);

    let error = rename_variable(
        project.to_string_lossy().into_owned(),
        "does_not_exist".to_string(),
        "whatever".to_string(),
    )
    .unwrap_err();
    assert!(error.contains("不存在"), "unexpected error: {error}");

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn rename_variable_rejects_a_reserved_target_namespace() {
    let root = unique_temp_dir("rename-variable-reserved");
    let project = root.join("project");
    write_rename_project(&project);

    // chose./seen./system. 由运行时拥有，契约校验必须拦下。
    let error = rename_variable(
        project.to_string_lossy().into_owned(),
        "affection".to_string(),
        "chose.start__love".to_string(),
    )
    .unwrap_err();
    assert!(!error.is_empty());

    let variables = read(&project, "content/variables.json");
    assert!(variables["variables"]["affection"].is_object());

    let _ = fs::remove_dir_all(&root);
}
