#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("galstudio-{name}-{stamp}"))
    }

    fn write_text(path: &Path, text: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, text).unwrap();
    }

    fn write_minimal_project(project: &Path) {
        write_text(
            &project.join("gal.project.json"),
            r#"{"name":"Test","activeRendererId":"default","createdAt":"0"}"#,
        );
        write_text(
            &project.join("content/manifest.json"),
            r#"{"characters":{},"backgrounds":{},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
        );
        write_json(
            &project.join("content/meta.json"),
            &serde_json::json!({
                "title": "Test",
                "typingSpeedCps": 30,
                "autoAdvanceMs": 1200,
                "chapterGapMs": 1500
            }),
        )
        .unwrap();
    }

    fn write_legacy_chapter_project(project: &Path, chapters_value: serde_json::Value) {
        write_minimal_project(project);
        write_json(
            &project.join("content/meta.json"),
            &serde_json::json!({
                "title": "Test",
                "chapters": chapters_value,
                "typingSpeedCps": 30,
                "autoAdvanceMs": 1200,
                "chapterGapMs": 1500
            }),
        )
        .unwrap();
    }

    fn write_graph_project(
        project: &Path,
        graph_json: serde_json::Value,
        nodes: &[(&str, serde_json::Value)],
    ) {
        write_minimal_project(project);
        write_json(&project.join("content/graph.json"), &graph_json).unwrap();
        for (rel_path, data) in nodes {
            write_json(&project.join("content").join(rel_path), data).unwrap();
        }
    }

    fn write_graph_project_with_files(
        project: &Path,
        graph_json: serde_json::Value,
        node_files: &[(&str, &str)],
    ) {
        write_minimal_project(project);
        write_json(&project.join("content/graph.json"), &graph_json).unwrap();
        for (rel_path, text) in node_files {
            write_text(&project.join("content").join(rel_path), text);
        }
    }

    fn write_renderer_project(project: &Path) {
        write_minimal_project(project);
        write_text(
            &project.join("renderers/default/index.tsx"),
            "export default { id: 'default', name: 'Default', Component: () => null };",
        );
        write_text(
            &project.join("renderers/default/Stage.tsx"),
            "export const Stage = () => null;",
        );
    }

    fn graph_input(node_file: &str, title: &str) -> ProjectGraphInput {
        ProjectGraphInput {
            version: 1,
            entry_node_id: "prologue".to_string(),
            nodes: vec![
                GraphNodeInput {
                    id: "prologue".to_string(),
                    title: title.to_string(),
                    file: node_file.to_string(),
                    position: GraphPositionInput { x: 120.0, y: 180.0 },
                },
                GraphNodeInput {
                    id: "ending".to_string(),
                    title: "Ending".to_string(),
                    file: "nodes/ending.json".to_string(),
                    position: GraphPositionInput { x: 380.0, y: 180.0 },
                },
            ],
            edges: vec![GraphEdgeInput {
                id: "prologue__ending".to_string(),
                from: "prologue".to_string(),
                to: "ending".to_string(),
                mode: "linear".to_string(),
                label: None,
                condition: None,
            }],
        }
    }

    fn graph_node(id: &str, file: &str) -> GraphNode {
        GraphNode {
            id: id.to_string(),
            title: id.to_string(),
            file: file.to_string(),
            position: GraphPosition { x: 0.0, y: 0.0 },
        }
    }

    fn graph_edge(id: &str, from: &str, to: &str) -> GraphEdge {
        GraphEdge {
            id: id.to_string(),
            from: from.to_string(),
            to: to.to_string(),
            mode: "linear".to_string(),
            label: None,
            condition: None,
        }
    }

    fn choice_edge(id: &str, from: &str, to: &str, label: &str) -> GraphEdge {
        GraphEdge {
            id: id.to_string(),
            from: from.to_string(),
            to: to.to_string(),
            mode: "choice".to_string(),
            label: Some(label.to_string()),
            condition: None,
        }
    }

    fn auto_edge(id: &str, from: &str, to: &str, condition: Option<&str>) -> GraphEdge {
        GraphEdge {
            id: id.to_string(),
            from: from.to_string(),
            to: to.to_string(),
            mode: "auto".to_string(),
            label: None,
            condition: condition.map(|condition| condition.to_string()),
        }
    }

    fn node_entry(rel_path: &str, data: serde_json::Value) -> NodeEntry {
        NodeEntry {
            rel_path: rel_path.to_string(),
            data: Some(data),
        }
    }

    fn manifest_with_refs() -> serde_json::Value {
        serde_json::json!({
            "characters": {
                "hero": {
                    "name": "Hero",
                    "color": "#fff",
                    "sprites": {
                        "default": "assets/characters/hero_default.png",
                        "happy": "assets/characters/hero_happy.png"
                    }
                }
            },
            "backgrounds": { "school": "assets/backgrounds/school.png" },
            "audio": {
                "bgm": { "theme": "assets/audio/bgm/theme.mp3" },
                "sfx": { "click": "assets/audio/sfx/click.wav" },
                "voice": { "line01": "assets/audio/voice/line01.ogg" }
            }
        })
    }

    fn one_node_graph() -> ProjectGraph {
        ProjectGraph {
            version: 1,
            entry_node_id: "start".to_string(),
            nodes: vec![graph_node("start", "nodes/start.json")],
            edges: vec![],
        }
    }

    fn valid_project_graph() -> ProjectGraph {
        ProjectGraph {
            version: 1,
            entry_node_id: "prologue".to_string(),
            nodes: vec![
                graph_node("prologue", "nodes/prologue.json"),
                graph_node("ending", "nodes/ending.json"),
            ],
            edges: vec![graph_edge("prologue__ending", "prologue", "ending")],
        }
    }

    fn present_node_entries(graph: &ProjectGraph) -> Vec<NodeEntry> {
        graph
            .nodes
            .iter()
            .map(|node| NodeEntry {
                rel_path: node.file.clone(),
                data: Some(serde_json::json!([])),
            })
            .collect()
    }

    fn choice_branch_graph() -> ProjectGraph {
        ProjectGraph {
            version: 1,
            entry_node_id: "start".to_string(),
            nodes: vec![
                graph_node("start", "nodes/start.json"),
                graph_node("stay", "nodes/stay.json"),
                graph_node("leave", "nodes/leave.json"),
            ],
            edges: vec![
                choice_edge("start__stay", "start", "stay", "留下"),
                choice_edge("start__leave", "start", "leave", "离开"),
            ],
        }
    }

    #[test]
    fn validate_graph_flags_dangling_edge() {
        let mut graph = valid_project_graph();
        graph.edges = vec![graph_edge("prologue__missing", "prologue", "missing")];
        let entries = present_node_entries(&graph);

        let issues = validate_graph(&graph, &entries);

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].code, "dangling_edge");
        assert_eq!(issues[0].severity, GraphIssueSeverity::Warn);
        assert_eq!(issues[0].edge_id.as_deref(), Some("prologue__missing"));
        assert_eq!(issues[0].file.as_deref(), Some("content/graph.json"));
        assert_eq!(issues[0].json_path.as_deref(), Some("$.edges[0]"));
        assert!(issues[0].message.contains("missing"));
    }

    #[test]
    fn validate_graph_flags_missing_node_file() {
        let graph = valid_project_graph();
        let entries = vec![
            NodeEntry {
                rel_path: "nodes/prologue.json".to_string(),
                data: Some(serde_json::json!([])),
            },
            NodeEntry {
                rel_path: "nodes/ending.json".to_string(),
                data: None,
            },
        ];

        let issues = validate_graph(&graph, &entries);

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].code, "missing_node_file");
        assert_eq!(issues[0].severity, GraphIssueSeverity::Warn);
        assert_eq!(issues[0].node_id.as_deref(), Some("ending"));
        assert_eq!(issues[0].file.as_deref(), Some("content/nodes/ending.json"));
        assert_eq!(issues[0].json_path.as_deref(), Some("$.nodes[1].file"));
        assert!(issues[0].message.contains("nodes/ending.json"));
    }

    #[test]
    fn validate_graph_flags_duplicate_node_ids() {
        let mut graph = valid_project_graph();
        graph
            .nodes
            .push(graph_node("prologue", "nodes/prologue-copy.json"));
        let entries = present_node_entries(&graph);

        let issues = validate_graph(&graph, &entries);

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].code, "duplicate_node_id");
        assert_eq!(issues[0].severity, GraphIssueSeverity::Error);
        assert_eq!(issues[0].node_id.as_deref(), Some("prologue"));
    }

    #[test]
    fn validate_graph_flags_missing_entry_node() {
        let mut graph = valid_project_graph();
        graph.entry_node_id = "missing-entry".to_string();
        let entries = present_node_entries(&graph);

        let issues = validate_graph(&graph, &entries);

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].code, "missing_entry_node");
        assert_eq!(issues[0].severity, GraphIssueSeverity::Error);
        assert_eq!(issues[0].node_id.as_deref(), Some("missing-entry"));
    }

    #[test]
    fn validate_graph_flags_empty_entry_when_nodes_exist() {
        let mut graph = valid_project_graph();
        graph.entry_node_id = "".to_string();
        let entries = present_node_entries(&graph);

        let issues = validate_graph(&graph, &entries);

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].code, "empty_entry");
        assert_eq!(issues[0].severity, GraphIssueSeverity::Warn);
    }

    #[test]
    fn validate_graph_flags_duplicate_edge_id() {
        let mut graph = valid_project_graph();
        graph
            .edges
            .push(graph_edge("prologue__ending", "ending", "prologue"));
        let entries = present_node_entries(&graph);

        let issues = validate_graph(&graph, &entries);

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].code, "duplicate_edge_id");
        assert_eq!(issues[0].severity, GraphIssueSeverity::Warn);
        assert_eq!(issues[0].edge_id.as_deref(), Some("prologue__ending"));
    }

    #[test]
    fn validate_graph_flags_choice_edge_missing_label() {
        let mut graph = choice_branch_graph();
        graph.edges[1].label = Some(" ".to_string());
        let nodes = present_node_entries(&graph);

        let issues = validate_graph(&graph, &nodes);

        let issue = issues
            .iter()
            .find(|issue| issue.code == "choice_edge_missing_label")
            .expect("choice edge without label should be reported");
        assert_eq!(issue.severity, GraphIssueSeverity::Error);
        assert_eq!(issue.node_id.as_deref(), Some("start"));
        assert_eq!(issue.edge_id.as_deref(), Some("start__leave"));
        assert_eq!(issue.file.as_deref(), Some("content/graph.json"));
        assert_eq!(issue.json_path.as_deref(), Some("$.edges[1].label"));
    }

    #[test]
    fn validate_graph_flags_mixed_outgoing_modes() {
        let mut graph = choice_branch_graph();
        graph.nodes.push(graph_node("secret", "nodes/secret.json"));
        graph
            .edges
            .push(graph_edge("start__secret", "start", "secret"));
        let nodes = present_node_entries(&graph);

        let issues = validate_graph(&graph, &nodes);

        let issue = issues
            .iter()
            .find(|issue| issue.code == "mixed_outgoing_modes")
            .expect("mixed outgoing modes should be reported");
        assert_eq!(issue.severity, GraphIssueSeverity::Error);
        assert_eq!(issue.node_id.as_deref(), Some("start"));
    }

    #[test]
    fn validate_graph_warns_duplicate_choice_label() {
        let mut graph = choice_branch_graph();
        graph.edges[1].label = Some("留下".to_string());
        let nodes = present_node_entries(&graph);

        let issues = validate_graph(&graph, &nodes);

        let issue = issues
            .iter()
            .find(|issue| issue.code == "duplicate_choice_label")
            .expect("duplicate choice label should be reported");
        assert_eq!(issue.severity, GraphIssueSeverity::Warn);
        assert_eq!(issue.node_id.as_deref(), Some("start"));
        assert_eq!(issue.edge_id.as_deref(), Some("start__leave"));
    }

    #[test]
    fn validate_graph_flags_linear_multiple_outgoing() {
        let mut graph = choice_branch_graph();
        for edge in &mut graph.edges {
            edge.mode = "linear".to_string();
            edge.label = None;
        }
        let nodes = present_node_entries(&graph);

        let issues = validate_graph(&graph, &nodes);

        let issue = issues
            .iter()
            .find(|issue| issue.code == "linear_node_multiple_outgoing")
            .expect("linear multi-edge node should be reported");
        assert_eq!(issue.severity, GraphIssueSeverity::Error);
        assert_eq!(issue.node_id.as_deref(), Some("start"));
    }

    #[test]
    fn validate_graph_flags_auto_multiple_default_edges() {
        let mut graph = choice_branch_graph();
        graph.edges = vec![
            auto_edge("start__stay", "start", "stay", None),
            auto_edge("start__leave", "start", "leave", Some("")),
        ];
        let nodes = present_node_entries(&graph);

        let issues = validate_graph(&graph, &nodes);

        let issue = issues
            .iter()
            .find(|issue| issue.code == "auto_multiple_default_edges")
            .expect("multiple auto default edges should be reported");
        assert_eq!(issue.severity, GraphIssueSeverity::Error);
        assert_eq!(issue.node_id.as_deref(), Some("start"));
    }

    #[test]
    fn validate_graph_warns_auto_without_default_edge() {
        let mut graph = choice_branch_graph();
        graph.edges = vec![
            auto_edge("start__stay", "start", "stay", Some("affection >= 3")),
            auto_edge("start__leave", "start", "leave", Some("affection < 3")),
        ];
        let nodes = present_node_entries(&graph);

        let issues = validate_graph(&graph, &nodes);

        let issue = issues
            .iter()
            .find(|issue| issue.code == "auto_missing_default_edge")
            .expect("auto route without default edge should be reported");
        assert_eq!(issue.severity, GraphIssueSeverity::Warn);
        assert_eq!(issue.node_id.as_deref(), Some("start"));
    }

    #[test]
    fn validate_graph_clean_graph_has_no_issues() {
        let graph = valid_project_graph();
        let entries = present_node_entries(&graph);

        let issues = validate_graph(&graph, &entries);

        assert!(issues.is_empty());
    }

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
        assert_eq!(after.rel_path, rel_path);
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
    fn save_file_rejects_stale_revision() {
        let root = unique_temp_dir("save-file-stale");
        let project = root.join("project");
        write_minimal_project(&project);
        let rel_path = "content/nodes/a.json";
        write_text(&project.join(rel_path), "[]");
        let expected = file_revision(&project, rel_path).unwrap().unwrap();
        write_text(&project.join(rel_path), "[1]");

        let result = save_file(
            project.to_string_lossy().into_owned(),
            rel_path.to_string(),
            "[2]".to_string(),
            Some(serde_json::to_value(&expected).unwrap()),
        );

        assert!(result.is_err());
        assert!(result.err().unwrap().contains("write_conflict"));
        assert_eq!(fs::read_to_string(project.join(rel_path)).unwrap(), "[1]");
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
            ManifestInput {
                characters: std::collections::HashMap::new(),
                backgrounds: std::collections::HashMap::new(),
                audio: ManifestAudioRegistryInput::default(),
            },
            Some(serde_json::to_value(&expected).unwrap()),
        );

        assert!(result.is_err());
        assert!(result.err().unwrap().contains("write_conflict"));
        let manifest: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(project.join("content/manifest.json")).unwrap(),
        )
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
    fn validate_node_contents_flags_non_array_node() {
        let graph = one_node_graph();
        let nodes = vec![node_entry("nodes/start.json", serde_json::json!({}))];

        let issues = validate_node_contents(&graph, &nodes, &manifest_with_refs());

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].source, "node");
        assert_eq!(issues[0].code, "node_not_array");
        assert_eq!(issues[0].severity, GraphIssueSeverity::Error);
        assert_eq!(issues[0].file.as_deref(), Some("content/nodes/start.json"));
        assert_eq!(issues[0].json_path.as_deref(), Some("$"));
        assert_eq!(issues[0].node_id.as_deref(), Some("start"));
    }

    #[test]
    fn validate_node_contents_flags_unknown_instruction_type() {
        let graph = one_node_graph();
        let nodes = vec![node_entry(
            "nodes/start.json",
            serde_json::json!([{ "t": "teleport", "id": "x" }]),
        )];

        let issues = validate_node_contents(&graph, &nodes, &manifest_with_refs());

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].code, "instruction_unknown_type");
        assert_eq!(issues[0].json_path.as_deref(), Some("$[0].t"));
        assert_eq!(issues[0].node_id.as_deref(), Some("start"));
    }

    #[test]
    fn validate_node_contents_rejects_choice_instruction() {
        let graph = one_node_graph();
        let nodes = vec![node_entry(
            "nodes/start.json",
            serde_json::json!([
                {
                    "t": "choice",
                    "choices": [{ "text": "留下", "to": "stay" }]
                }
            ]),
        )];

        let issues = validate_node_contents(&graph, &nodes, &manifest_with_refs());

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].code, "choice_instruction_not_supported");
        assert_eq!(issues[0].severity, GraphIssueSeverity::Error);
        assert_eq!(issues[0].file.as_deref(), Some("content/nodes/start.json"));
        assert_eq!(issues[0].json_path.as_deref(), Some("$[0].t"));
        assert_eq!(issues[0].node_id.as_deref(), Some("start"));
    }

    #[test]
    fn validate_node_contents_accepts_pause_instruction() {
        let graph = one_node_graph();
        let nodes = vec![node_entry(
            "nodes/start.json",
            serde_json::json!([
                { "t": "bg", "id": "school" },
                { "t": "pause" },
                { "t": "narrate", "text": "继续。" }
            ]),
        )];

        let issues = validate_node_contents(&graph, &nodes, &manifest_with_refs());

        assert!(
            issues.is_empty(),
            "pause 应被视为合法剧情帧停点: {issues:?}"
        );
    }

    #[test]
    fn validate_node_contents_accepts_set_instruction() {
        let graph = one_node_graph();
        let nodes = vec![node_entry(
            "nodes/start.json",
            serde_json::json!([
                { "t": "set", "key": "affection", "value": 3 },
                { "t": "set", "key": "has_key", "value": true },
                { "t": "set", "key": "route", "value": "stay" },
                { "t": "set", "key": "unused", "value": null }
            ]),
        )];

        let issues = validate_node_contents(&graph, &nodes, &manifest_with_refs());

        assert!(issues.is_empty(), "set 应支持自动条件路由变量: {issues:?}");
    }

    #[test]
    fn validate_node_contents_flags_invalid_set_value() {
        let graph = one_node_graph();
        let nodes = vec![node_entry(
            "nodes/start.json",
            serde_json::json!([{ "t": "set", "key": "route", "value": { "bad": true } }]),
        )];

        let issues = validate_node_contents(&graph, &nodes, &manifest_with_refs());

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].code, "instruction_invalid_field");
        assert_eq!(issues[0].json_path.as_deref(), Some("$[0].value"));
    }

    #[test]
    fn validate_node_contents_flags_missing_required_field() {
        let graph = one_node_graph();
        let nodes = vec![node_entry(
            "nodes/start.json",
            serde_json::json!([{ "t": "say", "who": "hero" }]),
        )];

        let issues = validate_node_contents(&graph, &nodes, &manifest_with_refs());

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].code, "instruction_invalid_field");
        assert_eq!(issues[0].json_path.as_deref(), Some("$[0].text"));
    }

    #[test]
    fn validate_node_contents_flags_invalid_enum() {
        let graph = one_node_graph();
        let nodes = vec![node_entry(
            "nodes/start.json",
            serde_json::json!([{ "t": "bg", "id": "school", "trans": "spin" }]),
        )];

        let issues = validate_node_contents(&graph, &nodes, &manifest_with_refs());

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].code, "instruction_invalid_field");
        assert_eq!(issues[0].json_path.as_deref(), Some("$[0].trans"));
    }

    #[test]
    fn validate_node_contents_flags_missing_background_ref() {
        let graph = one_node_graph();
        let nodes = vec![node_entry(
            "nodes/start.json",
            serde_json::json!([{ "t": "bg", "id": "ghost_bg" }]),
        )];

        let issues = validate_node_contents(&graph, &nodes, &manifest_with_refs());

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].code, "missing_background_ref");
        assert_eq!(issues[0].json_path.as_deref(), Some("$[0].id"));
    }

    #[test]
    fn validate_node_contents_flags_missing_character_expr() {
        let graph = one_node_graph();
        let nodes = vec![node_entry(
            "nodes/start.json",
            serde_json::json!([{ "t": "say", "who": "hero", "expr": "angry", "text": "Hi" }]),
        )];

        let issues = validate_node_contents(&graph, &nodes, &manifest_with_refs());

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].code, "missing_character_expr");
        assert_eq!(issues[0].json_path.as_deref(), Some("$[0].expr"));
    }

    #[test]
    fn validate_node_contents_skips_missing_node_file() {
        let graph = one_node_graph();
        let nodes = vec![NodeEntry {
            rel_path: "nodes/start.json".to_string(),
            data: None,
        }];

        let issues = validate_node_contents(&graph, &nodes, &manifest_with_refs());

        assert!(issues.is_empty());
    }

    #[test]
    fn validate_node_contents_skips_reference_checks_when_manifest_is_invalid() {
        let graph = one_node_graph();
        let nodes = vec![node_entry(
            "nodes/start.json",
            serde_json::json!([{ "t": "bg", "id": "ghost_bg" }]),
        )];
        let manifest = serde_json::json!({ "characters": {}, "backgrounds": {}, "audio": { "bgm_main": "x.mp3" } });

        let issues = validate_node_contents(&graph, &nodes, &manifest);

        assert!(
            issues.is_empty(),
            "manifest 非法时不应制造引用二次问题: {issues:?}"
        );
    }

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
                    serde_json::json!([{ "t": "narrate", "text": "Start" }]),
                ),
                (
                    "nodes/first_meeting.json",
                    serde_json::json!([{ "t": "say", "who": "hero", "text": "Hi" }]),
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
                serde_json::json!([{ "t": "narrate", "text": "Here" }]),
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
            .find(|issue| issue.code == "edge_invalid_mode")
            .expect("non-string edge mode should be reported");
        assert_eq!(issue.severity, GraphIssueSeverity::Error);
        assert_eq!(issue.edge_id.as_deref(), Some("start__ending"));
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

        let result = open_project_inner(project.to_string_lossy().as_ref());

        assert!(result.is_err());
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

        assert!(issues.iter().any(|issue| {
            issue.source == "graph" && issue.code == "legacy_chapters_not_supported"
        }));
        assert!(root.join("outside.json").exists());
        let _ = fs::remove_dir_all(&root);
    }

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
        assert!(agent_instructions.contains("galstudio-cli validate . --format json"));
        assert!(agent_instructions.contains(
            "/Applications/galstudio.app/Contents/Resources/bin/galstudio-cli validate . --format json"
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
            "/Applications/galstudio.app/Contents/Resources/bin/galstudio-cli validate . --format json"
        ));
        let renderer_contract =
            fs::read_to_string(project.join(".galstudio/renderer-contract.md")).unwrap();
        assert!(renderer_contract.contains("RendererManifest"));
        assert!(renderer_contract.contains("renderers/<id>/index.tsx"));
        assert!(renderer_contract.contains("@galstudio/engine"));
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

    // ── 资产命令测试 ──

    /// 写一个 content/assets/ 下有文件的空项目（无图、无章节）。
    fn write_asset_project(project: &Path, manifest_json: &str, asset_files: &[&str]) {
        write_minimal_project(project);
        write_text(&project.join("content/manifest.json"), manifest_json);
        for rel in asset_files {
            write_text(&project.join("content").join(rel), "fake");
        }
    }

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
        assert!(kinds.contains(&AssetKind::Unknown));
        let _ = fs::remove_dir_all(&dir);
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

        let manifest = ManifestInput {
            characters: {
                let mut m = std::collections::HashMap::new();
                m.insert(
                    "hero".to_string(),
                    ManifestCharacterInput {
                        name: "主角".to_string(),
                        color: "#9fc8e3".to_string(),
                        sprites: {
                            let mut s = std::collections::HashMap::new();
                            s.insert(
                                "default".to_string(),
                                "assets/characters/hero.svg".to_string(),
                            );
                            s
                        },
                    },
                );
                m
            },
            backgrounds: {
                let mut m = std::collections::HashMap::new();
                m.insert("sky".to_string(), "assets/backgrounds/sky.png".to_string());
                m
            },
            audio: ManifestAudioRegistryInput {
                bgm: {
                    let mut m = std::collections::HashMap::new();
                    m.insert(
                        "theme".to_string(),
                        "assets/audio/bgm/theme.mp3".to_string(),
                    );
                    m
                },
                sfx: std::collections::HashMap::new(),
                voice: std::collections::HashMap::new(),
            },
        };

        save_manifest(dir.to_string_lossy().to_string(), manifest, None).unwrap();

        let written = fs::read_to_string(dir.join("content/manifest.json")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&written).unwrap();
        assert_eq!(parsed["characters"]["hero"]["name"], "主角");
        assert_eq!(
            parsed["audio"]["bgm"]["theme"],
            "assets/audio/bgm/theme.mp3"
        );
        // 三张子表都应存在（即使为空）
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
        let issues = validate_assets(&content_root, &manifest);

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
        let issues = validate_assets(&content_root, &manifest);
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
        let issues = validate_assets(&content_root, &manifest);

        let dup = issues.iter().find(|i| i.code == "duplicate_asset_ref");
        assert!(dup.is_some(), "应检出重复引用: {issues:?}");
        assert_eq!(dup.unwrap().severity, GraphIssueSeverity::Warn);
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
                serde_json::json!([{ "t": "say", "who": "ghost", "text": "Hi" }]),
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

    #[test]
    fn create_renderer_copies_template_without_overwrite() {
        let root = unique_temp_dir("create-renderer");
        let project = root.join("project");
        let template = root.join("template");
        write_renderer_project(&project);
        write_text(
            &template.join("index.tsx"),
            "export default { id: 'template', name: 'Template', Component: () => null };",
        );
        write_text(
            &template.join("Stage.tsx"),
            "export const Stage = () => 'ok';",
        );

        create_renderer_from_template(&project, "cinematic", &template).unwrap();

        assert!(project.join("renderers/cinematic/index.tsx").is_file());
        assert!(project.join("renderers/cinematic/Stage.tsx").is_file());
        assert!(create_renderer_from_template(&project, "cinematic", &template).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn duplicate_renderer_copies_source_files() {
        let root = unique_temp_dir("duplicate-renderer");
        let project = root.join("project");
        write_renderer_project(&project);
        write_text(
            &project.join("renderers/default/Nested/View.tsx"),
            "export const View = () => null;",
        );

        duplicate_renderer_inner(&project, "default", "mobile").unwrap();

        assert_eq!(
            fs::read_to_string(project.join("renderers/mobile/Stage.tsx")).unwrap(),
            "export const Stage = () => null;"
        );
        assert!(project.join("renderers/mobile/Nested/View.tsx").is_file());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rename_renderer_updates_active_renderer_when_needed() {
        let root = unique_temp_dir("rename-renderer");
        let project = root.join("project");
        write_renderer_project(&project);

        rename_renderer_inner(&project, "default", "mobile").unwrap();

        assert!(project.join("renderers/mobile/index.tsx").is_file());
        assert!(!project.join("renderers/default").exists());
        let meta = read_project_meta(&project).unwrap();
        assert_eq!(meta.active_renderer_id, "mobile");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn delete_renderer_rejects_active_renderer() {
        let root = unique_temp_dir("delete-active-renderer");
        let project = root.join("project");
        write_renderer_project(&project);

        let result = delete_renderer_inner(&project, "default");

        assert!(result.is_err());
        assert!(project.join("renderers/default").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn renderer_commands_reject_path_traversal() {
        let root = unique_temp_dir("renderer-path-traversal");
        let project = root.join("project");
        let template = root.join("template");
        write_renderer_project(&project);
        write_text(
            &template.join("index.tsx"),
            "export default { id: 'template', name: 'Template', Component: () => null };",
        );

        assert!(create_renderer_from_template(&project, "../escape", &template).is_err());
        assert!(duplicate_renderer_inner(&project, "default", "../escape").is_err());
        assert!(rename_renderer_inner(&project, "default", "../escape").is_err());
        assert!(delete_renderer_inner(&project, "../escape").is_err());
        let _ = fs::remove_dir_all(&root);
    }

    // ── 应用设置（AppSettings）测试 ──

    #[test]
    fn app_settings_defaults_to_system() {
        let s = AppSettings::default();
        assert_eq!(s.theme, ThemeMode::System);
    }

    #[test]
    fn app_settings_serde_roundtrip_preserves_theme() {
        let s = AppSettings {
            theme: ThemeMode::Light,
        };
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains(r#""theme":"light""#));
        // 反序列化回来应一致
        let back: AppSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(back, s);
    }

    #[test]
    fn app_settings_serde_roundtrip_preserves_system_theme() {
        let s = AppSettings {
            theme: ThemeMode::System,
        };
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains(r#""theme":"system""#));
        let back: AppSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(back, s);
    }

    #[test]
    fn app_settings_deserialize_missing_theme_uses_default() {
        // 旧版/部分设置文件缺 theme 字段时应回退到默认 system
        let back: AppSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(back.theme, ThemeMode::System);
    }

    #[test]
    fn app_settings_deserialize_unknown_theme_uses_default() {
        let back: AppSettings = serde_json::from_str(r#"{"theme":"solarized"}"#).unwrap();
        assert_eq!(back.theme, ThemeMode::System);
    }

    #[test]
    fn cli_tool_status_detects_managed_symlink() {
        let root = unique_temp_dir("cli-status");
        let bin_dir = root.join("bin");
        fs::create_dir_all(&bin_dir).unwrap();
        let launcher = root.join("GalStudio.app/Contents/Resources/bin/galstudio-cli");
        let sidecar = root.join("GalStudio.app/Contents/MacOS/galstudio-cli");
        fs::create_dir_all(launcher.parent().unwrap()).unwrap();
        fs::create_dir_all(sidecar.parent().unwrap()).unwrap();
        fs::write(&launcher, "#!/bin/sh\n").unwrap();
        fs::write(&sidecar, "#!/bin/sh\n").unwrap();
        let link = bin_dir.join("galstudio-cli");

        create_cli_tool_symlink(&launcher, &link).unwrap();
        let status = cli_tool_status_inner(
            &launcher,
            &sidecar,
            &[link.clone()],
            Some(bin_dir.to_str().unwrap()),
        )
        .unwrap();

        assert!(status.installed);
        assert!(status.cli_available);
        assert!(!status.link_occupied);
        assert!(status.in_path);
        assert_eq!(status.link_path, link.to_string_lossy());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn cli_tool_status_does_not_report_app_path_as_terminal_issue() {
        let root = unique_temp_dir("cli-status-no-app-path");
        let bin_dir = root.join("bin");
        fs::create_dir_all(&bin_dir).unwrap();
        let launcher = root.join("GalStudio.app/Contents/Resources/bin/galstudio-cli");
        let sidecar = root.join("GalStudio.app/Contents/MacOS/galstudio-cli");
        fs::create_dir_all(launcher.parent().unwrap()).unwrap();
        fs::create_dir_all(sidecar.parent().unwrap()).unwrap();
        fs::write(&launcher, "#!/bin/sh\n").unwrap();
        fs::write(&sidecar, "#!/bin/sh\n").unwrap();
        let link = bin_dir.join("galstudio-cli");

        create_cli_tool_symlink(&launcher, &link).unwrap();
        let status =
            cli_tool_status_inner(&launcher, &sidecar, &[link.clone()], Some("/usr/bin:/bin"))
                .unwrap();

        assert!(status.installed);
        assert!(!status.in_path);
        assert_eq!(status.issue, None);

        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn cli_tool_candidate_link_paths_use_global_shell_path_on_macos() {
        assert_eq!(
            cli_tool_candidate_link_paths(),
            vec![PathBuf::from("/usr/local/bin/galstudio-cli")]
        );
    }

    #[test]
    fn cli_launcher_path_uses_resource_bin_wrapper() {
        let resources = PathBuf::from("/Applications/galstudio.app/Contents/Resources");

        assert_eq!(
            cli_launcher_path_from_resource_dir(&resources),
            resources.join("bin/galstudio-cli")
        );
    }

    #[test]
    fn install_cli_tool_links_global_command_to_wrapper_not_sidecar() {
        let root = unique_temp_dir("cli-install-wrapper");
        let bin_dir = root.join("bin");
        fs::create_dir_all(&bin_dir).unwrap();
        let launcher = root.join("GalStudio.app/Contents/Resources/bin/galstudio-cli");
        let sidecar = root.join("GalStudio.app/Contents/MacOS/galstudio-cli");
        fs::create_dir_all(launcher.parent().unwrap()).unwrap();
        fs::create_dir_all(sidecar.parent().unwrap()).unwrap();
        fs::write(&launcher, "#!/usr/bin/env bash\n").unwrap();
        fs::write(&sidecar, "#!/usr/bin/env bash\n").unwrap();
        let link = bin_dir.join("galstudio-cli");

        let status = install_cli_tool_inner(
            &launcher,
            &sidecar,
            &[link.clone()],
            Some(bin_dir.to_str().unwrap()),
        )
        .unwrap();

        assert!(status.installed);
        assert_eq!(fs::read_link(&link).unwrap(), launcher);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn cli_tool_status_allows_repairing_legacy_sidecar_symlink() {
        let root = unique_temp_dir("cli-status-legacy-sidecar");
        let bin_dir = root.join("bin");
        fs::create_dir_all(&bin_dir).unwrap();
        let launcher = root.join("GalStudio.app/Contents/Resources/bin/galstudio-cli");
        let sidecar = root.join("GalStudio.app/Contents/MacOS/galstudio-cli");
        fs::create_dir_all(launcher.parent().unwrap()).unwrap();
        fs::create_dir_all(sidecar.parent().unwrap()).unwrap();
        fs::write(&launcher, "#!/bin/sh\n").unwrap();
        fs::write(&sidecar, "#!/bin/sh\n").unwrap();
        let link = bin_dir.join("galstudio-cli");
        create_cli_tool_symlink(&sidecar, &link).unwrap();

        let status = cli_tool_status_inner(
            &launcher,
            &sidecar,
            &[link.clone()],
            Some(bin_dir.to_str().unwrap()),
        )
        .unwrap();

        assert!(!status.installed);
        assert!(!status.link_occupied);
        assert!(status.cli_available);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn install_cli_tool_replaces_legacy_sidecar_symlink_with_wrapper() {
        let root = unique_temp_dir("cli-install-legacy-sidecar");
        let bin_dir = root.join("bin");
        fs::create_dir_all(&bin_dir).unwrap();
        let launcher = root.join("GalStudio.app/Contents/Resources/bin/galstudio-cli");
        let sidecar = root.join("GalStudio.app/Contents/MacOS/galstudio-cli");
        fs::create_dir_all(launcher.parent().unwrap()).unwrap();
        fs::create_dir_all(sidecar.parent().unwrap()).unwrap();
        fs::write(&launcher, "#!/usr/bin/env bash\n").unwrap();
        fs::write(&sidecar, "#!/usr/bin/env bash\n").unwrap();
        let link = bin_dir.join("galstudio-cli");
        create_cli_tool_symlink(&sidecar, &link).unwrap();

        let status = install_cli_tool_inner(
            &launcher,
            &sidecar,
            &[link.clone()],
            Some(bin_dir.to_str().unwrap()),
        )
        .unwrap();

        assert!(status.installed);
        assert_eq!(fs::read_link(&link).unwrap(), launcher);

        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn bundled_cli_wrapper_execs_sidecar_from_symlink() {
        use std::os::unix::fs::{symlink, PermissionsExt};

        let root = unique_temp_dir("cli-wrapper-exec");
        let wrapper = root.join("GalStudio.app/Contents/Resources/bin/galstudio-cli");
        let sidecar = root.join("GalStudio.app/Contents/MacOS/galstudio-cli");
        let link = root.join("bin/galstudio-cli");
        fs::create_dir_all(wrapper.parent().unwrap()).unwrap();
        fs::create_dir_all(sidecar.parent().unwrap()).unwrap();
        fs::create_dir_all(link.parent().unwrap()).unwrap();
        fs::write(&wrapper, include_str!("../../resources/bin/galstudio-cli")).unwrap();
        fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o755)).unwrap();
        symlink("/bin/echo", &sidecar).unwrap();
        symlink(&wrapper, &link).unwrap();

        let output = std::process::Command::new("/usr/bin/env")
            .arg("bash")
            .arg(&link)
            .args(["validate", "."])
            .output()
            .unwrap();

        assert!(
            output.status.success(),
            "status: {}\nstdout: {}\nstderr: {}",
            output.status,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(String::from_utf8_lossy(&output.stdout), "validate .\n");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn admin_symlink_script_quotes_paths_for_shell() {
        let cli =
            PathBuf::from("/Applications/Gal Studio's.app/Contents/Resources/bin/galstudio-cli");
        let link = PathBuf::from("/usr/local/bin/galstudio-cli");

        let script = admin_symlink_script(&cli, &link).unwrap();

        assert!(script
            .contains("'/Applications/Gal Studio'\\''s.app/Contents/Resources/bin/galstudio-cli'"));
        assert!(script.contains("'/usr/local/bin/galstudio-cli'"));
        assert!(script.contains("/bin/ln -s"));
    }

    #[test]
    fn applescript_string_literal_escapes_shell_script() {
        assert_eq!(
            applescript_string_literal("echo \"hi\" && echo \\done"),
            "\"echo \\\"hi\\\" && echo \\\\done\""
        );
    }

    #[test]
    fn install_cli_tool_refuses_to_overwrite_existing_command() {
        let root = unique_temp_dir("cli-install-occupied");
        let bin_dir = root.join("bin");
        fs::create_dir_all(&bin_dir).unwrap();
        let launcher = root.join("galstudio-cli-launcher");
        let sidecar = root.join("galstudio-cli-sidecar");
        fs::write(&launcher, "#!/bin/sh\n").unwrap();
        fs::write(&sidecar, "#!/bin/sh\n").unwrap();
        let link = bin_dir.join("galstudio-cli");
        fs::write(&link, "someone else's command").unwrap();

        let error = install_cli_tool_inner(
            &launcher,
            &sidecar,
            &[link.clone()],
            Some(bin_dir.to_str().unwrap()),
        )
        .unwrap_err();

        assert!(error.contains("已存在"));
        assert_eq!(fs::read_to_string(&link).unwrap(), "someone else's command");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn uninstall_cli_tool_only_removes_managed_symlink() {
        let root = unique_temp_dir("cli-uninstall");
        let bin_dir = root.join("bin");
        fs::create_dir_all(&bin_dir).unwrap();
        let launcher = root.join("galstudio-cli-launcher");
        let sidecar = root.join("galstudio-cli-sidecar");
        fs::write(&launcher, "#!/bin/sh\n").unwrap();
        fs::write(&sidecar, "#!/bin/sh\n").unwrap();
        let link = bin_dir.join("galstudio-cli");
        create_cli_tool_symlink(&launcher, &link).unwrap();

        let status = uninstall_cli_tool_inner(
            &launcher,
            &sidecar,
            &[link.clone()],
            Some(bin_dir.to_str().unwrap()),
        )
        .unwrap();

        assert!(!link.exists());
        assert!(!status.installed);
        assert!(status.cli_available);

        let _ = fs::remove_dir_all(&root);
    }
}
