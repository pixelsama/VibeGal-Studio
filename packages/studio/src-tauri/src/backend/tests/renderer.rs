use super::support::*;

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
