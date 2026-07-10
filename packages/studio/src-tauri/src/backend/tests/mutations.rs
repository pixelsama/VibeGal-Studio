use super::support::*;

#[test]
fn save_graph_writes_graph_json() {
    let root = unique_temp_dir("save-graph");
    let project = root.join("project");
    write_minimal_project(&project);
    write_text(&project.join("content/nodes/prologue.json"), "[]");
    write_text(&project.join("content/nodes/ending.json"), "[]");

    save_graph(
        project.to_string_lossy().into_owned(),
        graph_input("nodes/prologue.json", "Prologue"),
        None,
    )
    .unwrap();

    let graph_text = fs::read_to_string(project.join("content/graph.json")).unwrap();
    let graph: serde_json::Value = serde_json::from_str(&graph_text).unwrap();
    assert!(graph_text.contains('\n'));
    assert_eq!(graph["entryNodeId"], "prologue");
    assert_eq!(graph["nodes"][0]["title"], "Prologue");
    assert_eq!(graph["edges"][0]["id"], "prologue__ending");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn save_graph_overwrites_existing_graph_json() {
    let root = unique_temp_dir("save-graph-overwrite");
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

    save_graph(
        project.to_string_lossy().into_owned(),
        graph_input("nodes/prologue.json", "Fresh"),
        None,
    )
    .unwrap();

    let graph: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(project.join("content/graph.json")).unwrap())
            .unwrap();
    assert_eq!(graph["entryNodeId"], "prologue");
    assert_eq!(graph["nodes"][0]["title"], "Fresh");
    assert_ne!(graph["entryNodeId"], "old");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn write_json_is_atomic_enough_for_valid_json() {
    let root = unique_temp_dir("save-graph-atomic-json");
    let project = root.join("project");
    write_minimal_project(&project);
    write_text(&project.join("content/nodes/prologue.json"), "[]");
    write_text(&project.join("content/nodes/ending.json"), "[]");

    save_graph(
        project.to_string_lossy().into_owned(),
        graph_input("nodes/prologue.json", "Prologue"),
        None,
    )
    .unwrap();

    let graph_path = project.join("content/graph.json");
    let graph_text = fs::read_to_string(&graph_path).unwrap();
    let graph: serde_json::Value = serde_json::from_str(&graph_text).unwrap();
    assert_eq!(graph["entryNodeId"], "prologue");
    let leftovers = fs::read_dir(project.join("content"))
        .unwrap()
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .contains(".galstudio-tmp")
        })
        .count();
    assert_eq!(leftovers, 0);
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn save_graph_positions_refuses_to_persist_an_invalid_graph() {
    let root = unique_temp_dir("save-graph-positions-contract");
    let project = root.join("project");
    write_graph_project_with_files(
        &project,
        serde_json::json!({
            "version": 1,
            "entryNodeId": "start",
            "nodes": [{
                "id": "start",
                "title": 42,
                "file": "nodes/start.json",
                "position": { "x": 0, "y": 0 }
            }],
            "edges": []
        }),
        &[("nodes/start.json", "[]")],
    );
    let before = fs::read_to_string(project.join("content/graph.json")).unwrap();

    let result = save_graph_positions(
        project.to_string_lossy().into_owned(),
        vec![GraphPositionPatchInput {
            id: "start".to_string(),
            position: GraphPositionInput { x: 42.0, y: 24.0 },
        }],
        None,
    );

    assert!(result.is_err());
    assert!(result.err().unwrap().contains("内容契约"));
    assert_eq!(
        fs::read_to_string(project.join("content/graph.json")).unwrap(),
        before
    );
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn save_graph_positions_preserves_external_nodes() {
    let root = unique_temp_dir("save-graph-positions");
    let project = root.join("project");
    write_graph_project_with_files(
        &project,
        serde_json::json!({
            "version": 1,
            "entryNodeId": "a",
            "nodes": [
                { "id": "a", "title": "A", "file": "nodes/a.json", "position": { "x": 0, "y": 0 } },
                { "id": "b", "title": "B", "file": "nodes/b.json", "position": { "x": 100, "y": 0 } }
            ],
            "edges": [{ "id": "a__b", "from": "a", "to": "b", "condition": null }]
        }),
        &[
            ("nodes/a.json", "[]"),
            ("nodes/b.json", "[]"),
            ("nodes/c.json", "[]"),
        ],
    );
    let expected = file_revision(&project, "content/graph.json")
        .unwrap()
        .unwrap();
    write_json(
        &project.join("content/graph.json"),
        &serde_json::json!({
            "version": 1,
            "entryNodeId": "a",
            "nodes": [
                { "id": "a", "title": "A", "file": "nodes/a.json", "position": { "x": 0, "y": 0 } },
                { "id": "b", "title": "B", "file": "nodes/b.json", "position": { "x": 100, "y": 0 } },
                { "id": "c", "title": "External", "file": "nodes/c.json", "position": { "x": 200, "y": 0 } }
            ],
            "edges": [
                { "id": "a__b", "from": "a", "to": "b", "condition": null },
                { "id": "b__c", "from": "b", "to": "c", "condition": null }
            ]
        }),
    )
    .unwrap();

    save_graph_positions(
        project.to_string_lossy().into_owned(),
        vec![GraphPositionPatchInput {
            id: "a".to_string(),
            position: GraphPositionInput { x: 42.0, y: 24.0 },
        }],
        Some(serde_json::to_value(&expected).unwrap()),
    )
    .unwrap();

    let graph: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(project.join("content/graph.json")).unwrap())
            .unwrap();
    assert_eq!(graph["nodes"].as_array().unwrap().len(), 3);
    assert_eq!(graph["edges"].as_array().unwrap().len(), 2);
    let node_a = graph["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|node| node["id"] == "a")
        .unwrap();
    assert_eq!(node_a["position"]["x"], 42.0);
    assert_eq!(node_a["position"]["y"], 24.0);
    assert!(graph["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .any(|node| node["id"] == "c"));
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn save_graph_rejects_untrusted_project_root() {
    let root = unique_temp_dir("save-graph-untrusted");
    fs::create_dir_all(&root).unwrap();

    let result = save_graph(
        root.to_string_lossy().into_owned(),
        graph_input("nodes/prologue.json", "Nope"),
        None,
    );

    assert!(result.is_err());
    assert!(!root.join("content/graph.json").exists());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn save_graph_rejects_node_file_outside_content_dir() {
    let root = unique_temp_dir("save-graph-escape");
    let project = root.join("project");
    write_graph_project_with_files(
        &project,
        serde_json::json!({
            "version": 1,
            "entryNodeId": "kept",
            "nodes": [{ "id": "kept", "title": "Kept", "file": "nodes/kept.json", "position": { "x": 0, "y": 0 } }],
            "edges": []
        }),
        &[("nodes/kept.json", "[]")],
    );
    let before = fs::read_to_string(project.join("content/graph.json")).unwrap();

    let result = save_graph(
        project.to_string_lossy().into_owned(),
        graph_input("../../outside.json", "Escape"),
        None,
    );

    assert!(result.is_err());
    assert!(result.err().unwrap().contains("路径越界"));
    assert_eq!(
        fs::read_to_string(project.join("content/graph.json")).unwrap(),
        before
    );
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn delete_file_removes_target_under_content() {
    let root = unique_temp_dir("delete-file");
    let project = root.join("project");
    write_minimal_project(&project);
    let target = project.join("content/nodes/a.json");
    write_text(&target, "[]");

    delete_file(
        project.to_string_lossy().into_owned(),
        "nodes/a.json".to_string(),
        None,
    )
    .unwrap();

    assert!(!target.exists());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn delete_file_moves_to_trash() {
    let root = unique_temp_dir("delete-file-trash");
    let project = root.join("project");
    write_minimal_project(&project);
    let target = project.join("content/nodes/a.json");
    write_text(&target, "[1]");

    delete_file(
        project.to_string_lossy().into_owned(),
        "nodes/a.json".to_string(),
        None,
    )
    .unwrap();

    assert!(!target.exists());
    let trash_root = project.join(".galstudio/trash");
    let entries = fs::read_dir(&trash_root)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect::<Vec<_>>();
    assert_eq!(entries.len(), 1);
    let trash_dir = &entries[0];
    assert_eq!(
        fs::read_to_string(trash_dir.join("content/nodes/a.json")).unwrap(),
        "[1]"
    );
    let manifest: serde_json::Value = read_json(&trash_dir.join("trash.json")).unwrap();
    assert_eq!(manifest["originalPath"], "content/nodes/a.json");
    assert_eq!(manifest["command"], "delete_file");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn delete_file_rejects_stale_revision() {
    let root = unique_temp_dir("delete-file-stale");
    let project = root.join("project");
    write_minimal_project(&project);
    let target = project.join("content/nodes/a.json");
    write_text(&target, "[]");
    let expected = file_revision(&project, "content/nodes/a.json")
        .unwrap()
        .unwrap();
    write_text(&target, "[1]");

    let result = delete_file(
        project.to_string_lossy().into_owned(),
        "nodes/a.json".to_string(),
        Some(serde_json::to_value(&expected).unwrap()),
    );

    assert!(result.is_err());
    assert!(result.err().unwrap().contains("write_conflict"));
    assert!(target.exists());
    assert!(!project.join(".galstudio/trash").exists());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn delete_file_is_idempotent_for_missing_file() {
    let root = unique_temp_dir("delete-file-missing");
    let project = root.join("project");
    write_minimal_project(&project);

    let result = delete_file(
        project.to_string_lossy().into_owned(),
        "nodes/missing.json".to_string(),
        None,
    );

    assert!(result.is_ok());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn delete_file_rejects_path_traversal() {
    let root = unique_temp_dir("delete-file-escape");
    let project = root.join("project");
    write_minimal_project(&project);
    write_text(&root.join("outside.json"), "keep");

    let result = delete_file(
        project.to_string_lossy().into_owned(),
        "../../outside.json".to_string(),
        None,
    );

    assert!(result.is_err());
    assert_eq!(
        fs::read_to_string(root.join("outside.json")).unwrap(),
        "keep"
    );
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn delete_file_rejects_untrusted_project_root() {
    let root = unique_temp_dir("delete-file-untrusted");
    fs::create_dir_all(&root).unwrap();

    let result = delete_file(
        root.to_string_lossy().into_owned(),
        "nodes/a.json".to_string(),
        None,
    );

    assert!(result.is_err());
    let _ = fs::remove_dir_all(&root);
}
