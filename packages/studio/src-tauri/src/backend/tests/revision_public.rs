use super::support::*;
use std::collections::BTreeSet;

#[test]
fn file_revision_changes_when_file_changes() {
    let root = unique_temp_dir("file-revision-changes");
    let project = root.join("project");
    write_minimal_project(&project);
    let rel_path = "content/nodes/a.json";
    write_text(&project.join(rel_path), "[]");

    let before = file_revision(&project, rel_path).unwrap().unwrap();
    write_text(&project.join(rel_path), "[1]");
    let after = file_revision(&project, rel_path).unwrap().unwrap();

    assert_ne!(before.size, after.size);
    assert_ne!(before.sha256, after.sha256);
    assert_eq!(after.sha256.as_deref().map(str::len), Some(64));
    assert_eq!(after.rel_path, rel_path);
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn expected_revision_rejects_same_size_content_with_spoofed_metadata() {
    let root = unique_temp_dir("file-revision-hash-conflict");
    let project = root.join("project");
    write_minimal_project(&project);
    let rel_path = "content/nodes/a.json";
    write_text(&project.join(rel_path), "[1]");

    let expected = file_revision(&project, rel_path).unwrap().unwrap();
    write_text(&project.join(rel_path), "[2]");
    let mut hash_mismatch = file_revision(&project, rel_path).unwrap().unwrap();
    hash_mismatch.sha256 = expected.sha256;

    let error = ensure_expected_revision(
        &project,
        rel_path,
        Some(serde_json::to_value(hash_mismatch).unwrap()),
    )
    .unwrap_err();

    assert!(error.contains("write_conflict"));
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn open_project_returns_graph_manifest_and_node_revisions() {
    let root = unique_temp_dir("open-project-revisions");
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
        &[("nodes/present.json", serde_json::json!([]))],
    );

    let opened = open_project_inner(project.to_string_lossy().as_ref()).unwrap();
    let node_revisions = opened.node_revisions.unwrap();

    assert_eq!(
        opened.graph_revision.as_ref().unwrap().rel_path,
        "content/graph.json"
    );
    assert_eq!(
        opened.project_revision.as_ref().unwrap().rel_path,
        "gal.project.json"
    );
    assert_eq!(
        opened.manifest_revision.as_ref().unwrap().rel_path,
        "content/manifest.json"
    );
    assert_eq!(
        opened.meta_revision.as_ref().unwrap().rel_path,
        "content/meta.json"
    );
    assert_eq!(
        node_revisions
            .get("nodes/present.json")
            .unwrap()
            .as_ref()
            .unwrap()
            .rel_path,
        "content/nodes/present.json"
    );
    assert!(node_revisions.get("nodes/missing.json").unwrap().is_none());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn public_project_and_issue_json_field_names_remain_stable() {
    let root = unique_temp_dir("public-json-contract");
    let project = root.join("project");
    write_graph_project(
        &project,
        serde_json::json!({
            "version": 1,
            "entryNodeId": "a",
            "nodes": [{ "id": "a", "file": "nodes/a.json" }],
            "edges": []
        }),
        &[("nodes/a.json", serde_json::json!([]))],
    );

    let project_json =
        serde_json::to_value(open_project_inner(project.to_string_lossy().as_ref()).unwrap())
            .unwrap();
    let keys = |value: &serde_json::Value| {
        value
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<BTreeSet<_>>()
    };
    assert_eq!(
        keys(&project_json),
        BTreeSet::from(
            [
                "path",
                "meta",
                "content",
                "rendererIds",
                "projectRevision",
                "graph",
                "nodes",
                "graphRevision",
                "manifestRevision",
                "metaRevision",
                "nodeRevisions",
                "fixtures",
                "graphReport",
                "assetReport",
                "projectReport",
            ]
            .map(str::to_string)
        )
    );
    assert_eq!(
        keys(&project_json["meta"]),
        BTreeSet::from(["name", "activeRendererId", "createdAt"].map(str::to_string))
    );
    assert_eq!(
        keys(&project_json["content"]),
        BTreeSet::from(["manifest", "meta", "variables"].map(str::to_string))
    );

    let issue_json = serde_json::to_value(ProjectIssue {
        severity: GraphIssueSeverity::Error,
        source: "node".to_string(),
        code: "instruction_invalid_field".to_string(),
        message: "invalid".to_string(),
        file: Some("content/nodes/a.json".to_string()),
        json_path: Some("$[0]".to_string()),
        node_id: Some("a".to_string()),
        edge_id: Some("edge".to_string()),
    })
    .unwrap();
    assert_eq!(
        keys(&issue_json),
        BTreeSet::from(
            ["severity", "source", "code", "message", "file", "jsonPath", "nodeId", "edgeId",]
                .map(str::to_string)
        )
    );

    // fixture 条目的公开 JSON 形状同样钉住：path + value 必有，title 可选。
    let fixture_json = serde_json::to_value(FixtureEntry {
        path: "content/fixtures/dawn.json".to_string(),
        title: None,
        value: serde_json::json!({ "state": {} }),
    })
    .unwrap();
    assert_eq!(
        keys(&fixture_json),
        BTreeSet::from(["path", "value"].map(str::to_string))
    );

    let _ = fs::remove_dir_all(root);
}

#[test]
fn save_file_rejects_stale_revision() {
    let root = unique_temp_dir("save-file-stale");
    let project = root.join("project");
    write_minimal_project(&project);
    let rel_path = "content/nodes/a.json";
    write_text(&project.join(rel_path), "[]");
    let expected = file_revision(&project, rel_path).unwrap().unwrap();
    let externally_changed = r#"[{"t":"narrate","text":"external"}]"#;
    write_text(&project.join(rel_path), externally_changed);

    let result = save_file(
        project.to_string_lossy().into_owned(),
        rel_path.to_string(),
        r#"[{"t":"narrate","text":"local"}]"#.to_string(),
        Some(serde_json::to_value(&expected).unwrap()),
    );

    assert!(result.is_err());
    assert!(result.err().unwrap().contains("write_conflict"));
    assert_eq!(
        fs::read_to_string(project.join(rel_path)).unwrap(),
        externally_changed
    );
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn save_graph_rejects_stale_revision() {
    let root = unique_temp_dir("save-graph-stale");
    let project = root.join("project");
    write_graph_project_with_files(
        &project,
        serde_json::json!({
            "version": 1,
            "entryNodeId": "old",
            "nodes": [{ "id": "old", "title": "Old", "file": "nodes/old.json", "position": { "x": 0, "y": 0 } }],
            "edges": []
        }),
        &[("nodes/prologue.json", "[]"), ("nodes/ending.json", "[]")],
    );
    let expected = file_revision(&project, "content/graph.json")
        .unwrap()
        .unwrap();
    write_json(
        &project.join("content/graph.json"),
        &serde_json::json!({
            "version": 1,
            "entryNodeId": "external",
            "nodes": [{ "id": "external", "title": "External", "file": "nodes/external.json", "position": { "x": 0, "y": 0 } }],
            "edges": []
        }),
    )
    .unwrap();

    let result = save_graph(
        project.to_string_lossy().into_owned(),
        graph_input("nodes/prologue.json", "Prologue"),
        Some(serde_json::to_value(&expected).unwrap()),
    );

    assert!(result.is_err());
    assert!(result.err().unwrap().contains("write_conflict"));
    let graph: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(project.join("content/graph.json")).unwrap())
            .unwrap();
    assert_eq!(graph["entryNodeId"], "external");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn save_graph_returns_revision_that_can_guard_the_next_write() {
    let root = unique_temp_dir("save-graph-revision-chain");
    let project = root.join("project");
    write_minimal_project(&project);
    write_text(&project.join("content/nodes/prologue.json"), "[]");

    let first_revision = save_graph(
        project.to_string_lossy().into_owned(),
        graph_input("nodes/prologue.json", "First"),
        None,
    )
    .unwrap()
    .expect("save_graph should return the written file revision");

    let second_revision = save_graph(
        project.to_string_lossy().into_owned(),
        graph_input("nodes/prologue.json", "Second title"),
        Some(serde_json::to_value(first_revision).unwrap()),
    )
    .unwrap()
    .expect("the returned revision should guard the next write");

    assert_eq!(second_revision.rel_path, "content/graph.json");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn save_manifest_rejects_stale_revision() {
    let root = unique_temp_dir("save-manifest-stale");
    let project = root.join("project");
    write_asset_project(
        &project,
        r#"{"characters":{},"backgrounds":{},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
        &[],
    );
    let expected = file_revision(&project, "content/manifest.json")
        .unwrap()
        .unwrap();
    write_text(
        &project.join("content/manifest.json"),
        r#"{"characters":{},"backgrounds":{"external":"assets/backgrounds/sky.png"},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
    );

    let result = save_manifest(
        project.to_string_lossy().into_owned(),
        serde_json::json!({
            "characters": {},
            "backgrounds": {},
            "audio": { "bgm": {}, "sfx": {}, "voice": {} }
        }),
        Some(serde_json::to_value(&expected).unwrap()),
    );

    assert!(result.is_err());
    assert!(result.err().unwrap().contains("write_conflict"));
    let manifest: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(project.join("content/manifest.json")).unwrap())
            .unwrap();
    assert_eq!(
        manifest["backgrounds"]["external"],
        "assets/backgrounds/sky.png"
    );
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn save_project_meta_rejects_stale_revision() {
    let root = unique_temp_dir("save-project-meta-stale");
    let project = root.join("project");
    write_minimal_project(&project);
    let expected = file_revision(&project, "gal.project.json")
        .unwrap()
        .unwrap();
    write_text(
        &project.join("gal.project.json"),
        r#"{"name":"External","activeRendererId":"external","createdAt":"0"}"#,
    );

    let result = save_project_meta(
        project.to_string_lossy().into_owned(),
        ProjectMeta {
            name: "Local".to_string(),
            active_renderer_id: "default".to_string(),
            created_at: "0".to_string(),
        },
        Some(serde_json::to_value(&expected).unwrap()),
    );

    assert!(result.is_err());
    assert!(result.err().unwrap().contains("write_conflict"));
    let meta: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(project.join("gal.project.json")).unwrap())
            .unwrap();
    assert_eq!(meta["activeRendererId"], "external");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn save_project_meta_returns_revision_that_guards_the_next_write() {
    let root = unique_temp_dir("save-project-meta-revision");
    let project = root.join("project");
    write_minimal_project(&project);
    let expected = file_revision(&project, "gal.project.json")
        .unwrap()
        .unwrap();

    let next_revision = save_project_meta(
        project.to_string_lossy().into_owned(),
        ProjectMeta {
            name: "Test".to_string(),
            active_renderer_id: "alternate".to_string(),
            created_at: "0".to_string(),
        },
        Some(serde_json::to_value(&expected).unwrap()),
    )
    .unwrap()
    .unwrap();

    let result = save_project_meta(
        project.to_string_lossy().into_owned(),
        ProjectMeta {
            name: "Test".to_string(),
            active_renderer_id: "final".to_string(),
            created_at: "0".to_string(),
        },
        Some(serde_json::to_value(&next_revision).unwrap()),
    );

    assert!(result.is_ok());
    let _ = fs::remove_dir_all(&root);
}
