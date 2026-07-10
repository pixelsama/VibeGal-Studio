use super::support::*;

#[test]
fn save_graph_then_open_project_roundtrip() {
    let root = unique_temp_dir("save-graph-roundtrip");
    let project = root.join("project");
    write_minimal_project(&project);
    write_text(
        &project.join("content/nodes/prologue.json"),
        r#"[{"t":"wait","ms":1}]"#,
    );
    write_text(
        &project.join("content/nodes/ending.json"),
        r#"[{"t":"wait","ms":2}]"#,
    );

    save_graph(
        project.to_string_lossy().into_owned(),
        graph_input("nodes/prologue.json", "Prologue"),
        None,
    )
    .unwrap();

    let opened = open_project_inner(project.to_string_lossy().as_ref()).unwrap();
    let graph = opened.graph.unwrap();
    assert_eq!(graph.entry_node_id, "prologue");
    assert_eq!(graph.nodes.len(), 2);
    assert_eq!(graph.nodes[0].file, "nodes/prologue.json");
    assert_eq!(graph.nodes[0].position.x, 120.0);
    assert_eq!(graph.edges[0].id, "prologue__ending");
    assert_eq!(opened.nodes.unwrap().len(), 2);
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn open_project_loads_graph_when_present() {
    let root = unique_temp_dir("graph-present");
    let project = root.join("project");
    write_graph_project(
        &project,
        serde_json::json!({
            "version": 1,
            "entryNodeId": "prologue",
            "nodes": [
                {
                    "id": "prologue",
                    "title": "Prologue",
                    "file": "nodes/prologue.json",
                    "position": { "x": 120.0, "y": 180.0 }
                },
                {
                    "id": "first_meeting",
                    "title": "First Meeting",
                    "file": "nodes/first_meeting.json",
                    "position": { "x": 380.0, "y": 180.0 }
                }
            ],
            "edges": [
                {
                    "id": "prologue__first_meeting",
                    "from": "prologue",
                    "to": "first_meeting",
                    "condition": null
                }
            ]
        }),
        &[
            (
                "nodes/prologue.json",
                serde_json::json!([{ "t": "narrate", "id": "start_01", "text": "Start" }]),
            ),
            (
                "nodes/first_meeting.json",
                serde_json::json!([{ "t": "say", "id": "ending_01", "who": "hero", "text": "Hi" }]),
            ),
        ],
    );

    let opened = open_project_inner(project.to_string_lossy().as_ref()).unwrap();
    let graph = opened.graph.unwrap();
    let nodes = opened.nodes.unwrap();

    assert_eq!(graph.entry_node_id, "prologue");
    assert_eq!(graph.nodes.len(), 2);
    assert_eq!(graph.edges.len(), 1);
    assert_eq!(nodes.len(), 2);
    assert_eq!(nodes[0].rel_path, "nodes/prologue.json");
    assert!(nodes[0].data.is_some());
    assert_eq!(nodes[1].rel_path, "nodes/first_meeting.json");
    assert!(nodes[1].data.is_some());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn graph_projection_uses_contract_defaults_without_rewriting_raw_json() {
    let root = unique_temp_dir("graph-contract-defaults");
    let project = root.join("project");
    write_graph_project(
        &project,
        serde_json::json!({
            "entryNodeId": "start",
            "nodes": [
                { "id": "start", "file": "nodes/start.json" },
                { "id": "ending", "file": "nodes/ending.json" }
            ],
            "edges": [{ "id": "start__ending", "from": "start", "to": "ending" }]
        }),
        &[
            ("nodes/start.json", serde_json::json!([])),
            ("nodes/ending.json", serde_json::json!([])),
        ],
    );
    let graph_path = project.join("content/graph.json");
    let before = fs::read(&graph_path).unwrap();

    let opened = open_project_inner(project.to_string_lossy().as_ref()).unwrap();
    let graph = opened.graph.unwrap();

    assert_eq!(graph.version, 1);
    assert_eq!(graph.nodes[0].title, "start");
    assert_eq!(graph.nodes[0].position.x, 0.0);
    assert_eq!(graph.nodes[0].position.y, 0.0);
    assert_eq!(graph.edges[0].mode, "linear");
    assert_eq!(graph.edges[0].label, None);
    assert_eq!(graph.edges[0].condition, None);
    assert_eq!(fs::read(&graph_path).unwrap(), before);
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn open_project_reports_legacy_chapters_without_synthesizing_graph() {
    let root = unique_temp_dir("legacy-chapters-report");
    let project = root.join("project");
    write_legacy_chapter_project(&project, serde_json::json!(["chapters/ch01.json"]));
    write_text(&project.join("content/chapters/ch01.json"), "[]");

    let opened = open_project_inner(project.to_string_lossy().as_ref()).unwrap();
    let graph = opened.graph.unwrap();
    let report = opened
        .project_report
        .expect("open_project 应返回 project_report");

    assert!(graph.nodes.is_empty(), "旧 chapters 不应再被合成图节点");
    assert!(graph.edges.is_empty(), "旧 chapters 不应再被合成图连线");
    let issue = report
        .project_issues
        .iter()
        .find(|issue| issue.source == "graph" && issue.code == "legacy_chapters_not_supported")
        .expect("旧 chapters 应进入全局项目错误");
    assert_eq!(issue.severity, GraphIssueSeverity::Error);
    assert_eq!(issue.file.as_deref(), Some("content/meta.json"));
    assert_eq!(issue.json_path.as_deref(), Some("$.chapters"));
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn open_project_reports_missing_graph_when_graph_json_is_absent() {
    let root = unique_temp_dir("missing-graph");
    let project = root.join("project");
    write_minimal_project(&project);

    let opened = open_project_inner(project.to_string_lossy().as_ref()).unwrap();
    let graph = opened.graph.unwrap();
    let nodes = opened.nodes.unwrap();
    let report = opened
        .project_report
        .expect("open_project 应返回 project_report");

    assert_eq!(graph.entry_node_id, "");
    assert!(graph.nodes.is_empty());
    assert!(graph.edges.is_empty());
    assert!(nodes.is_empty());
    assert!(
        report
            .project_issues
            .iter()
            .any(|issue| issue.source == "graph" && issue.code == "missing_graph"),
        "缺少 graph.json 应进入项目错误"
    );
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn open_project_rejects_graph_node_file_outside_content_dir() {
    let root = unique_temp_dir("graph-escape");
    let project = root.join("project");
    write_graph_project(
        &project,
        serde_json::json!({
            "version": 1,
            "entryNodeId": "escape",
            "nodes": [
                {
                    "id": "escape",
                    "title": "Escape",
                    "file": "../../outside.json",
                    "position": { "x": 0, "y": 0 }
                }
            ],
            "edges": []
        }),
        &[],
    );
    write_text(&root.join("outside.json"), "[]");

    let result = open_project_inner(project.to_string_lossy().as_ref());
    assert!(result.is_err());
    assert!(result.err().unwrap().contains("路径越界"));
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn open_project_skips_missing_node_file_with_warning() {
    let root = unique_temp_dir("graph-missing-node");
    let project = root.join("project");
    write_graph_project(
        &project,
        serde_json::json!({
            "version": 1,
            "entryNodeId": "present",
            "nodes": [
                {
                    "id": "present",
                    "title": "Present",
                    "file": "nodes/present.json",
                    "position": { "x": 0, "y": 0 }
                },
                {
                    "id": "missing",
                    "title": "Missing",
                    "file": "nodes/missing.json",
                    "position": { "x": 260, "y": 0 }
                }
            ],
            "edges": []
        }),
        &[(
            "nodes/present.json",
            serde_json::json!([{ "t": "narrate", "id": "here_01", "text": "Here" }]),
        )],
    );

    let opened = open_project_inner(project.to_string_lossy().as_ref()).unwrap();
    let nodes = opened.nodes.unwrap();

    assert_eq!(nodes.len(), 2);
    assert_eq!(nodes[0].rel_path, "nodes/present.json");
    assert!(nodes[0].data.is_some());
    assert_eq!(nodes[1].rel_path, "nodes/missing.json");
    assert!(nodes[1].data.is_none());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn open_project_includes_graph_report() {
    let root = unique_temp_dir("graph-report");
    let project = root.join("project");
    write_graph_project(
        &project,
        serde_json::json!({
            "version": 1,
            "entryNodeId": "prologue",
            "nodes": [
                {
                    "id": "prologue",
                    "title": "Prologue",
                    "file": "nodes/prologue.json",
                    "position": { "x": 0, "y": 0 }
                }
            ],
            "edges": []
        }),
        &[("nodes/prologue.json", serde_json::json!([]))],
    );

    let opened = open_project_inner(project.to_string_lossy().as_ref()).unwrap();
    let report = opened.graph_report.unwrap();

    assert!(report.graph_issues.is_empty());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn open_project_reports_non_string_edge_mode() {
    let root = unique_temp_dir("graph-report-invalid-mode");
    let project = root.join("project");
    write_graph_project(
        &project,
        serde_json::json!({
            "version": 1,
            "entryNodeId": "start",
            "nodes": [
                { "id": "start", "title": "Start", "file": "nodes/start.json", "position": { "x": 0, "y": 0 } },
                { "id": "ending", "title": "Ending", "file": "nodes/ending.json", "position": { "x": 260, "y": 0 } }
            ],
            "edges": [
                { "id": "start__ending", "from": "start", "to": "ending", "mode": 7 }
            ]
        }),
        &[
            ("nodes/start.json", serde_json::json!([])),
            ("nodes/ending.json", serde_json::json!([])),
        ],
    );

    let opened = open_project_inner(project.to_string_lossy().as_ref()).unwrap();
    let report = opened.graph_report.unwrap();

    let issue = report
        .graph_issues
        .iter()
        .find(|issue| issue.code == "graph_invalid_structure")
        .expect("non-string edge mode should be reported as a contract error");
    assert_eq!(issue.severity, GraphIssueSeverity::Error);
    assert_eq!(issue.edge_id, None);
    assert_eq!(issue.json_path.as_deref(), Some("$.edges[0].mode"));
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn validate_graph_does_not_block_loading() {
    let root = unique_temp_dir("graph-report-error");
    let project = root.join("project");
    write_graph_project(
        &project,
        serde_json::json!({
            "version": 1,
            "entryNodeId": "missing-entry",
            "nodes": [
                {
                    "id": "prologue",
                    "title": "Prologue",
                    "file": "nodes/prologue.json",
                    "position": { "x": 0, "y": 0 }
                }
            ],
            "edges": []
        }),
        &[("nodes/prologue.json", serde_json::json!([]))],
    );

    let opened = open_project_inner(project.to_string_lossy().as_ref()).unwrap();
    let issues = opened.graph_report.unwrap().graph_issues;

    assert!(issues.iter().any(|issue| {
        issue.code == "missing_entry_node" && issue.severity == GraphIssueSeverity::Error
    }));
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn open_project_rejects_graph_json_without_entry_node_id() {
    let root = unique_temp_dir("graph-no-entry");
    let project = root.join("project");
    write_graph_project(
        &project,
        serde_json::json!({
            "version": 1,
            "nodes": [
                {
                    "id": "prologue",
                    "title": "Prologue",
                    "file": "nodes/prologue.json",
                    "position": { "x": 0, "y": 0 }
                }
            ],
            "edges": []
        }),
        &[("nodes/prologue.json", serde_json::json!([]))],
    );

    let data = open_project_inner(project.to_string_lossy().as_ref()).unwrap();
    assert!(data.graph_report.unwrap().graph_issues.iter().any(|issue| {
        issue.code == "graph_invalid_structure"
            && issue.json_path.as_deref() == Some("$.entryNodeId")
    }));
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn open_project_reports_graph_version_above_rust_range() {
    let root = unique_temp_dir("graph-version-overflow");
    let project = root.join("project");
    write_graph_project(
        &project,
        serde_json::json!({ "version": 4_294_967_296u64, "entryNodeId": "start", "nodes": [], "edges": [] }),
        &[],
    );

    let data = open_project_inner(project.to_string_lossy().as_ref()).unwrap();
    assert!(data.graph_report.unwrap().graph_issues.iter().any(|issue| {
        issue.code == "graph_invalid_structure" && issue.json_path.as_deref() == Some("$.version")
    }));
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn save_file_rejects_invalid_node_content_by_contract() {
    let root = unique_temp_dir("save-node-contract");
    let project = root.join("project");
    write_minimal_project(&project);

    let result = save_file(
        project.to_string_lossy().into_owned(),
        "content/nodes/start.json".to_string(),
        r#"[{"t":"say","who":"hero"}]"#.to_string(),
        None,
    );

    assert!(result.is_err());
    assert!(!project.join("content/nodes/start.json").exists());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn save_file_cannot_bypass_control_document_contracts() {
    let root = unique_temp_dir("save-control-contract");
    let project = root.join("project");
    write_minimal_project(&project);
    write_json(
        &project.join("content/graph.json"),
        &serde_json::json!({ "entryNodeId": "", "nodes": [], "edges": [] }),
    )
    .unwrap();
    let cases = [
        ("content/graph.json", r#"{}"#),
        ("content/manifest.json", r#"[]"#),
        ("content/meta.json", r#"{"stage":{"width":10}}"#),
    ];

    for (rel_path, invalid_content) in cases {
        let path = project.join(rel_path);
        let before = fs::read(&path).unwrap();
        let result = save_file(
            project.to_string_lossy().into_owned(),
            rel_path.to_string(),
            invalid_content.to_string(),
            None,
        );

        assert!(
            result.is_err(),
            "{rel_path} must pass its embedded contract"
        );
        assert_eq!(fs::read(&path).unwrap(), before, "{rel_path} was modified");
    }
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn save_manifest_accepts_omitted_default_audio() {
    let root = unique_temp_dir("save-manifest-default-audio");
    let project = root.join("project");
    write_minimal_project(&project);

    save_manifest(
        project.to_string_lossy().into_owned(),
        serde_json::json!({ "characters": {}, "backgrounds": {} }),
        None,
    )
    .unwrap();

    let saved = read_json(&project.join("content/manifest.json")).unwrap();
    assert!(
        saved.get("audio").is_none(),
        "raw input must not be defaulted on disk"
    );
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn open_project_does_not_create_graph_json_when_reporting_missing_or_legacy_graph() {
    let root = unique_temp_dir("graph-no-mutate");
    let graph_project = root.join("graph-project");
    write_graph_project(
        &graph_project,
        serde_json::json!({
            "version": 1,
            "entryNodeId": "prologue",
            "nodes": [
                {
                    "id": "prologue",
                    "title": "Prologue",
                    "file": "nodes/prologue.json",
                    "position": { "x": 0, "y": 0 }
                }
            ],
            "edges": []
        }),
        &[("nodes/prologue.json", serde_json::json!([]))],
    );
    let graph_before = fs::read_to_string(graph_project.join("content/graph.json")).unwrap();

    let legacy_project = root.join("legacy-project");
    write_legacy_chapter_project(&legacy_project, serde_json::json!(["chapters/ch01.json"]));
    write_text(&legacy_project.join("content/chapters/ch01.json"), "[]");

    open_project_inner(graph_project.to_string_lossy().as_ref()).unwrap();
    open_project_inner(legacy_project.to_string_lossy().as_ref()).unwrap();

    assert_eq!(
        fs::read_to_string(graph_project.join("content/graph.json")).unwrap(),
        graph_before
    );
    assert!(!legacy_project.join("content/graph.json").exists());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn save_file_rejects_untrusted_project_root() {
    let dir = unique_temp_dir("untrusted-root");
    fs::create_dir_all(&dir).unwrap();
    let target = dir.join("owned.txt");

    let result = save_file(
        dir.to_string_lossy().into_owned(),
        "owned.txt".to_string(),
        "nope".to_string(),
        None,
    );

    assert!(result.is_err());
    assert!(!target.exists());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn open_project_reports_legacy_chapter_paths_without_resolving_them() {
    let root = unique_temp_dir("chapter-escape");
    let project = root.join("project");
    write_legacy_chapter_project(&project, serde_json::json!(["../../outside.json"]));
    write_text(&root.join("outside.json"), "[]");

    let opened = open_project_inner(project.to_string_lossy().as_ref()).unwrap();
    let issues = opened.project_report.unwrap().project_issues;

    assert!(issues
        .iter()
        .any(|issue| { issue.source == "graph" && issue.code == "legacy_chapters_not_supported" }));
    assert!(root.join("outside.json").exists());
    let _ = fs::remove_dir_all(&root);
}
