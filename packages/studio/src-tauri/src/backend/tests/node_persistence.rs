use super::support::*;

fn write_single_node_project(project: &Path, instructions: serde_json::Value) {
    write_graph_project(
        project,
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
        &[("nodes/start.json", instructions)],
    );
}

#[test]
fn save_node_assigns_only_missing_story_point_ids_and_returns_authoritative_data() {
    let root = unique_temp_dir("save-node-assign-ids");
    let project = root.join("project");
    write_single_node_project(&project, serde_json::json!([]));

    let result = save_node(
        project.to_string_lossy().into_owned(),
        "nodes/start.json".to_string(),
        serde_json::json!([
            { "t": "narrate", "text": "Narration" },
            { "t": "say", "id": "manual_line", "who": "hero", "text": "Hello" },
            { "t": "wait", "id": "", "ms": 100 },
            { "t": "pause" },
            { "t": "bg", "id": "background_asset", "ref": "school" }
        ]),
        None,
    )
    .unwrap();

    let instructions = result.instructions.as_array().unwrap();
    assert!(instructions[0]["id"].as_str().unwrap().starts_with("sp_"));
    assert_eq!(instructions[1]["id"], "manual_line");
    assert!(instructions[2]["id"].as_str().unwrap().starts_with("sp_"));
    assert!(instructions[3]["id"].as_str().unwrap().starts_with("sp_"));
    assert_eq!(instructions[4]["id"], "background_asset");
    assert_eq!(result.assigned.len(), 3);
    assert_eq!(result.assigned[0].file, "content/nodes/start.json");
    assert_eq!(result.assigned[0].node_id, "start");
    assert_eq!(result.assigned[0].json_path, "$[0].id");
    assert_eq!(result.revision.rel_path, "content/nodes/start.json");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&result.serialized_text).unwrap(),
        result.instructions
    );
    assert_eq!(
        read_json(&project.join("content/nodes/start.json")).unwrap(),
        result.instructions
    );

    let second = save_node(
        project.to_string_lossy().into_owned(),
        "nodes/start.json".to_string(),
        result.instructions,
        Some(serde_json::to_value(result.revision).unwrap()),
    )
    .unwrap();
    assert!(second.assigned.is_empty());

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn save_node_preserves_duplicate_existing_ids_for_validation_to_report() {
    let root = unique_temp_dir("save-node-preserve-duplicate");
    let project = root.join("project");
    write_single_node_project(&project, serde_json::json!([]));
    let duplicate = serde_json::json!([
        { "t": "narrate", "id": "same", "text": "One" },
        { "t": "narrate", "id": "same", "text": "Two" }
    ]);

    let result = save_node(
        project.to_string_lossy().into_owned(),
        "nodes/start.json".to_string(),
        duplicate.clone(),
        None,
    )
    .unwrap();

    assert_eq!(result.instructions, duplicate);
    assert!(result.assigned.is_empty());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn save_node_rejects_stale_revision_without_repairing_or_overwriting() {
    let root = unique_temp_dir("save-node-stale");
    let project = root.join("project");
    write_single_node_project(
        &project,
        serde_json::json!([{ "t": "narrate", "id": "old", "text": "Old" }]),
    );
    let rel_path = "content/nodes/start.json";
    let expected = file_revision(&project, rel_path).unwrap().unwrap();
    let external = serde_json::json!([{ "t": "narrate", "id": "external", "text": "External" }]);
    write_json(&project.join(rel_path), &external).unwrap();

    let error = save_node(
        project.to_string_lossy().into_owned(),
        "nodes/start.json".to_string(),
        serde_json::json!([{ "t": "narrate", "text": "Local" }]),
        Some(serde_json::to_value(expected).unwrap()),
    )
    .expect_err("stale writes must fail before assigning IDs");

    assert!(error.contains("write_conflict"));
    assert_eq!(read_json(&project.join(rel_path)).unwrap(), external);
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn save_node_rejects_invalid_contract_and_unsafe_or_unreferenced_paths() {
    let root = unique_temp_dir("save-node-contract-path");
    let project = root.join("project");
    let original = serde_json::json!([{ "t": "narrate", "id": "original", "text": "Original" }]);
    write_single_node_project(&project, original.clone());

    let invalid = save_node(
        project.to_string_lossy().into_owned(),
        "nodes/start.json".to_string(),
        serde_json::json!([{ "t": "say", "text": "Missing who" }]),
        None,
    );
    assert!(invalid.is_err());
    assert_eq!(
        read_json(&project.join("content/nodes/start.json")).unwrap(),
        original
    );

    for node_file in [
        "../outside.json",
        "nodes/../../outside.json",
        "nodes/unreferenced.json",
    ] {
        assert!(save_node(
            project.to_string_lossy().into_owned(),
            node_file.to_string(),
            serde_json::json!([]),
            None,
        )
        .is_err());
    }
    assert!(!root.join("outside.json").exists());
    assert!(!project.join("content/nodes/unreferenced.json").exists());
    let _ = fs::remove_dir_all(&root);
}
