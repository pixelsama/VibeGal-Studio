pub(crate) use super::super::cli_tool::*;
pub(crate) use super::super::fs::*;
pub(crate) use super::super::model::*;
pub(crate) use super::super::mutation::*;
pub(crate) use super::super::project::*;
pub(crate) use super::super::renderer::*;
pub(crate) use super::super::resources::*;
pub(crate) use super::super::validation::*;
pub(crate) use super::super::watcher::*;
pub(crate) use std::fs;
pub(crate) use std::path::{Path, PathBuf};
pub(crate) use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) fn unique_temp_dir(name: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("vibegal-{name}-{stamp}"))
}

pub(crate) fn write_text(path: &Path, text: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, text).unwrap();
}

pub(crate) fn write_minimal_project(project: &Path) {
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

pub(crate) fn write_legacy_chapter_project(project: &Path, chapters_value: serde_json::Value) {
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

pub(crate) fn write_graph_project(
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

pub(crate) fn write_graph_project_with_files(
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

pub(crate) fn write_renderer_project(project: &Path) {
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

pub(crate) fn write_asset_project(project: &Path, manifest_json: &str, asset_files: &[&str]) {
    write_minimal_project(project);
    write_text(&project.join("content/manifest.json"), manifest_json);
    for rel in asset_files {
        write_text(&project.join("content").join(rel), "fake");
    }
}

pub(crate) fn validate_assets_for_project(
    content_root: &Path,
    manifest: &serde_json::Value,
) -> Vec<GraphIssue> {
    let project_root = ProjectRoot::open(content_root.parent().unwrap()).unwrap();
    let content_root = project_root.content_root().unwrap();
    let entries = list_asset_entries(&content_root).unwrap();
    validate_assets(&entries, manifest)
}

pub(crate) fn graph_input(node_file: &str, title: &str) -> serde_json::Value {
    serde_json::json!({
        "version": 1,
        "entryNodeId": "prologue",
        "nodes": [
            { "id": "prologue", "title": title, "file": node_file, "position": { "x": 120.0, "y": 180.0 } },
            { "id": "ending", "title": "Ending", "file": "nodes/ending.json", "position": { "x": 380.0, "y": 180.0 } }
        ],
        "edges": [{ "id": "prologue__ending", "from": "prologue", "to": "ending", "mode": "linear", "label": null, "condition": null }]
    })
}

pub(crate) fn graph_node(id: &str, file: &str) -> GraphNode {
    GraphNode {
        id: id.to_string(),
        title: id.to_string(),
        file: file.to_string(),
        position: GraphPosition { x: 0.0, y: 0.0 },
    }
}

pub(crate) fn graph_edge(id: &str, from: &str, to: &str) -> GraphEdge {
    GraphEdge {
        id: id.to_string(),
        from: from.to_string(),
        to: to.to_string(),
        mode: "linear".to_string(),
        label: None,
        condition: None,
    }
}

pub(crate) fn choice_edge(id: &str, from: &str, to: &str, label: &str) -> GraphEdge {
    GraphEdge {
        id: id.to_string(),
        from: from.to_string(),
        to: to.to_string(),
        mode: "choice".to_string(),
        label: Some(label.to_string()),
        condition: None,
    }
}

pub(crate) fn auto_edge(id: &str, from: &str, to: &str, condition: Option<&str>) -> GraphEdge {
    GraphEdge {
        id: id.to_string(),
        from: from.to_string(),
        to: to.to_string(),
        mode: "auto".to_string(),
        label: None,
        condition: condition.map(|condition| condition.to_string()),
    }
}

pub(crate) fn node_entry(rel_path: &str, data: serde_json::Value) -> NodeEntry {
    NodeEntry {
        rel_path: rel_path.to_string(),
        data: Some(data),
    }
}

pub(crate) fn manifest_with_refs() -> serde_json::Value {
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
        "cg": { "cg_rooftop_asset": "assets/cg/rooftop.png" },
        "videos": { "opening": "assets/videos/opening.mp4" },
        "audio": {
            "bgm": { "theme": "assets/audio/bgm/theme.mp3" },
            "sfx": { "click": "assets/audio/sfx/click.wav" },
            "voice": { "line01": "assets/audio/voice/line01.ogg" }
        },
        "unlocks": {
            "cg": { "cg_rooftop": { "assetId": "cg_rooftop_asset", "title": "屋顶" } },
            "music": { "theme_unlock": { "audioId": "theme", "title": "主题曲" } },
            "replay": { "start_replay": { "nodeId": "start", "title": "序章" } },
            "endings": { "true_end": { "title": "True End", "nodeId": "ending" } }
        }
    })
}

pub(crate) fn one_node_graph() -> ProjectGraph {
    ProjectGraph {
        version: 1,
        entry_node_id: "start".to_string(),
        nodes: vec![graph_node("start", "nodes/start.json")],
        edges: vec![],
    }
}

pub(crate) fn valid_project_graph() -> ProjectGraph {
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

pub(crate) fn present_node_entries(graph: &ProjectGraph) -> Vec<NodeEntry> {
    graph
        .nodes
        .iter()
        .map(|node| NodeEntry {
            rel_path: node.file.clone(),
            data: Some(serde_json::json!([])),
        })
        .collect()
}

pub(crate) fn choice_branch_graph() -> ProjectGraph {
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

pub(crate) fn cyclic_graph_without_ending() -> ProjectGraph {
    ProjectGraph {
        version: 1,
        entry_node_id: "start".to_string(),
        nodes: vec![
            graph_node("start", "nodes/start.json"),
            graph_node("loop_a", "nodes/loop_a.json"),
            graph_node("loop_b", "nodes/loop_b.json"),
        ],
        edges: vec![
            graph_edge("start__loop_a", "start", "loop_a"),
            graph_edge("loop_a__loop_b", "loop_a", "loop_b"),
            graph_edge("loop_b__loop_a", "loop_b", "loop_a"),
        ],
    }
}
