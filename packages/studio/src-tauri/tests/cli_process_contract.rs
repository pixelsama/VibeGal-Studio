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

#[test]
fn build_progress_is_ndjson_and_legacy_json_remains_single_document() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let project = manifest_dir.join("../../../examples/sample-novel");
    let root = unique_temp_dir();

    let progress = Command::new(env!("CARGO_BIN_EXE_vibegal-cli"))
        .args([
            "build",
            project.to_string_lossy().as_ref(),
            "--target",
            "web",
            "--out",
            root.join("progress").to_string_lossy().as_ref(),
            "--format",
            "json",
            "--progress",
            "jsonl",
        ])
        .output()
        .expect("progress build must run");
    assert!(
        progress.status.success(),
        "{}",
        String::from_utf8_lossy(&progress.stderr)
    );
    let lines = String::from_utf8(progress.stdout).unwrap();
    let values = lines
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).expect("each stdout line must be JSON"))
        .collect::<Vec<_>>();
    assert!(
        values.len() >= 5,
        "expected four progress events plus result: {values:?}"
    );
    assert_eq!(values.first().unwrap()["type"], "progress");
    assert_eq!(values.first().unwrap()["step"], "validate");
    assert_eq!(values.last().unwrap()["ok"], true);
    assert!(values.last().unwrap().get("type").is_none());

    let legacy = Command::new(env!("CARGO_BIN_EXE_vibegal-cli"))
        .args([
            "build",
            project.to_string_lossy().as_ref(),
            "--target",
            "web",
            "--out",
            root.join("legacy").to_string_lossy().as_ref(),
            "--format",
            "json",
        ])
        .output()
        .expect("legacy build must run");
    assert!(legacy.status.success());
    let legacy_value: Value =
        serde_json::from_slice(&legacy.stdout).expect("legacy stdout is one JSON document");
    assert_eq!(legacy_value["ok"], true);
    assert!(legacy_value.get("type").is_none());

    let invalid = Command::new(env!("CARGO_BIN_EXE_vibegal-cli"))
        .args([
            "build",
            project.to_string_lossy().as_ref(),
            "--target",
            "web",
            "--out",
            root.join("invalid").to_string_lossy().as_ref(),
            "--format",
            "text",
            "--progress",
            "jsonl",
        ])
        .output()
        .expect("invalid progress combination must return a structured error");
    assert!(!invalid.status.success());
    let error: Value =
        serde_json::from_slice(&invalid.stderr).expect("progress option error is JSON");
    assert_eq!(error["code"], "build_progress_requires_json");

    let _ = fs::remove_dir_all(root);
}

#[test]
fn doctor_uses_vibegal_node_and_reports_missing_components_as_fields() {
    let root = unique_temp_dir();
    fs::create_dir_all(&root).unwrap();
    #[cfg(windows)]
    let (fake_node, body) = (root.join("fake-node.cmd"), "@echo off\r\necho v99.1.0\r\n");
    #[cfg(not(windows))]
    let (fake_node, body) = (root.join("fake-node"), "#!/bin/sh\nprintf 'v99.1.0\\n'\n");
    fs::write(&fake_node, body).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&fake_node).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&fake_node, permissions).unwrap();
    }

    let output = Command::new(env!("CARGO_BIN_EXE_vibegal-cli"))
        .args(["doctor", "--format", "json"])
        .env("VIBEGAL_NODE", &fake_node)
        .env("VIBEGAL_ELECTRON_RUNTIME_CACHE", root.join("empty-cache"))
        .env_remove("VIBEGAL_ELECTRON_DIST")
        .output()
        .expect("doctor must always run");
    assert_eq!(output.status.code(), Some(0));
    let value: Value = serde_json::from_slice(&output.stdout).expect("doctor stdout is JSON");
    assert_eq!(value["node"]["available"], true);
    assert_eq!(value["node"]["version"], "v99.1.0");
    assert_eq!(value["node"]["source"], "env");
    assert_eq!(value["electron"]["cached"], false);
    assert_eq!(value["electron"]["version"], "43.1.1");
    assert!(value["exporter"]["webWorker"].is_boolean());
    assert!(value["exporter"]["desktopWorker"].is_boolean());

    let _ = fs::remove_dir_all(root);
}

#[test]
fn doctor_reports_resolved_worker_paths_on_stderr() {
    let root = unique_temp_dir();
    fs::create_dir_all(&root).unwrap();
    let web_worker = root.join("web-worker.mjs");
    let desktop_worker = root.join("desktop-worker.mjs");
    fs::write(&web_worker, "// web worker").unwrap();
    fs::write(&desktop_worker, "// desktop worker").unwrap();

    let output = Command::new(env!("CARGO_BIN_EXE_vibegal-cli"))
        .args(["doctor", "--format", "json"])
        .env("VIBEGAL_EXPORT_WORKER", &web_worker)
        .env("VIBEGAL_DESKTOP_WORKER", &desktop_worker)
        .output()
        .expect("doctor must report resolved worker paths");

    assert_eq!(output.status.code(), Some(0));
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(
        stderr.contains(&format!(
            "[vibegal-cli] VIBEGAL_EXPORT_WORKER resolved to {}",
            web_worker.display()
        )),
        "missing web worker resolution in stderr: {stderr}"
    );
    assert!(
        stderr.contains(&format!(
            "[vibegal-cli] VIBEGAL_DESKTOP_WORKER resolved to {}",
            desktop_worker.display()
        )),
        "missing desktop worker resolution in stderr: {stderr}"
    );

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
