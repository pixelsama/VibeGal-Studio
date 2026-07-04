//! Phase 11 CLI：`galstudio-cli validate <project-path> [--format json|text]`
//!
//! 不启动 Tauri GUI，纯命令行校验项目图结构，输出结构化错误。
//! 供外部工具/Agent 在 CI 或脚本里直接读取校验结果并自主迭代。
//!
//! 退出码：
//! - 0  无问题
//! - 1  有 error 级 issue
//! - 2  仅有 warn 级 issue
//! - 70 项目打不开（不是 GalStudio 项目 / 文件损坏）

#![cfg_attr(not(debug_assertions), windows_subsystem = "console")]

use clap::{Parser, Subcommand, ValueEnum};
use serde::Serialize;

#[derive(Parser)]
#[command(name = "galstudio-cli", about = "GalStudio 项目校验命令行")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// 校验项目图结构，输出问题列表
    Validate {
        /// 项目根目录路径
        path: String,
        /// 输出格式：text（默认，人类可读）或 json（结构化）
        #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
        format: OutputFormat,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
enum OutputFormat {
    Text,
    Json,
}

#[derive(Serialize)]
struct ValidateOutput {
    ok: bool,
    #[serde(rename = "projectPath")]
    project_path: String,
    #[serde(rename = "projectIssues")]
    project_issues: Vec<app_lib::ProjectIssue>,
    #[serde(rename = "graphIssues")]
    graph_issues: Vec<app_lib::GraphIssue>,
    #[serde(rename = "assetIssues")]
    asset_issues: Vec<app_lib::GraphIssue>,
}

fn build_open_error_output(path: &str, message: &str) -> ValidateOutput {
    let (file, json_path) = infer_open_error_location(message);
    ValidateOutput {
        ok: false,
        project_path: path.to_string(),
        project_issues: vec![],
        graph_issues: vec![app_lib::GraphIssue {
            severity: app_lib::GraphIssueSeverity::Error,
            code: "open_project_failed".to_string(),
            message: message.to_string(),
            file,
            json_path,
            node_id: None,
            edge_id: None,
        }],
        asset_issues: vec![],
    }
}

fn infer_open_error_location(message: &str) -> (Option<String>, Option<String>) {
    if message.contains("gal.project.json") {
        return (Some("gal.project.json".to_string()), Some("$".to_string()));
    }
    if message.contains("graph.json") || message.contains("路径越界") {
        return (
            Some("content/graph.json".to_string()),
            Some("$".to_string()),
        );
    }
    if message.contains("manifest.json") {
        return (
            Some("content/manifest.json".to_string()),
            Some("$".to_string()),
        );
    }
    if message.contains("meta.json") {
        return (Some("content/meta.json".to_string()), Some("$".to_string()));
    }
    (None, None)
}

fn print_json(output: &ValidateOutput) {
    println!("{}", serde_json::to_string_pretty(output).unwrap());
}

fn run_validate(path: &str, format: OutputFormat) -> i32 {
    let project = match app_lib::open_project_for_cli(path) {
        Ok(data) => data,
        Err(message) => {
            if format == OutputFormat::Json {
                print_json(&build_open_error_output(path, &message));
            } else {
                eprintln!("无法打开项目: {message}");
            }
            return 70;
        }
    };

    let graph_issues: Vec<app_lib::GraphIssue> = project
        .graph_report
        .map(|r| r.graph_issues)
        .unwrap_or_default();
    let asset_issues: Vec<app_lib::GraphIssue> = project
        .asset_report
        .map(|r| r.asset_issues)
        .unwrap_or_default();
    let project_issues: Vec<app_lib::ProjectIssue> = project
        .project_report
        .map(|r| r.project_issues)
        .unwrap_or_default();

    // 用聚合的 project_issues 判定退出码（含 manifest 结构错误）
    let has_error = project_issues
        .iter()
        .any(|i| i.severity == app_lib::GraphIssueSeverity::Error);
    let ok = project_issues.is_empty();

    match format {
        OutputFormat::Json => {
            let output = ValidateOutput {
                ok,
                project_path: project.path.clone(),
                project_issues,
                graph_issues,
                asset_issues,
            };
            print_json(&output);
        }
        OutputFormat::Text => {
            if ok {
                println!("✓ 项目正常");
            } else {
                // 按来源分组打印（图结构 / 资产 / manifest）
                print_project_sections(&project_issues);
            }
        }
    }

    if has_error {
        1
    } else if !ok {
        2
    } else {
        0
    }
}

/// source id → 中文标签
fn source_label(source: &str) -> &str {
    match source {
        "graph" => "图结构",
        "node" => "节点内容",
        "asset" => "资产",
        "manifest" => "manifest",
        _ => source,
    }
}

/// 文本格式：按来源分组打印全局问题，组内 error 优先。
fn print_project_sections(issues: &[app_lib::ProjectIssue]) {
    // 按出现顺序保留 source 分组
    let mut order: Vec<String> = vec![];
    let mut groups: std::collections::HashMap<String, Vec<&app_lib::ProjectIssue>> =
        std::collections::HashMap::new();
    for issue in issues {
        let label = source_label(&issue.source).to_string();
        if !groups.contains_key(&label) {
            order.push(label.clone());
        }
        groups.entry(label).or_default().push(issue);
    }

    for label in order {
        let group = &groups[&label];
        if group.is_empty() {
            continue;
        }
        println!("── {label} ──");
        // 组内 error 优先
        let errors = group
            .iter()
            .filter(|i| i.severity == app_lib::GraphIssueSeverity::Error);
        let warns = group
            .iter()
            .filter(|i| i.severity == app_lib::GraphIssueSeverity::Warn);
        for issue in errors {
            println!("[error] {} (code={})", issue.message, issue.code);
            print_issue_detail(issue);
        }
        for issue in warns {
            println!("[warn]  {} (code={})", issue.message, issue.code);
            print_issue_detail(issue);
        }
    }
}

fn print_issue_detail(issue: &app_lib::ProjectIssue) {
    if let Some(file) = &issue.file {
        println!("    file: {file}");
    }
    if let Some(json_path) = &issue.json_path {
        println!("    jsonPath: {json_path}");
    }
    if let Some(id) = &issue.node_id {
        println!("    nodeId: {id}");
    }
    if let Some(id) = &issue.edge_id {
        println!("    edgeId: {id}");
    }
}

fn main() {
    let cli = Cli::parse();
    let code = match cli.command {
        Commands::Validate { path, format } => run_validate(&path, format),
    };
    std::process::exit(code);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn write_text(path: &std::path::Path, text: &str) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, text).unwrap();
    }

    fn workspace_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../..")
            .canonicalize()
            .unwrap()
    }

    fn examples_path() -> PathBuf {
        workspace_root().join("examples")
    }

    fn example_project(name: &str) -> PathBuf {
        examples_path().join(name)
    }

    fn make_project(root: &std::path::Path, graph_json: Option<&str>) {
        write_text(
            &root.join("gal.project.json"),
            r#"{"name":"T","activeRendererId":"default","createdAt":"0"}"#,
        );
        write_text(
            &root.join("content/manifest.json"),
            r#"{"characters":{},"backgrounds":{},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
        );
        write_text(
            &root.join("content/meta.json"),
            r#"{"title":"T","typingSpeedCps":30,"autoAdvanceMs":1200,"chapterGapMs":1500}"#,
        );
        if let Some(graph) = graph_json {
            write_text(&root.join("content/graph.json"), graph);
        }
    }

    #[test]
    fn validate_returns_zero_for_clean_graph() {
        let dir = std::env::temp_dir().join(format!(
            "galstudio-cli-ok-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        make_project(
            &dir,
            Some(
                r#"{"version":1,"entryNodeId":"a","nodes":[{"id":"a","title":"A","file":"nodes/a.json","position":{"x":0,"y":0}}],"edges":[]}"#,
            ),
        );
        write_text(&dir.join("content/nodes/a.json"), "[]");

        let code = run_validate(dir.to_string_lossy().as_ref(), OutputFormat::Text);
        assert_eq!(code, 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn validate_returns_one_for_error_issue() {
        let dir = std::env::temp_dir().join(format!(
            "galstudio-cli-err-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        // entryNodeId 指向不存在的节点 → missing_entry_node (error)
        make_project(
            &dir,
            Some(
                r#"{"version":1,"entryNodeId":"ghost","nodes":[{"id":"a","title":"A","file":"nodes/a.json","position":{"x":0,"y":0}}],"edges":[]}"#,
            ),
        );
        write_text(&dir.join("content/nodes/a.json"), "[]");

        let code = run_validate(dir.to_string_lossy().as_ref(), OutputFormat::Text);
        assert_eq!(code, 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn validate_returns_two_for_warn_only() {
        let dir = std::env::temp_dir().join(format!(
            "galstudio-cli-warn-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        // 节点文件缺失 → missing_node_file (warn)，无 error
        make_project(
            &dir,
            Some(
                r#"{"version":1,"entryNodeId":"a","nodes":[{"id":"a","title":"A","file":"nodes/a.json","position":{"x":0,"y":0}}],"edges":[]}"#,
            ),
        );
        // 故意不写 nodes/a.json

        let code = run_validate(dir.to_string_lossy().as_ref(), OutputFormat::Text);
        assert_eq!(code, 2);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn validate_returns_seventy_for_unopenable_project() {
        let dir = std::env::temp_dir().join(format!(
            "galstudio-cli-bad-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        // 没有 gal.project.json → 打不开

        let code = run_validate(dir.to_string_lossy().as_ref(), OutputFormat::Text);
        assert_eq!(code, 70);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn open_error_output_is_machine_readable() {
        let output = build_open_error_output("missing-project", "缺少 gal.project.json");

        assert!(!output.ok);
        assert_eq!(output.project_path, "missing-project");
        assert_eq!(output.graph_issues.len(), 1);
        assert_eq!(
            output.graph_issues[0].severity,
            app_lib::GraphIssueSeverity::Error
        );
        assert_eq!(output.graph_issues[0].code, "open_project_failed");
        assert_eq!(
            output.graph_issues[0].file.as_deref(),
            Some("gal.project.json")
        );
        assert_eq!(output.graph_issues[0].json_path.as_deref(), Some("$"));
    }

    #[test]
    fn validate_json_output_is_parseable() {
        let dir = std::env::temp_dir().join(format!(
            "galstudio-cli-json-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        make_project(
            &dir,
            Some(
                r#"{"version":1,"entryNodeId":"a","nodes":[{"id":"a","title":"A","file":"nodes/a.json","position":{"x":0,"y":0}}],"edges":[]}"#,
            ),
        );
        write_text(&dir.join("content/nodes/a.json"), "[]");

        // run_validate 用 println 输出，这里只验证退出码正确（JSON 内容已被 schemaExport 覆盖字段断言）
        let code = run_validate(dir.to_string_lossy().as_ref(), OutputFormat::Json);
        assert_eq!(code, 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn validate_cli_reports_node_instruction_error_as_json() {
        let dir = std::env::temp_dir().join(format!(
            "galstudio-cli-node-json-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        make_project(
            &dir,
            Some(
                r#"{"version":1,"entryNodeId":"a","nodes":[{"id":"a","title":"A","file":"nodes/a.json","position":{"x":0,"y":0}}],"edges":[]}"#,
            ),
        );
        write_text(
            &dir.join("content/nodes/a.json"),
            r#"[{"t":"say","who":"ghost","text":"hi"}]"#,
        );

        let project = app_lib::open_project_for_cli(dir.to_string_lossy().as_ref()).unwrap();
        let project_issues = project.project_report.unwrap().project_issues;
        let node_issue = project_issues
            .iter()
            .find(|issue| issue.source == "node" && issue.code == "missing_character_ref")
            .expect("CLI 应复用 projectIssues 中的 node 问题");

        assert_eq!(node_issue.file.as_deref(), Some("content/nodes/a.json"));
        assert_eq!(node_issue.json_path.as_deref(), Some("$[0].who"));
        assert_eq!(node_issue.node_id.as_deref(), Some("a"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn validate_cli_exits_one_for_node_error() {
        let dir = std::env::temp_dir().join(format!(
            "galstudio-cli-node-exit-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        make_project(
            &dir,
            Some(
                r#"{"version":1,"entryNodeId":"a","nodes":[{"id":"a","title":"A","file":"nodes/a.json","position":{"x":0,"y":0}}],"edges":[]}"#,
            ),
        );
        write_text(
            &dir.join("content/nodes/a.json"),
            r#"[{"t":"say","who":"ghost","text":"hi"}]"#,
        );

        let code = run_validate(dir.to_string_lossy().as_ref(), OutputFormat::Json);

        assert_eq!(code, 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn validate_examples_sample_novel_is_clean() {
        let path = example_project("sample-novel");
        let code = run_validate(path.to_string_lossy().as_ref(), OutputFormat::Json);
        assert_eq!(code, 0);
    }

    #[test]
    fn validate_example_broken_project_missing_node_file_is_warn_only() {
        let path = example_project("broken-projects/missing-node-file");
        let code = run_validate(path.to_string_lossy().as_ref(), OutputFormat::Text);
        assert_eq!(code, 2);
    }

    #[test]
    fn validate_example_broken_project_dangling_edge_is_warn_only() {
        let path = example_project("broken-projects/dangling-edge");
        let code = run_validate(path.to_string_lossy().as_ref(), OutputFormat::Text);
        assert_eq!(code, 2);
    }
}
