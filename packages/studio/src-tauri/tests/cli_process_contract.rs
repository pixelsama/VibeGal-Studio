use serde_json::Value;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn validate_process_preserves_json_output_and_exit_code_contract() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let examples = manifest_dir.join("../../../examples");

    let clean = run_validate(&examples.join("sample-novel"));
    assert_eq!(clean.status.code(), Some(0));
    assert_validate_output(&clean, true, None);

    let warning = run_validate(&examples.join("broken-projects/missing-node-file"));
    assert_eq!(warning.status.code(), Some(2));
    assert_validate_output(&warning, false, Some("missing_node_file"));

    let root = unique_temp_dir();
    let invalid = root.join("Project With Spaces");
    write_project(&invalid, r#"{"version":1,"nodes":[],"edges":[]}"#);
    let error = run_validate(&invalid);
    assert_eq!(error.status.code(), Some(1));
    assert_validate_output(&error, false, Some("graph_invalid_structure"));

    let unreadable = run_validate(&root.join("not-a-project"));
    assert_eq!(unreadable.status.code(), Some(70));
    assert_validate_output(&unreadable, false, Some("open_project_failed"));

    let _ = fs::remove_dir_all(root);
}

fn run_validate(project: &Path) -> Output {
    Command::new(env!("CARGO_BIN_EXE_vibegal-cli"))
        .args([
            "validate",
            project.to_string_lossy().as_ref(),
            "--format",
            "json",
        ])
        .output()
        .expect("installed CLI process must run")
}

fn assert_validate_output(output: &Output, ok: bool, expected_code: Option<&str>) {
    assert!(
        output.stderr.is_empty(),
        "validate JSON mode wrote stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let value: Value = serde_json::from_slice(&output.stdout).expect("stdout must be JSON");
    assert_eq!(value["ok"], ok);
    assert_eq!(
        value
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect::<BTreeSet<_>>(),
        BTreeSet::from([
            "ok",
            "projectPath",
            "projectIssues",
            "graphIssues",
            "assetIssues"
        ])
    );
    if let Some(code) = expected_code {
        let has_code = ["projectIssues", "graphIssues", "assetIssues"]
            .into_iter()
            .flat_map(|key| value[key].as_array().unwrap())
            .any(|issue| issue["code"] == code);
        assert!(has_code, "missing stable issue code {code}: {value}");
    }
}

fn write_project(root: &Path, graph: &str) {
    fs::create_dir_all(root.join("content/nodes")).unwrap();
    fs::create_dir_all(root.join("renderers/default")).unwrap();
    fs::write(
        root.join("gal.project.json"),
        r#"{"name":"CLI contract","activeRendererId":"default","createdAt":"0"}"#,
    )
    .unwrap();
    fs::write(root.join("content/graph.json"), graph).unwrap();
    fs::write(
        root.join("content/manifest.json"),
        r#"{"characters":{},"backgrounds":{}}"#,
    )
    .unwrap();
    fs::write(root.join("content/meta.json"), r#"{}"#).unwrap();
    fs::write(
        root.join("renderers/default/index.tsx"),
        "export default {};",
    )
    .unwrap();
}

fn unique_temp_dir() -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("vibegal-cli-process-contract-{stamp}"))
}
