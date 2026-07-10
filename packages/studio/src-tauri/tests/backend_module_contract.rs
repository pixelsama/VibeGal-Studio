use app_lib::{
    open_project_for_cli, GraphIssue, GraphIssueSeverity, ProjectData, ProjectIssue, ProjectMeta,
};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

const COMMAND_NAMES: [&str; 26] = [
    "list_projects",
    "open_project",
    "create_project",
    "initialize_project",
    "watch_project",
    "unwatch_project",
    "save_file",
    "save_graph",
    "save_graph_positions",
    "delete_file",
    "save_project_meta",
    "read_renderer_files",
    "create_renderer",
    "duplicate_renderer",
    "rename_renderer",
    "delete_renderer",
    "list_assets",
    "import_asset",
    "delete_asset",
    "read_asset_preview_data_url",
    "save_manifest",
    "load_app_settings",
    "save_app_settings",
    "cli_tool_status",
    "install_cli_tool",
    "uninstall_cli_tool",
];

const REQUIRED_DOMAIN_MODULES: [&str; 9] = [
    "model",
    "fs",
    "validation",
    "project",
    "mutation",
    "renderer",
    "watcher",
    "commands",
    "tauri_app",
];

const RETIRED_MIXED_MODULES: [&str; 2] = ["project_commands", "run"];

const COMMAND_JSON_KEYS: [(&str, &[&str]); 26] = [
    ("list_projects", &["workspaceDir"]),
    ("open_project", &["path"]),
    ("create_project", &["parentDir", "name"]),
    ("initialize_project", &["path"]),
    ("watch_project", &["projectPath"]),
    ("unwatch_project", &["projectPath"]),
    (
        "save_file",
        &["projectPath", "relPath", "content", "expectedRevision"],
    ),
    ("save_graph", &["projectPath", "graph", "expectedRevision"]),
    (
        "save_graph_positions",
        &["projectPath", "updates", "expectedRevision"],
    ),
    (
        "delete_file",
        &["projectPath", "relPath", "expectedRevision"],
    ),
    (
        "save_project_meta",
        &["projectPath", "meta", "expectedRevision"],
    ),
    ("read_renderer_files", &["projectPath", "rendererId"]),
    (
        "create_renderer",
        &["projectPath", "rendererId", "templateId"],
    ),
    ("duplicate_renderer", &["projectPath", "sourceId", "newId"]),
    ("rename_renderer", &["projectPath", "oldId", "newId"]),
    ("delete_renderer", &["projectPath", "rendererId"]),
    ("list_assets", &["projectPath"]),
    (
        "import_asset",
        &["projectPath", "sourceAbsPath", "destRelPath"],
    ),
    (
        "delete_asset",
        &["projectPath", "relPath", "expectedRevision"],
    ),
    ("read_asset_preview_data_url", &["projectPath", "relPath"]),
    (
        "save_manifest",
        &["projectPath", "manifest", "expectedRevision"],
    ),
    ("load_app_settings", &[]),
    ("save_app_settings", &["settings"]),
    ("cli_tool_status", &[]),
    ("install_cli_tool", &[]),
    ("uninstall_cli_tool", &[]),
];

#[test]
fn backend_uses_rust_modules_instead_of_textual_includes() {
    let backend = manifest_dir().join("src/backend");
    let mut offenders = Vec::new();
    for path in rust_files_under(&backend) {
        let source = fs::read_to_string(&path).expect("backend Rust source must be readable");
        if source.contains("include!(") {
            offenders.push(relative(&path));
        }
    }
    assert!(
        offenders.is_empty(),
        "backend must not use ordinary include!: {}",
        offenders.join(", ")
    );
    assert!(
        !backend.join("imports.rs").exists(),
        "shared imports.rs must be removed"
    );
}

#[test]
fn backend_declares_explicit_domain_boundaries() {
    let backend = manifest_dir().join("src/backend");
    let module_source = fs::read_to_string(backend.join("mod.rs"))
        .expect("backend module entry point must be readable");
    let declared = declared_modules(&module_source);

    let missing = REQUIRED_DOMAIN_MODULES
        .into_iter()
        .filter(|module| !declared.contains(*module))
        .collect::<Vec<_>>();
    assert!(
        missing.is_empty(),
        "backend/mod.rs must declare the required domain boundaries; missing: {}",
        missing.join(", ")
    );

    let unloaded = REQUIRED_DOMAIN_MODULES
        .into_iter()
        .filter(|module| !module_path_exists(&backend, module))
        .collect::<Vec<_>>();
    assert!(
        unloaded.is_empty(),
        "each required domain must have a Rust module path; missing: {}",
        unloaded.join(", ")
    );
}

#[test]
fn legacy_mixed_responsibility_modules_are_retired() {
    let backend = manifest_dir().join("src/backend");
    let remaining = RETIRED_MIXED_MODULES
        .into_iter()
        .filter(|module| module_path_exists(&backend, module))
        .collect::<Vec<_>>();
    assert!(
        remaining.is_empty(),
        "legacy mixed-responsibility modules must be replaced by domain services and adapters: {}",
        remaining.join(", ")
    );
}

#[test]
fn tauri_command_attributes_live_only_in_the_commands_adapter() {
    let backend = manifest_dir().join("src/backend");
    let commands = backend.join("commands");
    let offenders = rust_files_under(&backend)
        .into_iter()
        .filter(|path| !path.starts_with(&commands))
        .filter(|path| {
            fs::read_to_string(path)
                .expect("backend Rust source must be readable")
                .lines()
                .any(|line| line.trim() == "#[tauri::command]")
        })
        .map(|path| relative(&path))
        .collect::<Vec<_>>();

    assert!(
        offenders.is_empty(),
        "Tauri command attributes belong only in backend/commands adapters: {}",
        offenders.join(", ")
    );
}

#[test]
fn domain_services_do_not_depend_on_tauri_adapters() {
    let backend = manifest_dir().join("src/backend");
    let domains = [
        "fs",
        "validation",
        "project",
        "mutation",
        "renderer",
        "watcher",
    ];
    let mut offenders = Vec::new();
    for domain in domains {
        let root = backend.join(domain);
        for path in rust_files_under(&root) {
            let source = fs::read_to_string(&path).expect("domain Rust source must be readable");
            if source.contains("tauri::") || source.contains("AppHandle") {
                offenders.push(relative(&path));
            }
        }
    }
    for file in ["model.rs", "settings.rs", "cli_tool.rs"] {
        let path = backend.join(file);
        let source = fs::read_to_string(&path).expect("domain Rust source must be readable");
        if source.contains("tauri::") || source.contains("AppHandle") {
            offenders.push(relative(&path));
        }
    }

    assert!(
        offenders.is_empty(),
        "domain services must not depend on Tauri adapters: {}",
        offenders.join(", ")
    );
}

#[test]
fn validation_domain_does_not_open_project_files() {
    let validation = manifest_dir().join("src/backend/validation");
    let forbidden = [
        "std::fs",
        "fs::",
        "read_json",
        "file_revision",
        "ProjectRoot",
        "ContentRoot",
    ];
    let mut offenders = Vec::new();
    for path in rust_files_under(&validation) {
        let source = fs::read_to_string(&path).expect("validation source must be readable");
        for token in forbidden {
            if source.contains(token) {
                offenders.push(format!("{} ({token})", relative(&path)));
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "validation must receive data instead of opening project files: {}",
        offenders.join(", ")
    );
}

#[test]
fn cli_public_facade_remains_available_to_external_crates() {
    let _: fn(&str) -> Result<ProjectData, String> = open_project_for_cli;
    let _: Option<ProjectMeta> = None;
    fn inspect(data: &ProjectData, project_issue: &ProjectIssue, graph_issue: &GraphIssue) {
        let _: &str = &data.path;
        let _: &str = &data.meta.active_renderer_id;
        let _: GraphIssueSeverity = project_issue.severity;
        let _: GraphIssueSeverity = graph_issue.severity;
    }
    let _ = inspect;
}

#[test]
fn tauri_command_names_match_the_stable_ipc_contract() {
    let backend = manifest_dir().join("src/backend");
    let mut actual = BTreeSet::new();
    for path in rust_files_under(&backend) {
        let source = fs::read_to_string(path).expect("backend Rust source must be readable");
        let mut command_attribute = false;
        for line in source.lines() {
            let trimmed = line.trim();
            if trimmed == "#[tauri::command]" {
                command_attribute = true;
                continue;
            }
            if command_attribute {
                if let Some(name) = function_name(trimmed) {
                    actual.insert(name.to_string());
                    command_attribute = false;
                } else if !trimmed.is_empty() && !trimmed.starts_with("#") {
                    command_attribute = false;
                }
            }
        }
    }
    let expected = COMMAND_NAMES
        .into_iter()
        .map(str::to_string)
        .collect::<BTreeSet<_>>();
    assert_eq!(actual, expected);

    let tauri_app = fs::read_to_string(backend.join("tauri_app.rs"))
        .expect("tauri_app.rs must own Tauri application wiring");
    let registered = registered_command_names(&tauri_app);
    assert_eq!(
        registered, expected,
        "tauri_app must register exactly the stable IPC command set"
    );
}

#[test]
fn tauri_command_json_parameter_keys_match_the_stable_ipc_contract() {
    let source = fs::read_to_string(manifest_dir().join("src/backend/commands/mod.rs"))
        .expect("commands adapter must be readable");
    for (command, expected) in COMMAND_JSON_KEYS {
        let actual = command_parameters(&source, command)
            .into_iter()
            .filter(|(_, ty)| !ty.contains("tauri::AppHandle") && !ty.contains("tauri::State"))
            .map(|(name, _)| lower_camel_case(name))
            .collect::<Vec<_>>();
        assert_eq!(actual, expected, "stable JSON parameter keys for {command}");
    }
}

fn declared_modules(source: &str) -> BTreeSet<&str> {
    source
        .lines()
        .filter_map(|line| {
            let declaration = line.trim().strip_suffix(';')?;
            let module = declaration
                .strip_prefix("mod ")
                .or_else(|| declaration.strip_prefix("pub(crate) mod "))?;
            (!module.is_empty() && !module.contains(char::is_whitespace)).then_some(module)
        })
        .collect()
}

fn module_path_exists(backend: &Path, module: &str) -> bool {
    backend.join(format!("{module}.rs")).is_file() || backend.join(module).join("mod.rs").is_file()
}

fn registered_command_names(source: &str) -> BTreeSet<String> {
    let Some((_, handler_source)) = source.split_once("tauri::generate_handler![") else {
        return BTreeSet::new();
    };
    let Some((handler_source, _)) = handler_source.split_once(']') else {
        return BTreeSet::new();
    };

    handler_source
        .split(',')
        .filter_map(|entry| {
            entry
                .trim()
                .rsplit("::")
                .next()
                .filter(|name| !name.is_empty())
                .map(str::to_string)
        })
        .collect()
}

fn function_name(line: &str) -> Option<&str> {
    let after_fn = line
        .strip_prefix("fn ")
        .or_else(|| line.strip_prefix("pub(crate) fn "))?;
    after_fn.split(['(', '<']).next()
}

fn command_parameters<'a>(source: &'a str, command: &str) -> Vec<(&'a str, &'a str)> {
    let marker = format!("fn {command}(");
    let start = source
        .find(&marker)
        .unwrap_or_else(|| panic!("missing command {command}"))
        + marker.len();
    let mut angle_depth = 0usize;
    let mut paren_depth = 1usize;
    let mut segment_start = start;
    let mut segments = Vec::new();
    for (offset, ch) in source[start..].char_indices() {
        match ch {
            '<' => angle_depth += 1,
            '>' => angle_depth = angle_depth.saturating_sub(1),
            '(' => paren_depth += 1,
            ')' => {
                paren_depth -= 1;
                if paren_depth == 0 {
                    segments.push(&source[segment_start..start + offset]);
                    break;
                }
            }
            ',' if angle_depth == 0 && paren_depth == 1 => {
                segments.push(&source[segment_start..start + offset]);
                segment_start = start + offset + ch.len_utf8();
            }
            _ => {}
        }
    }
    segments
        .into_iter()
        .filter_map(|segment| {
            let (name, ty) = segment.trim().split_once(':')?;
            Some((name.trim(), ty.trim()))
        })
        .collect()
}

fn lower_camel_case(name: &str) -> String {
    let mut parts = name.split('_');
    let mut result = parts.next().unwrap_or_default().to_string();
    for part in parts {
        let mut chars = part.chars();
        if let Some(first) = chars.next() {
            result.extend(first.to_uppercase());
            result.extend(chars);
        }
    }
    result
}

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn rust_files_under(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(directory).expect("backend directory must be readable") {
            let path = entry
                .expect("backend directory entry must be readable")
                .path();
            if path.is_dir() {
                pending.push(path);
            } else if path.extension().and_then(|extension| extension.to_str()) == Some("rs") {
                files.push(path);
            }
        }
    }
    files
}

fn relative(path: &Path) -> String {
    path.strip_prefix(manifest_dir())
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}
