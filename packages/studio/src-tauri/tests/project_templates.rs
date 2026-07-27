use app_lib::{create_project_from_template, open_project_for_cli, ProjectTemplate};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn project_template_rejects_unknown_serialized_values() {
    let error =
        serde_json::from_value::<ProjectTemplate>(Value::String("starter".into())).unwrap_err();
    assert!(error.to_string().contains("unknown variant"));
}

#[test]
fn blank_and_example_templates_create_valid_projects() {
    let root = unique_temp_dir("shapes");
    fs::create_dir_all(&root).unwrap();
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let renderer = manifest_dir.join("resources/default-renderer");
    let example = manifest_dir.join("resources/example-content");

    let blank = create_project_from_template(
        root.to_string_lossy().as_ref(),
        "Blank Story",
        ProjectTemplate::Blank,
        &renderer,
        &example,
    )
    .unwrap();
    let blank_data = open_project_for_cli(blank.to_string_lossy().as_ref()).unwrap();
    assert_eq!(blank_data.meta.name, "Blank Story");
    assert_eq!(blank_data.content.meta["title"], "Blank Story");
    assert_eq!(blank_data.graph.unwrap().entry_node_id, "start");
    assert!(blank_data.content.variables["variables"]
        .as_object()
        .unwrap()
        .is_empty());

    let example_project = create_project_from_template(
        root.to_string_lossy().as_ref(),
        "My Example",
        ProjectTemplate::Example,
        &renderer,
        &example,
    )
    .unwrap();
    let example_data = open_project_for_cli(example_project.to_string_lossy().as_ref()).unwrap();
    assert_eq!(example_data.meta.name, "My Example");
    assert_eq!(example_data.content.meta["title"], "My Example");
    assert_eq!(example_data.graph.unwrap().entry_node_id, "prologue");
    assert!(example_data.content.variables["variables"]["resolve"].is_object());
    assert!(example_project
        .join("content/fixtures/dawn-reunion.json")
        .is_file());
    assert!(example_project
        .join("content/assets/backgrounds/ocean_dawn.svg")
        .is_file());
    assert!(example_project
        .join("renderers/default/index.tsx")
        .is_file());
    assert!(!example_project.join("content/gal.project.json").exists());
    assert!(!example_project.join("content/renderers").exists());
    assert!(!example_project.join("content/.galstudio").exists());

    let validation = Command::new(env!("CARGO_BIN_EXE_vibegal-cli"))
        .args([
            "validate",
            example_project.to_string_lossy().as_ref(),
            "--format",
            "json",
        ])
        .output()
        .expect("created example must be validated by the installed CLI");
    assert_eq!(
        validation.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&validation.stdout)
    );
    let value: Value = serde_json::from_slice(&validation.stdout).unwrap();
    assert_eq!(value["ok"], true);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn creating_an_example_in_an_existing_directory_never_overwrites_it() {
    let root = unique_temp_dir("preflight");
    fs::create_dir_all(&root).unwrap();
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let renderer = manifest_dir.join("resources/default-renderer");
    let example = manifest_dir.join("resources/example-content");
    let project = create_project_from_template(
        root.to_string_lossy().as_ref(),
        "Conflict",
        ProjectTemplate::Example,
        &renderer,
        &example,
    )
    .unwrap();
    let existing = project.join("content/assets/backgrounds/ocean_dawn.svg");
    let original = fs::read(&existing).unwrap();

    let error = create_project_from_template(
        root.to_string_lossy().as_ref(),
        "Conflict",
        ProjectTemplate::Example,
        &renderer,
        &example,
    )
    .unwrap_err();

    assert!(error.contains("目录已存在"), "unexpected error: {error}");
    assert_eq!(fs::read(existing).unwrap(), original);
    assert!(project.join("gal.project.json").is_file());
    assert!(project.join("content/graph.json").is_file());
    assert!(project.join("renderers/default/index.tsx").is_file());

    let _ = fs::remove_dir_all(root);
}

fn unique_temp_dir(label: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("vibegal-project-template-{label}-{stamp}"))
}
