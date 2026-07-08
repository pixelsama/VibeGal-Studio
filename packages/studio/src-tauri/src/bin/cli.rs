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
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

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
    /// 导出项目为可运行游戏包
    Build {
        /// 项目根目录路径
        path: String,
        /// 导出目标。V1 仅支持 web。
        #[arg(long, value_enum)]
        target: BuildTarget,
        /// 输出目录
        #[arg(long = "out")]
        out_dir: PathBuf,
        /// 指定要导出的 renderer id。默认使用 gal.project.json activeRendererId。
        #[arg(long)]
        renderer: Option<String>,
        /// strict 模式下 warning 也会让 build 失败。
        #[arg(long)]
        strict: bool,
        /// 允许 warning，即使 strict 被同时传入也以允许 warning 为准。
        #[arg(long)]
        allow_warnings: bool,
        /// Web 包资源 base path，默认 ./。
        #[arg(long, default_value = "./")]
        base_path: String,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
enum BuildTarget {
    Web,
}

impl BuildTarget {
    fn as_str(self) -> &'static str {
        match self {
            BuildTarget::Web => "web",
        }
    }
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

#[derive(Debug)]
struct BuildOptions {
    project_path: String,
    target: BuildTarget,
    out_dir: PathBuf,
    renderer_id: Option<String>,
    strict: bool,
    allow_warnings: bool,
    base_path: String,
}

#[derive(Serialize, Debug)]
struct BuildOutput {
    ok: bool,
    target: String,
    #[serde(rename = "outDir")]
    out_dir: String,
    #[serde(rename = "rendererId")]
    renderer_id: String,
    warnings: Vec<app_lib::ProjectIssue>,
}

#[derive(Serialize, Debug)]
struct BuildError {
    ok: bool,
    code: String,
    message: String,
    step: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    file: Option<String>,
    #[serde(rename = "rendererId", skip_serializing_if = "Option::is_none")]
    renderer_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    column: Option<u32>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    issues: Vec<app_lib::ProjectIssue>,
}

#[derive(Deserialize, Debug)]
struct WorkerBuildError {
    code: String,
    message: String,
    step: String,
    file: Option<String>,
    #[serde(rename = "rendererId")]
    renderer_id: Option<String>,
    line: Option<u32>,
    column: Option<u32>,
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

fn build_error(
    code: &str,
    message: impl Into<String>,
    step: &str,
    file: Option<String>,
    renderer_id: Option<String>,
    issues: Vec<app_lib::ProjectIssue>,
) -> BuildError {
    BuildError {
        ok: false,
        code: code.to_string(),
        message: message.into(),
        step: step.to_string(),
        file,
        renderer_id,
        line: None,
        column: None,
        issues,
    }
}

fn project_issue_is_error(issue: &app_lib::ProjectIssue) -> bool {
    issue.severity == app_lib::GraphIssueSeverity::Error
}

fn validation_issues(project: &app_lib::ProjectData) -> Vec<app_lib::ProjectIssue> {
    project
        .project_report
        .as_ref()
        .map(|report| report.project_issues.clone())
        .unwrap_or_default()
}

fn ensure_export_out_dir_safe(project_root: &Path, out_dir: &Path) -> Result<(), BuildError> {
    let project_root = project_root.canonicalize().map_err(|e| {
        build_error(
            "build_path_error",
            format!("无法定位项目目录 {}: {}", project_root.display(), e),
            "prepare",
            None,
            None,
            vec![],
        )
    })?;
    let out_abs = if out_dir.exists() {
        out_dir.canonicalize().map_err(|e| {
            build_error(
                "build_path_error",
                format!("无法定位输出目录 {}: {}", out_dir.display(), e),
                "prepare",
                None,
                None,
                vec![],
            )
        })?
    } else {
        let parent = out_dir.parent().unwrap_or_else(|| Path::new("."));
        let parent = parent.canonicalize().map_err(|e| {
            build_error(
                "build_path_error",
                format!("无法定位输出目录父目录 {}: {}", parent.display(), e),
                "prepare",
                None,
                None,
                vec![],
            )
        })?;
        parent.join(out_dir.file_name().unwrap_or_default())
    };

    if out_abs == project_root {
        return Err(build_error(
            "build_path_error",
            "输出目录不能是项目根目录",
            "prepare",
            None,
            None,
            vec![],
        ));
    }
    Ok(())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("创建目录失败 {}: {}", dst.display(), e))?;
    for entry in fs::read_dir(src).map_err(|e| format!("读取目录失败 {}: {}", src.display(), e))? {
        let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else if from.is_file() {
            if let Some(parent) = to.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("创建目录失败 {}: {}", parent.display(), e))?;
            }
            fs::copy(&from, &to).map_err(|e| {
                format!(
                    "复制文件失败 ({} -> {}): {}",
                    from.display(),
                    to.display(),
                    e
                )
            })?;
        }
    }
    Ok(())
}

fn write_json_file(path: &Path, value: &serde_json::Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败 {}: {}", parent.display(), e))?;
    }
    let text = serde_json::to_string_pretty(value).map_err(|e| format!("序列化 JSON 失败: {}", e))?;
    fs::write(path, text).map_err(|e| format!("写文件失败 {}: {}", path.display(), e))
}

fn write_text_file(path: &Path, text: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败 {}: {}", parent.display(), e))?;
    }
    fs::write(path, text).map_err(|e| format!("写文件失败 {}: {}", path.display(), e))
}

fn build_worker_path() -> PathBuf {
    if let Ok(path) = std::env::var("GALSTUDIO_EXPORT_WORKER") {
        return PathBuf::from(path);
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scripts/build-web-export.mjs")
}

fn node_executable() -> String {
    std::env::var("GALSTUDIO_NODE").unwrap_or_else(|_| "node".to_string())
}

fn parse_worker_error(stderr: &str, renderer_id: &str) -> Option<BuildError> {
    let start = stderr.find('{')?;
    let json = &stderr[start..];
    let worker: WorkerBuildError = serde_json::from_str(json).ok()?;
    Some(BuildError {
        ok: false,
        code: worker.code,
        message: worker.message,
        step: worker.step,
        file: worker.file,
        renderer_id: worker.renderer_id.or_else(|| Some(renderer_id.to_string())),
        line: worker.line,
        column: worker.column,
        issues: vec![],
    })
}

fn run_build_worker(options: &BuildOptions, renderer_id: &str) -> Result<(), BuildError> {
    let worker = build_worker_path();
    let output = Command::new(node_executable())
        .arg(worker)
        .arg("--project")
        .arg(&options.project_path)
        .arg("--out")
        .arg(&options.out_dir)
        .arg("--renderer")
        .arg(renderer_id)
        .arg("--base-path")
        .arg(&options.base_path)
        .output()
        .map_err(|e| {
            build_error(
                "build_worker_failed",
                format!("无法启动 Web build worker: {}", e),
                "worker",
                None,
                Some(renderer_id.to_string()),
                vec![],
            )
        })?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    if let Some(error) = parse_worker_error(&stderr, renderer_id) {
        return Err(error);
    }
    Err(build_error(
        "build_worker_failed",
        stderr.trim().to_string(),
        "worker",
        None,
        Some(renderer_id.to_string()),
        vec![],
    ))
}

fn built_at_iso() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    format!("unix:{secs}")
}

fn build_web_project(options: BuildOptions) -> Result<BuildOutput, BuildError> {
    let project = app_lib::open_project_for_cli(&options.project_path).map_err(|message| {
        build_error(
            "open_project_failed",
            message,
            "validate",
            None,
            None,
            vec![],
        )
    })?;
    let issues = validation_issues(&project);
    let errors: Vec<_> = issues.iter().filter(|issue| project_issue_is_error(issue)).collect();
    if let Some(first) = errors.first() {
        return Err(build_error(
            "project_validation_failed",
            "项目校验存在 error，build 已停止",
            "validate",
            first.file.clone(),
            None,
            issues,
        ));
    }
    if options.strict && !options.allow_warnings && !issues.is_empty() {
        let first = &issues[0];
        return Err(build_error(
            "project_validation_warnings",
            "strict 模式下项目 warning 会阻止 build",
            "validate",
            first.file.clone(),
            None,
            issues,
        ));
    }

    let renderer_id = options
        .renderer_id
        .clone()
        .unwrap_or_else(|| project.meta.active_renderer_id.clone());
    if !project.renderer_ids.iter().any(|id| id == &renderer_id) {
        return Err(build_error(
            "renderer_not_found",
            format!("渲染层不存在或缺少 index.tsx: {renderer_id}"),
            "renderer",
            Some(format!("renderers/{renderer_id}/index.tsx")),
            Some(renderer_id),
            vec![],
        ));
    }

    let project_root = PathBuf::from(&project.path);
    ensure_export_out_dir_safe(&project_root, &options.out_dir)?;
    if options.out_dir.exists() {
        fs::remove_dir_all(&options.out_dir).map_err(|e| {
            build_error(
                "prepare_out_dir_failed",
                format!("清理输出目录失败 {}: {}", options.out_dir.display(), e),
                "prepare",
                None,
                Some(renderer_id.clone()),
                vec![],
            )
        })?;
    }
    fs::create_dir_all(options.out_dir.join("runtime")).map_err(|e| {
        build_error(
            "prepare_out_dir_failed",
            format!("创建输出目录失败 {}: {}", options.out_dir.display(), e),
            "prepare",
            None,
            Some(renderer_id.clone()),
            vec![],
        )
    })?;
    fs::create_dir_all(options.out_dir.join("renderer")).map_err(|e| {
        build_error(
            "prepare_out_dir_failed",
            format!("创建 renderer 输出目录失败: {}", e),
            "prepare",
            None,
            Some(renderer_id.clone()),
            vec![],
        )
    })?;

    copy_dir_recursive(&project_root.join("content"), &options.out_dir.join("content")).map_err(|message| {
        build_error(
            "copy_content_failed",
            message,
            "content",
            Some("content".to_string()),
            Some(renderer_id.clone()),
            vec![],
        )
    })?;

    let title = project
        .content
        .meta
        .get("title")
        .and_then(|value| value.as_str())
        .unwrap_or(&project.meta.name);
    let game_manifest = serde_json::json!({
        "projectId": project.meta.name,
        "title": title,
        "rendererId": renderer_id.clone(),
        "contractVersion": 1,
        "buildTarget": options.target.as_str(),
        "basePath": options.base_path.clone(),
        "builtAt": built_at_iso(),
        "galstudioBuildSchemaVersion": 1,
    });
    write_json_file(&options.out_dir.join("game.manifest.json"), &game_manifest).map_err(|message| {
        build_error(
            "write_manifest_failed",
            message,
            "manifest",
            Some("game.manifest.json".to_string()),
            Some(renderer_id.clone()),
            vec![],
        )
    })?;
    write_text_file(
        &options.out_dir.join("index.html"),
        r#"<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>GalStudio Export</title>
    <style>
      html, body, #root { width: 100%; height: 100%; margin: 0; background: #000; }
      body { overflow: hidden; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./runtime/bundle.js"></script>
  </body>
</html>
"#,
    )
    .map_err(|message| {
        build_error(
            "write_index_failed",
            message,
            "host",
            Some("index.html".to_string()),
            Some(renderer_id.clone()),
            vec![],
        )
    })?;

    run_build_worker(&options, &renderer_id)?;

    Ok(BuildOutput {
        ok: true,
        target: options.target.as_str().to_string(),
        out_dir: options.out_dir.to_string_lossy().to_string(),
        renderer_id,
        warnings: issues,
    })
}

fn print_build_json<T: Serialize>(output: &T) {
    println!("{}", serde_json::to_string_pretty(output).unwrap());
}

fn print_build_error_text(error: &BuildError) {
    eprintln!("[{}] {} (step={})", error.code, error.message, error.step);
    if let Some(renderer_id) = &error.renderer_id {
        eprintln!("renderer: {renderer_id}");
    }
    if let Some(file) = &error.file {
        if let (Some(line), Some(column)) = (error.line, error.column) {
            eprintln!("file: {file}:{line}:{column}");
        } else {
            eprintln!("file: {file}");
        }
    }
    for issue in &error.issues {
        eprintln!("[{:?}] {} (code={})", issue.severity, issue.message, issue.code);
    }
}

fn run_build(options: BuildOptions, format: OutputFormat) -> i32 {
    match build_web_project(options) {
        Ok(output) => {
            match format {
                OutputFormat::Json => print_build_json(&output),
                OutputFormat::Text => println!(
                    "✓ Web build 完成: {} (renderer={})",
                    output.out_dir, output.renderer_id
                ),
            }
            0
        }
        Err(error) => {
            match format {
                OutputFormat::Json => print_build_json(&error),
                OutputFormat::Text => print_build_error_text(&error),
            }
            if error.code == "open_project_failed" {
                70
            } else {
                1
            }
        }
    }
}

fn main() {
    let cli = Cli::parse();
    let code = match cli.command {
        Commands::Validate { path, format } => run_validate(&path, format),
        Commands::Build {
            path,
            target,
            out_dir,
            renderer,
            strict,
            allow_warnings,
            base_path,
            format,
        } => run_build(
            BuildOptions {
                project_path: path,
                target,
                out_dir,
                renderer_id: renderer,
                strict,
                allow_warnings,
                base_path,
            },
            format,
        ),
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

    fn make_exportable_project(root: &std::path::Path) {
        make_project(
            root,
            Some(
                r#"{"version":1,"entryNodeId":"start","nodes":[{"id":"start","title":"Start","file":"nodes/start.json","position":{"x":0,"y":0}},{"id":"end","title":"End","file":"nodes/end.json","position":{"x":200,"y":0}}],"edges":[{"id":"start__end","from":"start","to":"end","mode":"linear","label":null,"condition":null}]}"#,
            ),
        );
        write_text(&root.join("content/nodes/start.json"), r#"[{"t":"narrate","text":"start"}]"#);
        write_text(&root.join("content/nodes/end.json"), r#"[{"t":"narrate","text":"end"}]"#);
        write_text(
            &root.join("renderers/default/index.tsx"),
            r#"export default { id: "default", name: "Default", Component: () => null };"#,
        );
        write_text(
            &root.join("renderers/alt/index.tsx"),
            r#"export default { id: "alt", name: "Alt Selected Renderer", Component: () => null };"#,
        );
    }

    fn build_options(project: &std::path::Path, out_dir: &std::path::Path) -> BuildOptions {
        BuildOptions {
            project_path: project.to_string_lossy().to_string(),
            target: BuildTarget::Web,
            out_dir: out_dir.to_path_buf(),
            renderer_id: None,
            strict: false,
            allow_warnings: false,
            base_path: "./".to_string(),
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
    fn build_web_fails_when_project_validation_has_errors() {
        let dir = std::env::temp_dir().join(format!(
            "galstudio-cli-build-invalid-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let out_dir = dir.join("dist-game");
        make_project(
            &dir,
            Some(
                r#"{"version":1,"entryNodeId":"ghost","nodes":[{"id":"start","title":"Start","file":"nodes/start.json","position":{"x":0,"y":0}}],"edges":[]}"#,
            ),
        );
        write_text(&dir.join("content/nodes/start.json"), "[]");
        write_text(
            &dir.join("renderers/default/index.tsx"),
            r#"export default { id: "default", name: "Default", Component: () => null };"#,
        );

        let err = build_web_project(build_options(&dir, &out_dir)).expect_err("validation error should fail build");

        assert_eq!(err.code, "project_validation_failed");
        assert_eq!(err.step, "validate");
        assert_eq!(err.file.as_deref(), Some("content/graph.json"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn build_web_uses_selected_renderer_and_copies_content_files() {
        let dir = std::env::temp_dir().join(format!(
            "galstudio-cli-build-selected-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let out_dir = dir.join("dist-game");
        make_exportable_project(&dir);
        let mut options = build_options(&dir, &out_dir);
        options.renderer_id = Some("alt".to_string());
        options.base_path = "/games/test/".to_string();

        let output = build_web_project(options).expect("build should succeed");

        assert!(output.ok);
        assert_eq!(output.renderer_id, "alt");
        assert!(out_dir.join("index.html").is_file());
        assert!(out_dir.join("content/graph.json").is_file());
        assert!(out_dir.join("content/manifest.json").is_file());
        assert!(out_dir.join("content/meta.json").is_file());
        assert!(out_dir.join("content/nodes/start.json").is_file());
        assert!(out_dir.join("runtime/bundle.js").is_file());

        let manifest: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(out_dir.join("game.manifest.json")).unwrap()).unwrap();
        assert_eq!(manifest["rendererId"], "alt");
        assert_eq!(manifest["basePath"], "/games/test/");
        assert_eq!(manifest["buildTarget"], "web");
        let bundle = std::fs::read_to_string(out_dir.join("runtime/bundle.js")).unwrap();
        assert!(bundle.contains("Alt Selected Renderer"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn build_web_reports_renderer_compile_error() {
        let dir = std::env::temp_dir().join(format!(
            "galstudio-cli-build-renderer-error-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let out_dir = dir.join("dist-game");
        make_exportable_project(&dir);
        write_text(
            &dir.join("renderers/alt/index.tsx"),
            "import debounce from \"lodash\";\nexport default { id: \"alt\", name: \"Alt\", Component: () => debounce(null) };",
        );
        let mut options = build_options(&dir, &out_dir);
        options.renderer_id = Some("alt".to_string());

        let err = build_web_project(options).expect_err("unsupported renderer import should fail build");

        assert_eq!(err.code, "renderer_unsupported_import");
        assert_eq!(err.step, "renderer");
        assert_eq!(err.renderer_id.as_deref(), Some("alt"));
        assert_eq!(err.file.as_deref(), Some("renderers/alt/index.tsx"));
        assert_eq!(err.line, Some(1));
        assert_eq!(err.column, Some(22));
        let _ = std::fs::remove_dir_all(&dir);
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
