use super::support::*;

#[cfg(unix)]
#[test]
fn project_root_rejects_symlinked_content_directory() {
    use std::os::unix::fs::symlink;

    let root = unique_temp_dir("content-root-symlink");
    let external = root.join("external-content");
    fs::create_dir_all(&external).unwrap();
    write_text(
        &root.join("project/gal.project.json"),
        r#"{"name":"Test","activeRendererId":"default","createdAt":"0"}"#,
    );
    symlink(&external, root.join("project/content")).unwrap();

    let result = open_project_inner(root.join("project").to_string_lossy().as_ref());
    assert!(result.is_err());
    assert!(result.err().unwrap().contains("符号链接"));
    let _ = fs::remove_dir_all(&root);
}

#[cfg(unix)]
#[test]
fn list_projects_skips_symlinked_project_directories() {
    use std::os::unix::fs::symlink;

    let root = unique_temp_dir("list-project-dir-symlink");
    let workspace = root.join("workspace");
    let external_project = root.join("external-project");
    fs::create_dir_all(&workspace).unwrap();
    write_minimal_project(&external_project);
    symlink(&external_project, workspace.join("linked-project")).unwrap();

    let projects = list_projects(workspace.to_string_lossy().into_owned()).unwrap();
    assert!(
        projects.is_empty(),
        "workspace project symlinks must not be listed"
    );

    let _ = fs::remove_dir_all(&root);
}

#[cfg(unix)]
#[test]
fn list_projects_skips_symlinked_control_files() {
    use std::os::unix::fs::symlink;

    let root = unique_temp_dir("list-project-control-symlink");
    let workspace = root.join("workspace");
    let project = workspace.join("project");
    let external_control = root.join("external-project.json");
    fs::create_dir_all(&project).unwrap();
    write_text(
        &external_control,
        r#"{"name":"External","activeRendererId":"default","createdAt":"0"}"#,
    );
    symlink(&external_control, project.join("gal.project.json")).unwrap();

    let projects = list_projects(workspace.to_string_lossy().into_owned()).unwrap();
    assert!(
        projects.is_empty(),
        "symlinked project control files must not be listed"
    );

    let _ = fs::remove_dir_all(&root);
}

#[cfg(unix)]
#[test]
fn project_loader_rejects_symlinked_gal_project_file() {
    use std::os::unix::fs::symlink;

    let root = unique_temp_dir("gal-project-symlink");
    let project = root.join("project");
    let external_control = root.join("external-project.json");
    fs::create_dir_all(project.join("content")).unwrap();
    write_text(
        &external_control,
        r#"{"name":"External","activeRendererId":"default","createdAt":"0"}"#,
    );
    symlink(&external_control, project.join("gal.project.json")).unwrap();

    let error = open_project_inner(project.to_string_lossy().as_ref())
        .err()
        .expect("project control symlinks must be rejected");
    assert!(error.contains("符号链接"), "unexpected error: {error}");

    let _ = fs::remove_dir_all(&root);
}

#[cfg(unix)]
#[test]
fn project_loader_rejects_symlinked_manifest_file() {
    use std::os::unix::fs::symlink;

    let root = unique_temp_dir("control-file-symlink");
    let project = root.join("project");
    write_minimal_project(&project);
    let external = root.join("external-manifest.json");
    write_text(
        &external,
        r#"{"characters":{},"backgrounds":{},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
    );
    fs::remove_file(project.join("content/manifest.json")).unwrap();
    symlink(&external, project.join("content/manifest.json")).unwrap();

    let result = open_project_inner(project.to_string_lossy().as_ref());
    assert!(result.is_err());
    assert!(result.err().unwrap().contains("符号链接"));
    let _ = fs::remove_dir_all(&root);
}

#[cfg(unix)]
#[test]
fn project_loader_rejects_symlinked_meta_file() {
    use std::os::unix::fs::symlink;

    let root = unique_temp_dir("meta-file-symlink");
    let project = root.join("project");
    let external = root.join("external-meta.json");
    write_minimal_project(&project);
    write_text(&external, r#"{"title":"Outside"}"#);
    fs::remove_file(project.join("content/meta.json")).unwrap();
    symlink(&external, project.join("content/meta.json")).unwrap();

    let error = open_project_inner(project.to_string_lossy().as_ref())
        .err()
        .expect("meta symlinks must be rejected");
    assert!(error.contains("符号链接"), "unexpected error: {error}");

    let _ = fs::remove_dir_all(&root);
}

#[cfg(unix)]
#[test]
fn project_loader_rejects_symlinked_graph_file() {
    use std::os::unix::fs::symlink;

    let root = unique_temp_dir("graph-file-symlink");
    let project = root.join("project");
    let external = root.join("external-graph.json");
    write_minimal_project(&project);
    write_text(&external, r#"{"entryNodeId":"","nodes":[],"edges":[]}"#);
    symlink(&external, project.join("content/graph.json")).unwrap();

    let error = open_project_inner(project.to_string_lossy().as_ref())
        .err()
        .expect("graph symlinks must be rejected");
    assert!(error.contains("符号链接"), "unexpected error: {error}");

    let _ = fs::remove_dir_all(&root);
}

#[cfg(unix)]
#[test]
fn project_loader_rejects_symlinked_node_file() {
    use std::os::unix::fs::symlink;

    let root = unique_temp_dir("node-file-symlink");
    let project = root.join("project");
    let external = root.join("external-node.json");
    write_graph_project(
        &project,
        serde_json::json!({
            "entryNodeId": "start",
            "nodes": [{ "id": "start", "file": "nodes/start.json" }],
            "edges": []
        }),
        &[],
    );
    write_text(&external, "[]");
    fs::create_dir_all(project.join("content/nodes")).unwrap();
    symlink(&external, project.join("content/nodes/start.json")).unwrap();

    let error = open_project_inner(project.to_string_lossy().as_ref())
        .err()
        .expect("node symlinks must be rejected");
    assert!(error.contains("符号链接"), "unexpected error: {error}");

    let _ = fs::remove_dir_all(&root);
}

#[cfg(unix)]
#[test]
fn asset_reader_rejects_symlink_escape() {
    use std::os::unix::fs::symlink;

    let root = unique_temp_dir("asset-symlink-escape");
    let project = root.join("project");
    write_minimal_project(&project);
    let external = root.join("outside.png");
    write_text(&external, "outside");
    let target = project.join("content/assets/escaped.png");
    fs::create_dir_all(target.parent().unwrap()).unwrap();
    symlink(&external, &target).unwrap();

    let result = read_asset_preview_data_url(
        project.to_string_lossy().into_owned(),
        "assets/escaped.png".to_string(),
    );
    assert!(result.is_err());
    assert!(result.err().unwrap().contains("符号链接"));
    let _ = fs::remove_dir_all(&root);
}
