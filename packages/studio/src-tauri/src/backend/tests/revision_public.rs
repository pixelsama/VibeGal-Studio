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
fn metadata_revision_avoids_hashing_file_contents() {
    let root = unique_temp_dir("file-metadata-revision");
    let project = root.join("project");
    write_minimal_project(&project);
    let rel_path = "content/nodes/a.json";
    write_text(&project.join(rel_path), "[1]");

    let revision = file_metadata_revision(&project, rel_path).unwrap().unwrap();

    assert_eq!(revision.rel_path, rel_path);
    assert_eq!(revision.size, 3);
    assert!(revision.sha256.is_none());
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
fn open_project_summary_returns_metadata_only_node_index() {
    let root = unique_temp_dir("open-project-summary");
    let project = root.join("project");
    write_graph_project(
        &project,
        serde_json::json!({
            "version": 1,
            "entryNodeId": "present",
            "nodes": [
                { "id": "present", "title": "Present", "file": "nodes/present.json", "position": { "x": 0, "y": 0 } },
                { "id": "missing", "title": "Missing", "file": "nodes/missing.json", "position": { "x": 260, "y": 0 } }
            ],
            "edges": []
        }),
        &[("nodes/present.json", serde_json::json!([{"t":"narrate","text":"secret"}]))],
    );

    let opened = open_project_summary(project.to_string_lossy().as_ref()).unwrap();
    let summaries = opened.node_summaries.as_ref().unwrap();

    assert!(!opened.analysis_complete);
    assert!(opened.nodes.is_none());
    assert_eq!(summaries.len(), 2);
    assert!(summaries[0].exists);
    assert!(summaries[0].revision.as_ref().unwrap().sha256.is_none());
    assert!(!summaries[1].exists);
    assert!(opened
        .project_report
        .as_ref()
        .unwrap()
        .project_issues
        .iter()
        .all(|issue| issue.source != "node"));
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn read_node_detail_requires_graph_registration_and_returns_hashed_revision() {
    let root = unique_temp_dir("read-node-detail");
    let project = root.join("project");
    write_graph_project(
        &project,
        serde_json::json!({
            "version": 1,
            "entryNodeId": "a",
            "nodes": [{ "id": "a", "title": "A", "file": "nodes/a.json", "position": { "x": 0, "y": 0 } }],
            "edges": []
        }),
        &[("nodes/a.json", serde_json::json!([{"t":"narrate","text":"hello"}]))],
    );
    write_text(&project.join("content/nodes/unregistered.json"), "[]");

    let detail = read_node_detail(project.to_string_lossy().as_ref(), "nodes/a.json").unwrap();
    assert_eq!(detail.rel_path, "nodes/a.json");
    assert_eq!(detail.data[0]["text"], "hello");
    assert!(detail.text.contains("\"hello\""));
    assert_eq!(detail.revision.sha256.as_deref().map(str::len), Some(64));
    assert!(read_node_detail(
        project.to_string_lossy().as_ref(),
        "nodes/unregistered.json",
    )
    .unwrap_err()
    .contains("不在 graph.json"));
    assert!(read_node_detail(project.to_string_lossy().as_ref(), "../gal.project.json").is_err());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn node_file_snapshot_preserves_raw_text_and_reports_deletion() {
    let root = unique_temp_dir("node-file-snapshot");
    let project = root.join("project");
    write_graph_project(
        &project,
        serde_json::json!({
            "version": 1,
            "entryNodeId": "a",
            "nodes": [{ "id": "a", "title": "A", "file": "nodes/a.json", "position": { "x": 0, "y": 0 } }],
            "edges": []
        }),
        &[("nodes/a.json", serde_json::json!([]))],
    );
    let raw = "[\n  {\"t\": \"narrate\", \"text\": \"unfinished\"}\n";
    write_text(&project.join("content/nodes/a.json"), raw);

    let snapshot =
        read_node_file_snapshot(project.to_string_lossy().as_ref(), "nodes/a.json").unwrap();
    assert_eq!(snapshot.state, NodeFileSnapshotState::Present);
    assert_eq!(snapshot.text.as_deref(), Some(raw));
    let revision = snapshot.revision.unwrap();
    assert_eq!(revision.size, raw.len() as u64);
    assert_eq!(revision.sha256.as_deref().map(str::len), Some(64));

    fs::remove_file(project.join("content/nodes/a.json")).unwrap();
    let deleted =
        read_node_file_snapshot(project.to_string_lossy().as_ref(), "nodes/a.json").unwrap();
    assert_eq!(deleted.state, NodeFileSnapshotState::Deleted);
    assert!(deleted.text.is_none());
    assert!(deleted.revision.is_none());
    write_text(
        &project.join("content/nodes/unregistered.json"),
        "{\n  broken\n",
    );
    let unregistered = read_node_file_snapshot(
        project.to_string_lossy().as_ref(),
        "nodes/unregistered.json",
    )
    .unwrap();
    assert_eq!(unregistered.state, NodeFileSnapshotState::Present);
    assert_eq!(unregistered.text.as_deref(), Some("{\n  broken\n"));
    assert!(read_node_file_snapshot(
        project.to_string_lossy().as_ref(),
        "meta.json",
    )
    .unwrap_err()
    .contains("nodes/"));
    assert!(read_node_file_snapshot(
        project.to_string_lossy().as_ref(),
        "../gal.project.json",
    )
    .is_err());
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
                "missingSupportFiles",
                "galstudioIgnored",
                "projectRevision",
                "graph",
                "nodes",
                "nodeSummaries",
                "analysisComplete",
                "graphRevision",
                "manifestRevision",
                "metaRevision",
                "nodeRevisions",
                "locales",
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
fn no_op_json_save_preserves_revision_and_mtime() {
    let root = unique_temp_dir("save-graph-no-op");
    let project = root.join("project");
    write_minimal_project(&project);
    write_text(&project.join("content/nodes/prologue.json"), "[]");
    write_text(&project.join("content/nodes/ending.json"), "[]");
    let graph = graph_input("nodes/prologue.json", "Stable");

    let first_revision = save_graph(
        project.to_string_lossy().into_owned(),
        graph.clone(),
        None,
    )
    .unwrap()
    .unwrap();
    let first_bytes = fs::read(project.join("content/graph.json")).unwrap();

    let second_revision = save_graph(
        project.to_string_lossy().into_owned(),
        graph,
        Some(serde_json::to_value(&first_revision).unwrap()),
    )
    .unwrap()
    .unwrap();

    assert_eq!(second_revision.mtime_ms, first_revision.mtime_ms);
    assert_eq!(second_revision.size, first_revision.size);
    assert_eq!(second_revision.sha256, first_revision.sha256);
    assert_eq!(fs::read(project.join("content/graph.json")).unwrap(), first_bytes);
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn no_op_text_save_preserves_revision_and_mtime() {
    let root = unique_temp_dir("save-text-no-op");
    let project = root.join("project");
    write_minimal_project(&project);
    let rel_path = "renderers/default/index.tsx";
    let content = "export default {};\n";

    let first_revision = save_file(
        project.to_string_lossy().into_owned(),
        rel_path.to_string(),
        content.to_string(),
        Some(serde_json::Value::Null),
    )
    .unwrap()
    .unwrap();
    let second_revision = save_file(
        project.to_string_lossy().into_owned(),
        rel_path.to_string(),
        content.to_string(),
        Some(serde_json::to_value(&first_revision).unwrap()),
    )
    .unwrap()
    .unwrap();

    assert_eq!(second_revision.mtime_ms, first_revision.mtime_ms);
    assert_eq!(second_revision.size, first_revision.size);
    assert_eq!(second_revision.sha256, first_revision.sha256);
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
