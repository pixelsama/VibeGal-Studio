//! Phase 11 CLI：`vibegal-cli validate <project-path> [--format json|text]`
//!
//! 不启动 Tauri GUI，纯命令行校验项目图结构，输出结构化错误。
//! 供外部工具/Agent 在 CI 或脚本里直接读取校验结果并自主迭代。
//!
//! 退出码：
//! - 0  无问题
//! - 1  有 error 级 issue
//! - 2  仅有 warn 级 issue
//! - 70 项目打不开（不是 VibeGal-Studio 项目 / 文件损坏）

#![cfg_attr(not(debug_assertions), windows_subsystem = "console")]

use clap::{Parser, Subcommand, ValueEnum};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Parser)]
#[command(name = "vibegal-cli", about = "VibeGal-Studio 项目构建与校验命令行")]
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
        /// 导出目标：web 或 desktop。
        #[arg(long, value_enum)]
        target: BuildTarget,
        /// 桌面运行壳：electron（兼容模式，默认）或 tauri（轻量模式）。
        #[arg(long, value_enum)]
        runtime: Option<DesktopRuntime>,
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
        /// 逐行输出构建进度；仅支持 jsonl，且必须与 --format json 同用。
        #[arg(long, value_enum)]
        progress: Option<ProgressOutput>,
    },
    /// 检查 renderer contract 与编译约束
    RendererCheck {
        /// 项目根目录路径
        path: String,
        /// 指定要检查的 renderer id。默认使用 gal.project.json activeRendererId。
        #[arg(long)]
        renderer: Option<String>,
        /// 跳过 node worker 的真实编译与类型检查，仅做静态契约检查。
        #[arg(long = "no-compile")]
        no_compile: bool,
        /// 输出格式：text（默认，人类可读）或 json（结构化）
        #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
        format: OutputFormat,
    },
    /// 无头挂载渲染层到内置场景并截图（供外部 Agent 查看渲染效果）
    RendererSnapshot {
        /// 项目根目录路径
        path: String,
        /// 指定要截图的 renderer id。默认使用 gal.project.json activeRendererId。
        #[arg(long)]
        renderer: Option<String>,
        /// 截图输出目录（PNG 与 .vibegal-snapshot 调试产物）
        #[arg(long = "out")]
        out_dir: PathBuf,
        /// 输出格式：text（默认，人类可读）或 json（结构化）
        #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
        format: OutputFormat,
    },
    /// 对导出目录执行发行 smoke 检查
    Smoke {
        /// 导出目录路径
        dist_dir: PathBuf,
        /// smoke 目标：web 或 desktop。
        #[arg(long, value_enum)]
        target: BuildTarget,
        /// 桌面运行壳；desktop 默认 electron。
        #[arg(long, value_enum)]
        runtime: Option<DesktopRuntime>,
        /// 输出格式：text（默认，人类可读）或 json（结构化）
        #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
        format: OutputFormat,
    },
    /// 检查桌面游戏构建环境；缺失项通过字段报告，命令始终返回 0。
    Doctor {
        /// 输出格式：text（默认，人类可读）或 json（结构化）
        #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
        format: OutputFormat,
    },
    /// Assign stable IDs to story points that do not have one yet.
    InstructionIds {
        #[command(subcommand)]
        command: InstructionIdsCommand,
    },
    /// Safely edit a node by addressing story points through stable IDs.
    Node {
        #[command(subcommand)]
        command: NodeCommand,
    },
}

#[derive(Subcommand, Debug)]
enum InstructionIdsCommand {
    /// Assign IDs to missing story points in graph-referenced node files.
    Assign {
        /// Project root containing gal.project.json.
        project_path: String,
        /// Limit assignment to one graph node ID.
        #[arg(long)]
        node: Option<String>,
        /// Report changes without writing node files.
        #[arg(long)]
        dry_run: bool,
        /// Output format for humans or automation.
        #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
        format: OutputFormat,
    },
}

#[derive(Subcommand, Debug)]
enum NodeCommand {
    /// Insert one instruction immediately after a uniquely identified story point.
    Insert {
        project_path: String,
        node_id: String,
        #[arg(long)]
        after: String,
        /// JSON file containing one instruction object.
        #[arg(long = "file")]
        instruction_file: PathBuf,
        #[arg(long)]
        dry_run: bool,
        #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
        format: OutputFormat,
    },
    /// Apply a JSON Merge Patch while preserving the target's `id` and `t` fields.
    Update {
        project_path: String,
        node_id: String,
        story_point_id: String,
        #[arg(long)]
        patch_file: PathBuf,
        #[arg(long)]
        dry_run: bool,
        #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
        format: OutputFormat,
    },
    /// Move exactly one instruction immediately before another story point.
    Move {
        project_path: String,
        node_id: String,
        story_point_id: String,
        #[arg(long)]
        before: String,
        #[arg(long)]
        dry_run: bool,
        #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
        format: OutputFormat,
    },
    /// Duplicate one instruction immediately after itself and assign a new ID.
    Duplicate {
        project_path: String,
        node_id: String,
        story_point_id: String,
        #[arg(long)]
        dry_run: bool,
        #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
        format: OutputFormat,
    },
    /// Delete exactly one uniquely identified story point.
    Delete {
        project_path: String,
        node_id: String,
        story_point_id: String,
        #[arg(long)]
        dry_run: bool,
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
enum ProgressOutput {
    Jsonl,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
enum BuildTarget {
    Web,
    Desktop,
}

impl BuildTarget {
    fn as_str(self) -> &'static str {
        match self {
            BuildTarget::Web => "web",
            BuildTarget::Desktop => "desktop",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum DesktopRuntime {
    Electron,
    Tauri,
}

impl DesktopRuntime {
    fn as_str(self) -> &'static str {
        match self {
            Self::Electron => "electron",
            Self::Tauri => "tauri",
        }
    }

    fn mode(self) -> &'static str {
        match self {
            Self::Electron => "compatible",
            Self::Tauri => "lightweight",
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

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct InstructionIdChangedFile {
    file: String,
    assigned: Vec<app_lib::AssignedInstructionId>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct InstructionIdAssignOutput {
    ok: bool,
    project_path: String,
    dry_run: bool,
    assigned_count: usize,
    changed_files: Vec<InstructionIdChangedFile>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NodeMutationOutput {
    ok: bool,
    operation: String,
    project_path: String,
    node_id: String,
    file: String,
    dry_run: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    story_point_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    new_story_point_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    before_index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    after_index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    new_revision: Option<serde_json::Value>,
    assigned: Vec<app_lib::AssignedInstructionId>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CliOperationError {
    ok: bool,
    code: String,
    message: String,
    step: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    file: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    modified_files: Vec<String>,
    #[serde(skip)]
    exit_code: i32,
}

impl CliOperationError {
    fn new(code: &str, message: impl Into<String>, step: &str) -> Self {
        Self {
            ok: false,
            code: code.to_string(),
            message: message.into(),
            step: step.to_string(),
            file: None,
            modified_files: vec![],
            exit_code: 1,
        }
    }

    fn open(message: impl Into<String>) -> Self {
        let mut error = Self::new("open_project_failed", message, "open-project");
        error.exit_code = 70;
        error
    }

    fn file(mut self, file: impl Into<String>) -> Self {
        self.file = Some(file.into());
        self
    }
}

#[derive(Clone, Debug)]
struct PlannedNodeAssignment {
    node_file: String,
    revision: serde_json::Value,
    assignment: app_lib::InstructionIdentityAssignment,
}

#[derive(Clone, Debug)]
struct LoadedCliNode {
    project_path: String,
    node_id: String,
    node_file: String,
    revision: serde_json::Value,
    instructions: serde_json::Value,
}

#[derive(Clone, Debug)]
enum NodeMutation {
    Insert {
        after: String,
        instruction: serde_json::Value,
    },
    Update {
        story_point_id: String,
        patch: serde_json::Value,
    },
    Move {
        story_point_id: String,
        before: String,
    },
    Duplicate {
        story_point_id: String,
    },
    Delete {
        story_point_id: String,
    },
}

#[derive(Clone, Debug)]
struct MutatedNode {
    instructions: serde_json::Value,
    story_point_id: Option<String>,
    before_index: Option<usize>,
    after_index: Option<usize>,
}

#[derive(Clone, Debug)]
struct BuildOptions {
    project_path: String,
    target: BuildTarget,
    desktop_runtime: Option<DesktopRuntime>,
    out_dir: PathBuf,
    renderer_id: Option<String>,
    strict: bool,
    allow_warnings: bool,
    base_path: String,
    progress: Option<ProgressOutput>,
}

#[derive(Debug)]
struct RendererCheckOptions {
    project_path: String,
    renderer_id: Option<String>,
    /// true 时在静态契约检查通过后，经 node worker 做真实编译与类型检查。
    compile: bool,
}

#[derive(Debug)]
struct RendererSnapshotOptions {
    project_path: String,
    renderer_id: Option<String>,
    out_dir: PathBuf,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
struct SnapshotStage {
    width: u32,
    height: u32,
}

#[derive(Clone, Debug, Deserialize)]
struct SnapshotWorkerScene {
    id: String,
    title: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SnapshotWorkerOutput {
    // ok / rendererId 是 worker JSON 契约的完整形状，当前消费方只读
    // scenes / stage / snapshotDir；保留字段记录契约，显式允许未读。
    #[allow(dead_code)]
    ok: bool,
    #[serde(rename = "rendererId")]
    #[allow(dead_code)]
    renderer_id: String,
    scenes: Vec<SnapshotWorkerScene>,
    stage: SnapshotStage,
    #[serde(rename = "snapshotDir")]
    snapshot_dir: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
struct SnapshotSceneResult {
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    file: String,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Serialize, Debug)]
struct RendererSnapshotOutput {
    ok: bool,
    #[serde(rename = "rendererId")]
    renderer_id: String,
    #[serde(rename = "outDir")]
    out_dir: String,
    stage: SnapshotStage,
    scenes: Vec<SnapshotSceneResult>,
}

#[derive(Clone, Debug)]
struct SnapshotPageReport {
    status: String,
    error: Option<String>,
}

#[derive(Serialize, Debug)]
struct BuildOutput {
    ok: bool,
    target: String,
    #[serde(rename = "outDir")]
    out_dir: String,
    #[serde(rename = "rendererId")]
    renderer_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    runtime: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    executable: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    artifacts: Vec<String>,
    warnings: Vec<app_lib::ProjectIssue>,
}

#[derive(Deserialize, Debug)]
struct DesktopWorkerOutput {
    ok: bool,
    runtime: String,
    mode: String,
    #[serde(rename = "outDir")]
    out_dir: String,
    executable: String,
    artifacts: Vec<String>,
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
    diagnostics: Vec<RendererDiagnostic>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    issues: Vec<app_lib::ProjectIssue>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum RendererDiagnosticSeverity {
    Error,
    Warn,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct RendererDiagnostic {
    severity: RendererDiagnosticSeverity,
    code: String,
    #[serde(rename = "rendererId")]
    renderer_id: String,
    step: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    column: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    snippet: Option<String>,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
struct RendererCheckOutput {
    ok: bool,
    #[serde(rename = "rendererId")]
    renderer_id: String,
    diagnostics: Vec<RendererDiagnostic>,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
struct SmokeOutput {
    ok: bool,
    target: String,
    #[serde(rename = "distDir")]
    dist_dir: String,
    #[serde(rename = "basePath")]
    base_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    runtime: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mode: Option<String>,
    checks: Vec<String>,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
struct SmokeError {
    ok: bool,
    code: String,
    message: String,
    step: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    file: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DoctorNodeStatus {
    available: bool,
    version: Option<String>,
    source: Option<String>,
    path: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DoctorElectronStatus {
    cached: bool,
    version: String,
    override_path: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DoctorTauriPlayerStatus {
    available: bool,
    path: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DoctorExporterStatus {
    web_worker: bool,
    desktop_worker: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
struct DoctorOutput {
    ok: bool,
    node: DoctorNodeStatus,
    electron: DoctorElectronStatus,
    #[serde(rename = "tauriPlayer")]
    tauri_player: DoctorTauriPlayerStatus,
    exporter: DoctorExporterStatus,
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
    #[serde(default)]
    diagnostics: Vec<RendererDiagnostic>,
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

fn emit_operation_error(error: &CliOperationError, format: OutputFormat) {
    match format {
        OutputFormat::Json => println!(
            "{}",
            serde_json::to_string_pretty(error).expect("CLI error must serialize")
        ),
        OutputFormat::Text => {
            eprintln!("{}: {}", error.code, error.message);
            if !error.modified_files.is_empty() {
                eprintln!(
                    "Files already modified: {}",
                    error.modified_files.join(", ")
                );
            }
        }
    }
}

fn read_cli_json(path: &Path, step: &str) -> Result<serde_json::Value, CliOperationError> {
    let text = fs::read_to_string(path).map_err(|error| {
        CliOperationError::new(
            "input_file_read_failed",
            format!("failed to read {}: {error}", path.display()),
            step,
        )
        .file(path.to_string_lossy())
    })?;
    serde_json::from_str(&text).map_err(|error| {
        CliOperationError::new(
            "input_json_invalid",
            format!("failed to parse {}: {error}", path.display()),
            step,
        )
        .file(path.to_string_lossy())
    })
}

fn ensure_graph_preflight(project: &app_lib::ProjectData) -> Result<(), CliOperationError> {
    let graph_error = project.graph_report.as_ref().and_then(|report| {
        report
            .graph_issues
            .iter()
            .find(|issue| issue.severity == app_lib::GraphIssueSeverity::Error)
    });
    if let Some(issue) = graph_error {
        return Err(CliOperationError::new(
            "graph_preflight_failed",
            format!("{} ({})", issue.message, issue.code),
            "preflight",
        )
        .file(
            issue
                .file
                .clone()
                .unwrap_or_else(|| "content/graph.json".to_string()),
        ));
    }
    Ok(())
}

fn preflight_identity_assignment(
    path: &str,
    selected_node: Option<&str>,
) -> Result<(String, Vec<PlannedNodeAssignment>), CliOperationError> {
    let project = app_lib::open_project_for_cli(path).map_err(CliOperationError::open)?;
    ensure_graph_preflight(&project)?;
    let graph = project
        .graph
        .as_ref()
        .ok_or_else(|| CliOperationError::open("project graph is unavailable"))?;
    let nodes = project
        .nodes
        .as_ref()
        .ok_or_else(|| CliOperationError::open("project nodes are unavailable"))?;
    let revisions = project
        .node_revisions
        .as_ref()
        .ok_or_else(|| CliOperationError::open("project node revisions are unavailable"))?;

    let targets = match selected_node {
        Some(node_id) => {
            let matching = graph
                .nodes
                .iter()
                .filter(|node| node.id == node_id)
                .collect::<Vec<_>>();
            if matching.len() != 1 {
                return Err(CliOperationError::new(
                    "node_not_unique",
                    format!(
                        "graph node ID {node_id:?} must identify exactly one node (found {})",
                        matching.len()
                    ),
                    "preflight",
                ));
            }
            matching
        }
        None => graph.nodes.iter().collect(),
    };

    let mut planned = Vec::with_capacity(targets.len());
    for graph_node in targets {
        let matching_entries = nodes
            .iter()
            .filter(|entry| entry.rel_path == graph_node.file)
            .collect::<Vec<_>>();
        if matching_entries.len() != 1 {
            return Err(CliOperationError::new(
                "node_file_not_unique",
                format!(
                    "node file {:?} must resolve to exactly one loaded graph entry",
                    graph_node.file
                ),
                "preflight",
            )
            .file(format!("content/{}", graph_node.file)));
        }
        let node = matching_entries[0].data.as_ref().ok_or_else(|| {
            CliOperationError::new(
                "node_file_missing",
                format!("graph node {:?} has no readable node file", graph_node.id),
                "preflight",
            )
            .file(format!("content/{}", graph_node.file))
        })?;
        let revision = revisions
            .get(&graph_node.file)
            .and_then(Option::as_ref)
            .ok_or_else(|| {
                CliOperationError::new(
                    "node_revision_missing",
                    format!("node file {:?} has no revision", graph_node.file),
                    "preflight",
                )
                .file(format!("content/{}", graph_node.file))
            })?;
        let file = format!("content/{}", graph_node.file.replace('\\', "/"));
        let assignment = app_lib::assign_missing_story_point_ids(
            node,
            &app_lib::InstructionIdentityContext::new(&file, &graph_node.id),
        )
        .map_err(|error| {
            CliOperationError::new(
                "instruction_id_assignment_failed",
                error.to_string(),
                "preflight",
            )
            .file(&file)
        })?;
        planned.push(PlannedNodeAssignment {
            node_file: graph_node.file.clone(),
            revision: serde_json::to_value(revision).expect("file revision must serialize"),
            assignment,
        });
    }
    Ok((project.path, planned))
}

fn assign_instruction_ids(
    path: &str,
    selected_node: Option<&str>,
    dry_run: bool,
) -> Result<InstructionIdAssignOutput, CliOperationError> {
    let (project_path, planned) = preflight_identity_assignment(path, selected_node)?;
    execute_identity_assignment_plan(&project_path, planned, dry_run, |project_path, plan| {
        app_lib::save_node_for_cli(
            project_path,
            &plan.node_file,
            plan.assignment.node.clone(),
            Some(plan.revision.clone()),
        )
        .map(|_| ())
    })
}

fn execute_identity_assignment_plan<F>(
    project_path: &str,
    planned: Vec<PlannedNodeAssignment>,
    dry_run: bool,
    mut save: F,
) -> Result<InstructionIdAssignOutput, CliOperationError>
where
    F: FnMut(&str, &PlannedNodeAssignment) -> Result<(), String>,
{
    let mut changed_files = Vec::new();
    let mut modified_files = Vec::new();
    for plan in planned {
        if plan.assignment.assigned.is_empty() {
            continue;
        }
        let file = format!("content/{}", plan.node_file.replace('\\', "/"));
        if !dry_run {
            if let Err(message) = save(project_path, &plan) {
                let mut error =
                    CliOperationError::new("instruction_id_write_failed", message, "write")
                        .file(&file);
                error.modified_files = modified_files;
                return Err(error);
            }
            modified_files.push(file.clone());
        }
        changed_files.push(InstructionIdChangedFile {
            file,
            assigned: plan.assignment.assigned,
        });
    }
    let assigned_count = changed_files
        .iter()
        .map(|changed| changed.assigned.len())
        .sum();
    Ok(InstructionIdAssignOutput {
        ok: true,
        project_path: project_path.to_string(),
        dry_run,
        assigned_count,
        changed_files,
    })
}

fn run_assign_instruction_ids(
    path: &str,
    selected_node: Option<&str>,
    dry_run: bool,
    format: OutputFormat,
) -> i32 {
    match assign_instruction_ids(path, selected_node, dry_run) {
        Ok(output) => {
            match format {
                OutputFormat::Json => println!(
                    "{}",
                    serde_json::to_string_pretty(&output).expect("assign output must serialize")
                ),
                OutputFormat::Text => println!(
                    "Assigned {} stable instruction ID(s) in {} file(s){}.",
                    output.assigned_count,
                    output.changed_files.len(),
                    if dry_run { " (dry run)" } else { "" }
                ),
            }
            0
        }
        Err(error) => {
            emit_operation_error(&error, format);
            error.exit_code
        }
    }
}

fn load_cli_node(path: &str, node_id: &str) -> Result<LoadedCliNode, CliOperationError> {
    let project = app_lib::open_project_for_cli(path).map_err(CliOperationError::open)?;
    ensure_graph_preflight(&project)?;
    let graph = project
        .graph
        .as_ref()
        .ok_or_else(|| CliOperationError::open("project graph is unavailable"))?;
    let matches = graph
        .nodes
        .iter()
        .filter(|node| node.id == node_id)
        .collect::<Vec<_>>();
    if matches.len() != 1 {
        return Err(CliOperationError::new(
            "node_not_unique",
            format!(
                "graph node ID {node_id:?} must identify exactly one node (found {})",
                matches.len()
            ),
            "preflight",
        ));
    }
    let graph_node = matches[0];
    let node_entries = project
        .nodes
        .as_ref()
        .ok_or_else(|| CliOperationError::open("project nodes are unavailable"))?;
    let matching_entries = node_entries
        .iter()
        .filter(|entry| entry.rel_path == graph_node.file)
        .collect::<Vec<_>>();
    if matching_entries.len() != 1 {
        return Err(CliOperationError::new(
            "node_file_not_unique",
            format!(
                "node file {:?} must resolve to exactly one loaded graph entry",
                graph_node.file
            ),
            "preflight",
        ));
    }
    let instructions = matching_entries[0].data.clone().ok_or_else(|| {
        CliOperationError::new(
            "node_file_missing",
            format!("graph node {node_id:?} has no readable node file"),
            "preflight",
        )
        .file(format!("content/{}", graph_node.file))
    })?;
    if !instructions.is_array() {
        return Err(CliOperationError::new(
            "node_file_not_array",
            "node contents must be a JSON array",
            "preflight",
        )
        .file(format!("content/{}", graph_node.file)));
    }
    let revision = project
        .node_revisions
        .as_ref()
        .and_then(|revisions| revisions.get(&graph_node.file))
        .and_then(Option::as_ref)
        .ok_or_else(|| {
            CliOperationError::new(
                "node_revision_missing",
                format!("node file {:?} has no revision", graph_node.file),
                "preflight",
            )
            .file(format!("content/{}", graph_node.file))
        })?;
    Ok(LoadedCliNode {
        project_path: project.path,
        node_id: node_id.to_string(),
        node_file: graph_node.file.clone(),
        revision: serde_json::to_value(revision).expect("file revision must serialize"),
        instructions,
    })
}

fn unique_story_point_index(
    instructions: &[serde_json::Value],
    id: &str,
) -> Result<usize, CliOperationError> {
    let matches = instructions
        .iter()
        .enumerate()
        .filter(|(_, instruction)| {
            app_lib::is_story_point_instruction(instruction)
                && instruction.get("id").and_then(serde_json::Value::as_str) == Some(id)
        })
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    if matches.len() != 1 {
        return Err(CliOperationError::new(
            "story_point_id_not_unique",
            format!(
                "story point ID {id:?} must identify exactly one instruction (found {})",
                matches.len()
            ),
            "mutate",
        ));
    }
    Ok(matches[0])
}

fn merge_json_patch(target: &mut serde_json::Value, patch: &serde_json::Value) {
    let Some(patch_object) = patch.as_object() else {
        *target = patch.clone();
        return;
    };
    if !target.is_object() {
        *target = serde_json::json!({});
    }
    let target_object = target.as_object_mut().expect("target was made an object");
    for (key, patch_value) in patch_object {
        if patch_value.is_null() {
            target_object.remove(key);
        } else {
            merge_json_patch(
                target_object
                    .entry(key.clone())
                    .or_insert(serde_json::Value::Null),
                patch_value,
            );
        }
    }
}

fn mutate_node_value(
    node: &serde_json::Value,
    mutation: NodeMutation,
) -> Result<MutatedNode, CliOperationError> {
    let mut instructions = node.as_array().cloned().ok_or_else(|| {
        CliOperationError::new(
            "node_file_not_array",
            "node contents must be a JSON array",
            "mutate",
        )
    })?;
    let mut story_point_ids = std::collections::HashSet::new();
    for instruction in &instructions {
        if !app_lib::is_story_point_instruction(instruction) {
            continue;
        }
        let Some(id) = instruction
            .get("id")
            .and_then(serde_json::Value::as_str)
            .filter(|id| !id.is_empty())
        else {
            continue;
        };
        if !story_point_ids.insert(id) {
            return Err(CliOperationError::new(
                "story_point_id_duplicate",
                format!("node contains duplicate story point ID {id:?}"),
                "mutate",
            ));
        }
    }

    let (story_point_id, before_index, after_index) = match mutation {
        NodeMutation::Insert {
            after,
            mut instruction,
        } => {
            let anchor = unique_story_point_index(&instructions, &after)?;
            if !instruction.is_object() {
                return Err(CliOperationError::new(
                    "instruction_not_object",
                    "insert input must contain one JSON instruction object",
                    "mutate",
                ));
            }
            if !app_lib::is_story_point_instruction(&instruction) {
                return Err(CliOperationError::new(
                    "instruction_not_story_point",
                    "node insert currently supports story point instructions only",
                    "mutate",
                ));
            }
            instruction
                .as_object_mut()
                .expect("instruction is an object")
                .remove("id");
            instructions.insert(anchor + 1, instruction);
            (None, None, Some(anchor + 1))
        }
        NodeMutation::Update {
            story_point_id,
            patch,
        } => {
            let target = unique_story_point_index(&instructions, &story_point_id)?;
            let patch_object = patch.as_object().ok_or_else(|| {
                CliOperationError::new(
                    "patch_not_object",
                    "update patch must be a JSON object",
                    "mutate",
                )
            })?;
            if patch_object.contains_key("id") || patch_object.contains_key("t") {
                return Err(CliOperationError::new(
                    "protected_field_change",
                    "update patch must not contain protected fields `id` or `t`",
                    "mutate",
                ));
            }
            merge_json_patch(&mut instructions[target], &patch);
            (Some(story_point_id), Some(target), Some(target))
        }
        NodeMutation::Move {
            story_point_id,
            before,
        } => {
            if story_point_id == before {
                return Err(CliOperationError::new(
                    "move_target_same",
                    "move target and destination must be different story points",
                    "mutate",
                ));
            }
            let source = unique_story_point_index(&instructions, &story_point_id)?;
            let destination = unique_story_point_index(&instructions, &before)?;
            let instruction = instructions.remove(source);
            let adjusted_destination = if source < destination {
                destination - 1
            } else {
                destination
            };
            instructions.insert(adjusted_destination, instruction);
            (
                Some(story_point_id),
                Some(source),
                Some(adjusted_destination),
            )
        }
        NodeMutation::Duplicate { story_point_id } => {
            let target = unique_story_point_index(&instructions, &story_point_id)?;
            let mut duplicate = instructions[target].clone();
            duplicate
                .as_object_mut()
                .expect("story point must be an object")
                .remove("id");
            instructions.insert(target + 1, duplicate);
            (Some(story_point_id), Some(target), Some(target + 1))
        }
        NodeMutation::Delete { story_point_id } => {
            let target = unique_story_point_index(&instructions, &story_point_id)?;
            instructions.remove(target);
            (Some(story_point_id), Some(target), None)
        }
    };
    Ok(MutatedNode {
        instructions: serde_json::Value::Array(instructions),
        story_point_id,
        before_index,
        after_index,
    })
}

fn execute_node_mutation(
    path: &str,
    node_id: &str,
    operation: &str,
    mutation: NodeMutation,
    dry_run: bool,
) -> Result<NodeMutationOutput, CliOperationError> {
    let loaded = load_cli_node(path, node_id)?;
    let mutated = mutate_node_value(&loaded.instructions, mutation)?;
    let file = format!("content/{}", loaded.node_file.replace('\\', "/"));

    let preview_assignment = app_lib::assign_missing_story_point_ids(
        &mutated.instructions,
        &app_lib::InstructionIdentityContext::new(&file, &loaded.node_id),
    )
    .map_err(|error| {
        CliOperationError::new(
            "instruction_id_assignment_failed",
            error.to_string(),
            "normalize",
        )
        .file(&file)
    })?;
    let created_identity_path = if matches!(operation, "insert" | "duplicate") {
        mutated.after_index.map(|index| format!("$[{index}].id"))
    } else {
        None
    };
    let preview_new_id = created_identity_path.as_deref().and_then(|path| {
        preview_assignment
            .assigned
            .iter()
            .find(|item| item.json_path == path)
            .map(|item| item.id.clone())
    });
    app_lib::validate_node_for_cli(&preview_assignment.node).map_err(|message| {
        CliOperationError::new("node_mutation_invalid", message, "validate").file(&file)
    })?;

    let (new_revision, assigned, new_story_point_id) = if dry_run {
        (None, preview_assignment.assigned, preview_new_id)
    } else {
        // The save boundary repeats missing-only assignment with the current revision;
        // it is authoritative for both generated IDs and persisted output.
        let saved = app_lib::save_node_for_cli(
            &loaded.project_path,
            &loaded.node_file,
            mutated.instructions,
            Some(loaded.revision),
        )
        .map_err(|message| {
            CliOperationError::new("node_mutation_write_failed", message, "write").file(&file)
        })?;
        let new_id = created_identity_path.as_deref().and_then(|path| {
            saved
                .assigned
                .iter()
                .find(|item| item.json_path == path)
                .map(|item| item.id.clone())
        });
        (
            Some(serde_json::to_value(saved.revision).expect("revision must serialize")),
            saved.assigned,
            new_id,
        )
    };
    Ok(NodeMutationOutput {
        ok: true,
        operation: operation.to_string(),
        project_path: loaded.project_path,
        node_id: loaded.node_id,
        file,
        dry_run,
        story_point_id: mutated.story_point_id,
        new_story_point_id,
        before_index: mutated.before_index,
        after_index: mutated.after_index,
        new_revision,
        assigned,
    })
}

fn run_node_mutation(
    path: &str,
    node_id: &str,
    operation: &str,
    mutation: NodeMutation,
    dry_run: bool,
    format: OutputFormat,
) -> i32 {
    match execute_node_mutation(path, node_id, operation, mutation, dry_run) {
        Ok(output) => {
            match format {
                OutputFormat::Json => println!(
                    "{}",
                    serde_json::to_string_pretty(&output)
                        .expect("node mutation output must serialize")
                ),
                OutputFormat::Text => println!(
                    "{} {} in node {}{}.",
                    if dry_run { "Previewed" } else { "Completed" },
                    operation,
                    node_id,
                    if dry_run { " (dry run)" } else { "" }
                ),
            }
            0
        }
        Err(error) => {
            emit_operation_error(&error, format);
            error.exit_code
        }
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
        diagnostics: vec![],
        issues,
    }
}

fn validate_progress_output(
    progress: Option<ProgressOutput>,
    format: OutputFormat,
) -> Result<(), BuildError> {
    if progress.is_some() && format != OutputFormat::Json {
        return Err(build_error(
            "build_progress_requires_json",
            "--progress jsonl 必须与 --format json 同时使用",
            "progress",
            None,
            None,
            vec![],
        ));
    }
    Ok(())
}

fn progress_json_line(step: &str, phase: &str, message: &str, percent: Option<u8>) -> String {
    serde_json::to_string(&serde_json::json!({
        "type": "progress",
        "step": step,
        "phase": phase,
        "message": message,
        "percent": percent,
    }))
    .expect("build progress must serialize")
}

fn emit_build_progress(
    progress: Option<ProgressOutput>,
    step: &str,
    phase: &str,
    message: &str,
    percent: Option<u8>,
) {
    if progress.is_none() {
        return;
    }
    println!("{}", progress_json_line(step, phase, message, percent));
    let _ = std::io::stdout().flush();
}

fn selected_desktop_runtime(
    target: BuildTarget,
    runtime: Option<DesktopRuntime>,
) -> Result<Option<DesktopRuntime>, BuildError> {
    match (target, runtime) {
        (BuildTarget::Web, None) => Ok(None),
        (BuildTarget::Web, Some(_)) => Err(build_error(
            "desktop_runtime_not_applicable",
            "--runtime 仅用于 --target desktop",
            "desktop",
            None,
            None,
            vec![],
        )),
        (BuildTarget::Desktop, runtime) => Ok(Some(runtime.unwrap_or(DesktopRuntime::Electron))),
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
    let requested_out = if out_dir.is_absolute() {
        out_dir.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|e| {
                build_error(
                    "build_path_error",
                    format!("无法定位当前目录: {e}"),
                    "prepare",
                    None,
                    None,
                    vec![],
                )
            })?
            .join(out_dir)
    };
    let mut existing_ancestor = requested_out.as_path();
    while !existing_ancestor.exists() {
        existing_ancestor = existing_ancestor.parent().ok_or_else(|| {
            build_error(
                "build_path_error",
                format!("无法定位输出目录的已有父目录: {}", out_dir.display()),
                "prepare",
                None,
                None,
                vec![],
            )
        })?;
    }
    let canonical_ancestor = existing_ancestor.canonicalize().map_err(|e| {
        build_error(
            "build_path_error",
            format!(
                "无法定位输出目录父目录 {}: {}",
                existing_ancestor.display(),
                e
            ),
            "prepare",
            None,
            None,
            vec![],
        )
    })?;
    let suffix = requested_out.strip_prefix(existing_ancestor).map_err(|e| {
        build_error(
            "build_path_error",
            format!("无法解析输出目录 {}: {}", out_dir.display(), e),
            "prepare",
            None,
            None,
            vec![],
        )
    })?;
    let out_abs = if suffix.as_os_str().is_empty() {
        canonical_ancestor
    } else {
        canonical_ancestor.join(suffix)
    };

    if out_abs.parent().is_none() || out_abs == project_root || project_root.starts_with(&out_abs) {
        return Err(build_error(
            "build_path_error",
            "输出目录不能是文件系统根目录、项目根目录或项目根目录的上级目录",
            "prepare",
            None,
            None,
            vec![],
        ));
    }
    for protected in ["content", "renderers", ".galstudio"] {
        if out_abs.starts_with(project_root.join(protected)) {
            return Err(build_error(
                "build_path_error",
                format!("输出目录不能位于项目源目录 {protected}/ 内"),
                "prepare",
                None,
                None,
                vec![],
            ));
        }
    }
    Ok(())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("创建目录失败 {}: {}", dst.display(), e))?;
    for entry in fs::read_dir(src).map_err(|e| format!("读取目录失败 {}: {}", src.display(), e))?
    {
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
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录失败 {}: {}", parent.display(), e))?;
    }
    let text =
        serde_json::to_string_pretty(value).map_err(|e| format!("序列化 JSON 失败: {}", e))?;
    fs::write(path, text).map_err(|e| format!("写文件失败 {}: {}", path.display(), e))
}

fn write_text_file(path: &Path, text: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录失败 {}: {}", parent.display(), e))?;
    }
    fs::write(path, text).map_err(|e| format!("写文件失败 {}: {}", path.display(), e))
}

fn hex_sha256(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("读取文件失败 {}: {}", path.display(), e))?;
    Ok(hex_sha256(&bytes))
}

fn sorted_files_under(root: &Path) -> Result<Vec<PathBuf>, String> {
    fn visit(dir: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
        if !dir.exists() {
            return Ok(());
        }
        for entry in
            fs::read_dir(dir).map_err(|e| format!("读取目录失败 {}: {}", dir.display(), e))?
        {
            let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
            let path = entry.path();
            if path.is_dir() {
                visit(&path, files)?;
            } else if path.is_file() {
                files.push(path);
            }
        }
        Ok(())
    }

    let mut files = Vec::new();
    visit(root, &mut files)?;
    files.sort_by(|a, b| a.to_string_lossy().cmp(&b.to_string_lossy()));
    Ok(files)
}

fn slash_path(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn content_tree_hash(content_dir: &Path) -> Result<String, String> {
    let mut hasher = Sha256::new();
    for file in sorted_files_under(content_dir)? {
        let rel = file
            .strip_prefix(content_dir)
            .map_err(|e| format!("计算 content 相对路径失败 {}: {}", file.display(), e))?;
        let rel = format!("content/{}", slash_path(rel));
        let bytes =
            fs::read(&file).map_err(|e| format!("读取文件失败 {}: {}", file.display(), e))?;
        hasher.update(rel.as_bytes());
        hasher.update([0]);
        hasher.update(&bytes);
        hasher.update([0]);
    }
    let digest = hasher.finalize();
    Ok(digest.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn add_manifest_asset_ref(
    refs: &mut BTreeMap<String, (String, String)>,
    kind: &str,
    id: &str,
    value: Option<&serde_json::Value>,
) {
    let Some(path) = value.and_then(|value| value.as_str()) else {
        return;
    };
    if path.starts_with("assets/") {
        refs.entry(path.to_string())
            .or_insert_with(|| (kind.to_string(), id.to_string()));
    }
}

fn manifest_asset_refs(manifest: &serde_json::Value) -> BTreeMap<String, (String, String)> {
    let mut refs = BTreeMap::new();
    if let Some(backgrounds) = manifest
        .get("backgrounds")
        .and_then(|value| value.as_object())
    {
        for (id, value) in backgrounds {
            add_manifest_asset_ref(&mut refs, "background", id, Some(value));
        }
    }
    if let Some(characters) = manifest
        .get("characters")
        .and_then(|value| value.as_object())
    {
        for (character_id, character) in characters {
            let Some(sprites) = character.get("sprites").and_then(|value| value.as_object()) else {
                continue;
            };
            for (sprite_id, value) in sprites {
                add_manifest_asset_ref(
                    &mut refs,
                    "characterSprite",
                    &format!("{character_id}.{sprite_id}"),
                    Some(value),
                );
            }
        }
    }
    if let Some(audio) = manifest.get("audio").and_then(|value| value.as_object()) {
        for kind in ["bgm", "sfx", "voice"] {
            let Some(entries) = audio.get(kind).and_then(|value| value.as_object()) else {
                continue;
            };
            for (id, value) in entries {
                add_manifest_asset_ref(&mut refs, kind, id, Some(value));
            }
        }
    }
    refs
}

fn fallback_asset_id(rel_path: &str) -> String {
    rel_path
        .trim_start_matches("assets/")
        .rsplit_once('.')
        .map(|(without_ext, _)| without_ext)
        .unwrap_or_else(|| rel_path.trim_start_matches("assets/"))
        .replace('/', ".")
}

fn build_asset_manifest_value(
    content_dir: &Path,
    manifest: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let assets_dir = content_dir.join("assets");
    let refs = manifest_asset_refs(manifest);
    let mut assets = Vec::new();
    for file in sorted_files_under(&assets_dir)? {
        let rel = file
            .strip_prefix(content_dir)
            .map_err(|e| format!("计算 asset 相对路径失败 {}: {}", file.display(), e))?;
        let rel = slash_path(rel);
        let full_path = format!("content/{rel}");
        let metadata = fs::metadata(&file)
            .map_err(|e| format!("读取文件信息失败 {}: {}", file.display(), e))?;
        let (kind, id) = refs
            .get(&rel)
            .cloned()
            .unwrap_or_else(|| ("asset".to_string(), fallback_asset_id(&rel)));
        assets.push(serde_json::json!({
            "kind": kind,
            "id": id,
            "path": full_path,
            "size": metadata.len(),
            "sha256": sha256_file(&file)?,
        }));
    }
    Ok(serde_json::json!({
        "schemaVersion": 1,
        "assets": assets,
    }))
}

fn write_json_file_and_hash(path: &Path, value: &serde_json::Value) -> Result<String, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录失败 {}: {}", parent.display(), e))?;
    }
    let text =
        serde_json::to_string_pretty(value).map_err(|e| format!("序列化 JSON 失败: {}", e))?;
    fs::write(path, &text).map_err(|e| format!("写文件失败 {}: {}", path.display(), e))?;
    Ok(hex_sha256(text.as_bytes()))
}

const EXPORT_WORKER_RELATIVE_PATH: &str = "exporter/packages/studio/scripts/build-web-export.mjs";
const SNAPSHOT_WORKER_RELATIVE_PATH: &str =
    "exporter/packages/studio/scripts/renderer-snapshot.mjs";
const DESKTOP_WORKER_RELATIVE_PATH: &str =
    "exporter/packages/studio/scripts/build-desktop-export.mjs";
const ELECTRON_RUNTIME_VERSION: &str = "43.1.1";

fn worker_path_candidates(executable: Option<&Path>, relative_path: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(parent) = executable.and_then(Path::parent) {
        candidates.push(parent.join(relative_path));
        candidates.push(parent.join("resources").join(relative_path));
        if let Some(parent_parent) = parent.parent() {
            candidates.push(parent_parent.join("Resources").join(relative_path));
            candidates.push(parent_parent.join("resources").join(relative_path));
        }
    }
    candidates
}

fn resolve_worker_path(
    env_var: &str,
    relative_path: &str,
    debug_relative: &str,
) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var(env_var) {
        let path = PathBuf::from(path);
        return path
            .is_file()
            .then_some(path)
            .ok_or_else(|| format!("{env_var} 指向的导出器不存在"));
    }

    let mut candidates =
        worker_path_candidates(std::env::current_exe().ok().as_deref(), relative_path);
    if cfg!(debug_assertions) {
        candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(debug_relative));
    }
    candidates
        .iter()
        .find(|candidate| candidate.is_file())
        .cloned()
        .ok_or_else(|| {
            format!(
                "找不到随 CLI 分发的 Web exporter。检查路径：{}",
                candidates
                    .iter()
                    .map(|path| path.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        })
}

fn build_worker_path() -> Result<PathBuf, String> {
    resolve_worker_path(
        "VIBEGAL_EXPORT_WORKER",
        EXPORT_WORKER_RELATIVE_PATH,
        "../scripts/build-web-export.mjs",
    )
}

fn snapshot_worker_path() -> Result<PathBuf, String> {
    resolve_worker_path(
        "VIBEGAL_SNAPSHOT_WORKER",
        SNAPSHOT_WORKER_RELATIVE_PATH,
        "../scripts/renderer-snapshot.mjs",
    )
}

fn desktop_worker_path() -> Result<PathBuf, String> {
    resolve_worker_path(
        "VIBEGAL_DESKTOP_WORKER",
        DESKTOP_WORKER_RELATIVE_PATH,
        "../scripts/build-desktop-export.mjs",
    )
}

fn tauri_player_executable_name() -> &'static str {
    if cfg!(windows) {
        "vibegal-player-tauri.exe"
    } else {
        "vibegal-player-tauri"
    }
}

fn tauri_player_path() -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("VIBEGAL_TAURI_PLAYER") {
        let path = PathBuf::from(path);
        return path
            .is_file()
            .then_some(path)
            .ok_or_else(|| "VIBEGAL_TAURI_PLAYER 指向的轻量 Player 不存在".to_string());
    }
    let name = tauri_player_executable_name();
    let mut candidates = Vec::new();
    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            candidates.push(parent.join(name));
            candidates.push(parent.join("player").join(name));
            candidates.push(parent.join("resources/player").join(name));
            if let Some(parent_parent) = parent.parent() {
                candidates.push(parent_parent.join("Resources/player").join(name));
                candidates.push(parent_parent.join("resources/player").join(name));
            }
        }
    }
    if cfg!(debug_assertions) {
        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("target/debug")
                .join(name),
        );
    }
    candidates
        .iter()
        .find(|path| path.is_file())
        .cloned()
        .ok_or_else(|| {
            format!(
                "找不到随 CLI 分发的 Tauri 轻量 Player。检查路径：{}",
                candidates
                    .iter()
                    .map(|path| path.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        })
}

fn node_executable() -> String {
    std::env::var("VIBEGAL_NODE").unwrap_or_else(|_| "node".to_string())
}

fn electron_platform_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    }
}

fn electron_arch_name() -> &'static str {
    match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        "arm" => "armv7l",
        other => other,
    }
}

fn electron_runtime_cache_root() -> PathBuf {
    if let Some(path) = std::env::var_os("VIBEGAL_ELECTRON_RUNTIME_CACHE") {
        return PathBuf::from(path);
    }
    if cfg!(target_os = "windows") {
        if let Some(path) = std::env::var_os("LOCALAPPDATA") {
            return PathBuf::from(path).join("VibeGal/runtime");
        }
    }
    if cfg!(target_os = "macos") {
        if let Some(path) = std::env::var_os("HOME") {
            return PathBuf::from(path).join("Library/Caches/VibeGal/runtime");
        }
    }
    let cache = std::env::var_os("XDG_CACHE_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".cache")))
        .unwrap_or_else(std::env::temp_dir);
    cache.join("vibegal/runtime")
}

// Keep this directory contract synchronized with electronCacheRoot() and
// resolveElectronDist() in scripts/build-desktop-export.mjs.
fn electron_runtime_cache_dir_for(root: &Path) -> PathBuf {
    root.join(format!(
        "electron-v{}-{}-{}",
        ELECTRON_RUNTIME_VERSION,
        electron_platform_name(),
        electron_arch_name()
    ))
}

fn electron_runtime_is_cached_at(root: &Path) -> bool {
    electron_runtime_cache_dir_for(root)
        .join(".vibegal-runtime-ready")
        .is_file()
}

fn probe_node_with<F>(executable: &str, source: &str, run_version: F) -> DoctorNodeStatus
where
    F: FnOnce(&str) -> Option<String>,
{
    let version = run_version(executable).map(|value| value.trim().to_string());
    let available = version.is_some();
    DoctorNodeStatus {
        available,
        version,
        source: available.then(|| source.to_string()),
        path: available.then(|| executable.to_string()),
    }
}

fn resolve_executable_on_path(executable: &str) -> Option<PathBuf> {
    let requested = Path::new(executable);
    if requested.is_absolute() || requested.components().count() > 1 {
        return requested.is_file().then(|| {
            requested
                .canonicalize()
                .unwrap_or_else(|_| requested.to_path_buf())
        });
    }
    let path_env = std::env::var_os("PATH")?;
    let extensions: &[&str] = if cfg!(windows) {
        &["", ".exe", ".cmd", ".bat", ".com"]
    } else {
        &[""]
    };
    for directory in std::env::split_paths(&path_env) {
        for extension in extensions {
            let candidate = directory.join(format!("{executable}{extension}"));
            if candidate.is_file() {
                return Some(candidate.canonicalize().unwrap_or(candidate));
            }
        }
    }
    None
}

fn probe_node() -> DoctorNodeStatus {
    let explicit = std::env::var("VIBEGAL_NODE").ok();
    let executable = explicit.clone().unwrap_or_else(|| node_executable());
    let source = if explicit.is_some() { "env" } else { "path" };
    let mut status = probe_node_with(&executable, source, |program| {
        let output = Command::new(program).arg("--version").output().ok()?;
        output
            .status
            .success()
            .then(|| String::from_utf8_lossy(&output.stdout).to_string())
    });
    if status.available {
        status.path = resolve_executable_on_path(&executable)
            .map(|path| path.to_string_lossy().to_string())
            .or_else(|| Some(executable));
    }
    status
}

fn doctor_environment() -> DoctorOutput {
    let node = probe_node();
    let override_path = std::env::var("VIBEGAL_ELECTRON_DIST").ok();
    let electron = DoctorElectronStatus {
        cached: override_path.is_some()
            || electron_runtime_is_cached_at(&electron_runtime_cache_root()),
        version: ELECTRON_RUNTIME_VERSION.to_string(),
        override_path,
    };
    let tauri_path = tauri_player_path().ok();
    let tauri_player = DoctorTauriPlayerStatus {
        available: tauri_path.is_some(),
        path: tauri_path.map(|path| path.to_string_lossy().to_string()),
    };
    let exporter = DoctorExporterStatus {
        web_worker: build_worker_path().is_ok(),
        desktop_worker: desktop_worker_path().is_ok(),
    };
    DoctorOutput {
        ok: node.available
            && tauri_player.available
            && exporter.web_worker
            && exporter.desktop_worker,
        node,
        electron,
        tauri_player,
        exporter,
    }
}

fn run_doctor(format: OutputFormat) -> i32 {
    let output = doctor_environment();
    match format {
        OutputFormat::Json => print_build_json(&output),
        OutputFormat::Text => {
            println!(
                "桌面构建环境：{}",
                if output.ok {
                    "可用"
                } else {
                    "存在缺失项"
                }
            );
            println!(
                "Node.js：{}{}",
                if output.node.available {
                    "可用"
                } else {
                    "不可用"
                },
                output
                    .node
                    .version
                    .as_deref()
                    .map(|version| format!(" ({version})"))
                    .unwrap_or_default()
            );
            println!(
                "Electron {}：{}",
                output.electron.version,
                if output.electron.cached {
                    "运行时已缓存"
                } else {
                    "首次构建时下载"
                }
            );
            println!(
                "Tauri 轻量 Player：{}",
                if output.tauri_player.available {
                    "可用"
                } else {
                    "不可用"
                }
            );
            println!(
                "Exporter：web={} desktop={}",
                output.exporter.web_worker, output.exporter.desktop_worker
            );
        }
    }
    0
}

fn source_snippet(project_root: &Path, rel_file: &str, line: Option<u32>) -> Option<String> {
    let line = line.unwrap_or(1).max(1) as usize;
    let text = fs::read_to_string(project_root.join(rel_file)).ok()?;
    text.lines().nth(line - 1).map(|line| line.to_string())
}

fn diagnostic_from_build_error(
    error: &BuildError,
    project_root: &Path,
    renderer_id: &str,
) -> Option<RendererDiagnostic> {
    let file = error.file.clone();
    Some(RendererDiagnostic {
        severity: RendererDiagnosticSeverity::Error,
        code: error.code.clone(),
        renderer_id: error
            .renderer_id
            .clone()
            .unwrap_or_else(|| renderer_id.to_string()),
        step: if error.step == "renderer" {
            "compile".to_string()
        } else {
            error.step.clone()
        },
        message: error.message.clone(),
        snippet: file
            .as_deref()
            .and_then(|file| source_snippet(project_root, file, error.line)),
        file,
        line: error.line,
        column: error.column,
    })
}

fn parse_worker_error(stderr: &str, renderer_id: &str, project_root: &Path) -> Option<BuildError> {
    let start = stderr.find('{')?;
    let json = &stderr[start..];
    let worker: WorkerBuildError = serde_json::from_str(json).ok()?;
    let top_level_step = if worker.step == "compile" {
        "renderer".to_string()
    } else {
        worker.step
    };
    let mut error = BuildError {
        ok: false,
        code: worker.code,
        message: worker.message,
        step: top_level_step,
        file: worker.file,
        renderer_id: worker.renderer_id.or_else(|| Some(renderer_id.to_string())),
        line: worker.line,
        column: worker.column,
        diagnostics: worker.diagnostics,
        issues: vec![],
    };
    if error.diagnostics.is_empty() {
        if let Some(diagnostic) = diagnostic_from_build_error(&error, project_root, renderer_id) {
            error.diagnostics.push(diagnostic);
        }
    }
    Some(error)
}

fn run_build_worker(options: &BuildOptions, renderer_id: &str) -> Result<(), BuildError> {
    let worker = build_worker_path().map_err(|message| {
        build_error(
            "build_worker_unavailable",
            message,
            "worker",
            None,
            Some(renderer_id.to_string()),
            vec![],
        )
    })?;
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
    if let Some(error) = parse_worker_error(&stderr, renderer_id, Path::new(&options.project_path))
    {
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

fn parse_desktop_worker_error(stderr: &str) -> Option<BuildError> {
    let start = stderr.find('{')?;
    let worker: WorkerBuildError = serde_json::from_str(&stderr[start..]).ok()?;
    Some(BuildError {
        ok: false,
        code: worker.code,
        message: worker.message,
        step: worker.step,
        file: worker.file,
        renderer_id: worker.renderer_id,
        line: worker.line,
        column: worker.column,
        diagnostics: worker.diagnostics,
        issues: vec![],
    })
}

fn run_desktop_worker(
    runtime: DesktopRuntime,
    web_dist: &Path,
    out_dir: &Path,
    product_name: &str,
) -> Result<DesktopWorkerOutput, BuildError> {
    let worker = desktop_worker_path().map_err(|message| {
        build_error(
            "desktop_worker_unavailable",
            message,
            "desktop",
            None,
            None,
            vec![],
        )
    })?;
    let mut command = Command::new(node_executable());
    command
        .arg(worker)
        .arg("--runtime")
        .arg(runtime.as_str())
        .arg("--web-dist")
        .arg(web_dist)
        .arg("--out")
        .arg(out_dir)
        .arg("--product-name")
        .arg(product_name);
    match runtime {
        DesktopRuntime::Electron => {
            command
                .arg("--electron-version")
                .arg(ELECTRON_RUNTIME_VERSION);
            if let Ok(path) = std::env::var("VIBEGAL_ELECTRON_DIST") {
                command.arg("--electron-dist").arg(path);
            }
        }
        DesktopRuntime::Tauri => {
            let player = tauri_player_path().map_err(|message| {
                build_error(
                    "desktop_tauri_player_unavailable",
                    message,
                    "desktop",
                    None,
                    None,
                    vec![],
                )
            })?;
            command.arg("--tauri-player").arg(player);
        }
    }
    let output = command.output().map_err(|error| {
        build_error(
            "desktop_worker_failed",
            format!("无法启动桌面 build worker: {error}"),
            "desktop",
            None,
            None,
            vec![],
        )
    })?;
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        return serde_json::from_str(stdout.trim()).map_err(|error| {
            build_error(
                "desktop_worker_invalid_output",
                format!("桌面 build worker 返回了无效 JSON: {error}"),
                "desktop",
                None,
                None,
                vec![],
            )
        });
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    if let Some(error) = parse_desktop_worker_error(&stderr) {
        return Err(error);
    }
    Err(build_error(
        "desktop_worker_failed",
        stderr.trim().to_string(),
        "desktop",
        None,
        None,
        vec![],
    ))
}

fn renderer_diagnostic_with_severity(
    severity: RendererDiagnosticSeverity,
    code: &str,
    renderer_id: &str,
    step: &str,
    message: impl Into<String>,
    file: Option<String>,
    line: Option<u32>,
    column: Option<u32>,
    snippet: Option<String>,
) -> RendererDiagnostic {
    RendererDiagnostic {
        severity,
        code: code.to_string(),
        renderer_id: renderer_id.to_string(),
        step: step.to_string(),
        message: message.into(),
        file,
        line,
        column,
        snippet,
    }
}

fn renderer_diagnostic(
    code: &str,
    renderer_id: &str,
    step: &str,
    message: impl Into<String>,
    file: Option<String>,
    line: Option<u32>,
    column: Option<u32>,
    snippet: Option<String>,
) -> RendererDiagnostic {
    renderer_diagnostic_with_severity(
        RendererDiagnosticSeverity::Error,
        code,
        renderer_id,
        step,
        message,
        file,
        line,
        column,
        snippet,
    )
}

fn build_error_from_renderer_diagnostics(mut diagnostics: Vec<RendererDiagnostic>) -> BuildError {
    if diagnostics.is_empty() {
        diagnostics.push(renderer_diagnostic(
            "renderer_check_failed",
            "",
            "renderer",
            "Renderer check failed.",
            None,
            None,
            None,
            None,
        ));
    }
    let first = diagnostics[0].clone();
    let top_level_step = if first.step == "compile" {
        "renderer".to_string()
    } else {
        first.step.clone()
    };
    BuildError {
        ok: false,
        code: first.code,
        message: first.message,
        step: top_level_step,
        file: first.file,
        renderer_id: Some(first.renderer_id),
        line: first.line,
        column: first.column,
        diagnostics,
        issues: vec![],
    }
}

fn renderer_source_line(source: &str, line: u32) -> Option<String> {
    source
        .lines()
        .nth(line.saturating_sub(1) as usize)
        .map(|line| line.to_string())
}

fn renderer_import_location(source: &str, specifier: &str) -> (u32, u32) {
    let quoted = [format!("\"{specifier}\""), format!("'{specifier}'")]
        .into_iter()
        .filter_map(|needle| source.find(&needle).map(|index| (needle, index)))
        .min_by_key(|(_, index)| *index);
    let Some((_, index)) = quoted else {
        return (1, 1);
    };
    let before = &source[..index];
    let line = before.lines().count().max(1) as u32;
    let column = before
        .rsplit_once('\n')
        .map(|(_, tail)| tail.chars().count() + 1)
        .unwrap_or_else(|| before.chars().count() + 1) as u32;
    (line, column)
}

fn collect_renderer_bare_imports(source: &str) -> Vec<String> {
    let mut imports = Vec::new();
    for quote in ['"', '\''] {
        let marker = format!("from {quote}");
        let mut rest = source;
        while let Some(index) = rest.find(&marker) {
            let after = &rest[index + marker.len()..];
            if let Some(end) = after.find(quote) {
                imports.push(after[..end].to_string());
                rest = &after[end + 1..];
            } else {
                break;
            }
        }
        let marker = format!("import {quote}");
        let mut rest = source;
        while let Some(index) = rest.find(&marker) {
            let after = &rest[index + marker.len()..];
            if let Some(end) = after.find(quote) {
                imports.push(after[..end].to_string());
                rest = &after[end + 1..];
            } else {
                break;
            }
        }
    }
    imports
}

fn renderer_import_allowed(specifier: &str) -> bool {
    matches!(
        specifier,
        "react"
            | "react/jsx-runtime"
            | "react/jsx-dev-runtime"
            | "react-dom"
            | "react-dom/client"
            | "@vibegal/engine"
    ) || specifier.starts_with('.')
        || specifier.starts_with('/')
        || specifier.starts_with("file:")
}

fn find_string_property(source: &str, property: &str) -> Option<(String, u32)> {
    for (index, line) in source.lines().enumerate() {
        let Some(property_index) = line.find(property) else {
            continue;
        };
        let after_property = &line[property_index + property.len()..];
        let Some(colon_index) = after_property.find(':') else {
            continue;
        };
        let after_colon = after_property[colon_index + 1..].trim_start();
        let Some(quote) = after_colon.chars().next() else {
            continue;
        };
        if quote != '"' && quote != '\'' {
            continue;
        }
        let value_start = quote.len_utf8();
        let after_quote = &after_colon[value_start..];
        let Some(end) = after_quote.find(quote) else {
            continue;
        };
        return Some((after_quote[..end].to_string(), index as u32 + 1));
    }
    None
}

fn find_number_property(source: &str, property: &str) -> Option<(i64, u32)> {
    for (index, line) in source.lines().enumerate() {
        let Some(property_index) = line.find(property) else {
            continue;
        };
        let after_property = &line[property_index + property.len()..];
        let Some(colon_index) = after_property.find(':') else {
            continue;
        };
        let after_colon = after_property[colon_index + 1..].trim_start();
        let digits: String = after_colon
            .chars()
            .take_while(|ch| ch.is_ascii_digit())
            .collect();
        if let Ok(value) = digits.parse::<i64>() {
            return Some((value, index as u32 + 1));
        }
    }
    None
}

/// 经 node worker（--check-only）对渲染层做真实编译与类型检查。
/// 返回 worker 产出的诊断列表；worker/node 不可用时报 Err（调用方降级为警告）。
fn renderer_compile_diagnostics(
    project_path: &str,
    renderer_id: &str,
) -> Result<Vec<RendererDiagnostic>, String> {
    let worker = build_worker_path()?;
    let output = Command::new(node_executable())
        .arg(&worker)
        .arg("--project")
        .arg(project_path)
        .arg("--renderer")
        .arg(renderer_id)
        .arg("--check-only")
        .output()
        .map_err(|e| format!("无法启动渲染层编译检查 worker: {e}"))?;
    if output.status.success() {
        return Ok(vec![]);
    }
    let mut stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if stderr.trim().is_empty() {
        stderr = String::from_utf8_lossy(&output.stdout).to_string();
    }
    if let Some(error) = parse_worker_error(&stderr, renderer_id, Path::new(project_path)) {
        return Ok(error.diagnostics);
    }
    Ok(vec![renderer_diagnostic(
        "renderer_compile_failed",
        renderer_id,
        "compile",
        format!(
            "worker={} status={} stderr={}",
            worker.display(),
            output.status,
            stderr.trim()
        ),
        None,
        None,
        None,
        None,
    )])
}

fn renderer_check_project(
    options: RendererCheckOptions,
) -> Result<RendererCheckOutput, BuildError> {
    let project = app_lib::open_project_for_cli(&options.project_path).map_err(|message| {
        build_error(
            "open_project_failed",
            message,
            "discover",
            None,
            None,
            vec![],
        )
    })?;
    let renderer_id = options
        .renderer_id
        .clone()
        .unwrap_or_else(|| project.meta.active_renderer_id.clone());
    let mut diagnostics = Vec::new();
    if !project.renderer_ids.iter().any(|id| id == &renderer_id) {
        diagnostics.push(renderer_diagnostic(
            "renderer_not_found",
            &renderer_id,
            "discover",
            format!("渲染层不存在或缺少 index.tsx: {renderer_id}"),
            Some(format!("renderers/{renderer_id}/index.tsx")),
            None,
            None,
            None,
        ));
        return Ok(RendererCheckOutput {
            ok: false,
            renderer_id,
            diagnostics,
        });
    }

    let file = format!("renderers/{renderer_id}/index.tsx");
    let source = fs::read_to_string(Path::new(&project.path).join(&file)).map_err(|e| {
        build_error(
            "renderer_read_failed",
            format!("读取 renderer entry 失败: {e}"),
            "read",
            Some(file.clone()),
            Some(renderer_id.clone()),
            vec![],
        )
    })?;

    let renderer_dir = Path::new(&project.path)
        .join("renderers")
        .join(&renderer_id);
    for source_file in sorted_files_under(&renderer_dir).map_err(|message| {
        build_error(
            "renderer_read_failed",
            message,
            "read",
            Some(format!("renderers/{renderer_id}")),
            Some(renderer_id.clone()),
            vec![],
        )
    })? {
        let Some(ext) = source_file.extension().and_then(|ext| ext.to_str()) else {
            continue;
        };
        if ext != "ts" && ext != "tsx" {
            continue;
        }
        let rel_file = source_file
            .strip_prefix(Path::new(&project.path))
            .map(|path| slash_path(path))
            .unwrap_or_else(|_| slash_path(&source_file));
        let file_source = fs::read_to_string(&source_file).map_err(|e| {
            build_error(
                "renderer_read_failed",
                format!("读取 renderer 源文件失败: {e}"),
                "read",
                Some(rel_file.clone()),
                Some(renderer_id.clone()),
                vec![],
            )
        })?;
        for specifier in collect_renderer_bare_imports(&file_source) {
            if renderer_import_allowed(&specifier) {
                continue;
            }
            let (line, column) = renderer_import_location(&file_source, &specifier);
            diagnostics.push(renderer_diagnostic(
                "renderer_unsupported_import",
                &renderer_id,
                "compile",
                "Renderer imports an unsupported bare module. V1 allows only React, React DOM, @vibegal/engine and relative imports.",
                Some(rel_file),
                Some(line),
                Some(column),
                renderer_source_line(&file_source, line),
            ));
            return Ok(RendererCheckOutput {
                ok: false,
                renderer_id,
                diagnostics,
            });
        }
    }

    if !source.contains("export default") {
        diagnostics.push(renderer_diagnostic(
            "renderer_missing_default_export",
            &renderer_id,
            "manifest",
            "Renderer entry must default-export a RendererManifest.",
            Some(file.clone()),
            Some(1),
            None,
            renderer_source_line(&source, 1),
        ));
    } else if let Some((actual_id, line)) = find_string_property(&source, "id") {
        if actual_id != renderer_id {
            diagnostics.push(renderer_diagnostic(
                "renderer_manifest_id_mismatch",
                &renderer_id,
                "manifest",
                format!("Renderer manifest id must be {renderer_id}, got {actual_id}."),
                Some(file.clone()),
                Some(line),
                None,
                renderer_source_line(&source, line),
            ));
        }
    }

    match find_number_property(&source, "contractVersion") {
        None => diagnostics.push(renderer_diagnostic(
            "renderer_contract_missing",
            &renderer_id,
            "contract",
            "Renderer manifest must declare contractVersion: 1.",
            Some(file.clone()),
            Some(1),
            None,
            renderer_source_line(&source, 1),
        )),
        Some((1, _)) => {}
        Some((version, line)) => diagnostics.push(renderer_diagnostic(
            "renderer_contract_unsupported",
            &renderer_id,
            "contract",
            format!("Unsupported renderer contractVersion: {version}."),
            Some(file.clone()),
            Some(line),
            None,
            renderer_source_line(&source, line),
        )),
    }

    if !diagnostics
        .iter()
        .any(|d| d.severity == RendererDiagnosticSeverity::Error)
        && options.compile
    {
        match renderer_compile_diagnostics(&options.project_path, &renderer_id) {
            Ok(worker_diagnostics) => diagnostics.extend(worker_diagnostics),
            Err(message) => diagnostics.push(renderer_diagnostic_with_severity(
                RendererDiagnosticSeverity::Warn,
                "renderer_compile_skipped",
                &renderer_id,
                "compile",
                format!("跳过真实编译检查（需要 node 与随 CLI 分发的 exporter）: {message}"),
                None,
                None,
                None,
                None,
            )),
        }
    }

    Ok(RendererCheckOutput {
        ok: !diagnostics
            .iter()
            .any(|d| d.severity == RendererDiagnosticSeverity::Error),
        renderer_id,
        diagnostics,
    })
}

fn built_at_iso() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    format!("unix:{secs}")
}

fn build_web_project(options: BuildOptions) -> Result<BuildOutput, BuildError> {
    emit_build_progress(
        options.progress,
        "validate",
        "start",
        "正在校验项目与构建配置",
        None,
    );
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
    let errors: Vec<_> = issues
        .iter()
        .filter(|issue| project_issue_is_error(issue))
        .collect();
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
    emit_build_progress(options.progress, "validate", "done", "项目校验完成", None);
    emit_build_progress(
        options.progress,
        "web-build",
        "start",
        "正在生成 Web 游戏资源",
        None,
    );

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
    let renderer_check = renderer_check_project(RendererCheckOptions {
        project_path: options.project_path.clone(),
        renderer_id: Some(renderer_id.clone()),
        // build 随后会跑完整 build worker（含 typecheck），这里只做静态检查避免重复编译。
        compile: false,
    })?;
    if !renderer_check.ok {
        return Err(build_error_from_renderer_diagnostics(
            renderer_check.diagnostics,
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

    copy_dir_recursive(
        &project_root.join("content"),
        &options.out_dir.join("content"),
    )
    .map_err(|message| {
        build_error(
            "copy_content_failed",
            message,
            "content",
            Some("content".to_string()),
            Some(renderer_id.clone()),
            vec![],
        )
    })?;

    let content_hash = content_tree_hash(&options.out_dir.join("content")).map_err(|message| {
        build_error(
            "hash_content_failed",
            message,
            "content",
            Some("content".to_string()),
            Some(renderer_id.clone()),
            vec![],
        )
    })?;
    let asset_manifest =
        build_asset_manifest_value(&options.out_dir.join("content"), &project.content.manifest)
            .map_err(|message| {
                build_error(
                    "write_asset_manifest_failed",
                    message,
                    "assets",
                    Some("asset.manifest.json".to_string()),
                    Some(renderer_id.clone()),
                    vec![],
                )
            })?;
    let asset_manifest_hash = write_json_file_and_hash(
        &options.out_dir.join("asset.manifest.json"),
        &asset_manifest,
    )
    .map_err(|message| {
        build_error(
            "write_asset_manifest_failed",
            message,
            "assets",
            Some("asset.manifest.json".to_string()),
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
    let stage = project
        .content
        .meta
        .get("stage")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({ "width": 1280, "height": 720 }));
    let built_at = built_at_iso();
    let game_manifest = serde_json::json!({
        "schemaVersion": 1,
        "projectId": project.meta.name,
        "title": title,
        "stage": stage,
        "rendererId": renderer_id.clone(),
        "rendererContractVersion": 1,
        "contractVersion": 1,
        "contentHash": content_hash,
        "assetManifestHash": asset_manifest_hash,
        "buildTarget": options.target.as_str(),
        "basePath": options.base_path.clone(),
        "builtAt": built_at,
        "vibegalBuildSchemaVersion": 1,
        "build": {
            "target": options.target.as_str(),
            "mode": "production",
            "basePath": options.base_path.clone(),
            "builtAt": built_at,
        },
    });
    write_json_file(&options.out_dir.join("game.manifest.json"), &game_manifest).map_err(
        |message| {
            build_error(
                "write_manifest_failed",
                message,
                "manifest",
                Some("game.manifest.json".to_string()),
                Some(renderer_id.clone()),
                vec![],
            )
        },
    )?;
    write_text_file(
        &options.out_dir.join("index.html"),
        r#"<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>VibeGal-Studio Export</title>
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
    emit_build_progress(
        options.progress,
        "web-build",
        "done",
        "Web 游戏资源构建完成",
        None,
    );

    Ok(BuildOutput {
        ok: true,
        target: options.target.as_str().to_string(),
        out_dir: options.out_dir.to_string_lossy().to_string(),
        renderer_id,
        runtime: None,
        mode: None,
        executable: None,
        artifacts: vec![],
        warnings: issues,
    })
}

fn build_desktop_project(options: BuildOptions) -> Result<BuildOutput, BuildError> {
    let runtime = selected_desktop_runtime(options.target, options.desktop_runtime)?
        .expect("desktop target always resolves a runtime");
    if options.base_path != "./" {
        return Err(build_error(
            "desktop_base_path_unsupported",
            "桌面构建使用固定相对 base path；请移除 --base-path 或传入 ./",
            "desktop",
            None,
            None,
            vec![],
        ));
    }
    ensure_export_out_dir_safe(Path::new(&options.project_path), &options.out_dir)?;

    let staging = std::env::temp_dir().join(format!(
        "vibegal-desktop-build-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    let web_dist = staging.join("web");
    fs::create_dir_all(&staging).map_err(|error| {
        build_error(
            "desktop_staging_failed",
            format!("创建桌面构建临时目录失败: {error}"),
            "desktop",
            None,
            None,
            vec![],
        )
    })?;

    let result = (|| {
        let mut web_options = options.clone();
        web_options.target = BuildTarget::Web;
        web_options.desktop_runtime = None;
        web_options.out_dir = web_dist.clone();
        web_options.base_path = "./".to_string();
        let web_output = build_web_project(web_options)?;
        let manifest_text =
            fs::read_to_string(web_dist.join("game.manifest.json")).map_err(|error| {
                build_error(
                    "desktop_manifest_read_failed",
                    format!("读取 Web build manifest 失败: {error}"),
                    "desktop",
                    Some("game.manifest.json".to_string()),
                    None,
                    vec![],
                )
            })?;
        let manifest: serde_json::Value =
            serde_json::from_str(&manifest_text).map_err(|error| {
                build_error(
                    "desktop_manifest_read_failed",
                    format!("解析 Web build manifest 失败: {error}"),
                    "desktop",
                    Some("game.manifest.json".to_string()),
                    None,
                    vec![],
                )
            })?;
        let product_name = manifest
            .get("title")
            .and_then(serde_json::Value::as_str)
            .filter(|title| !title.trim().is_empty())
            .unwrap_or("VibeGal Game");
        let package_message = match runtime {
            DesktopRuntime::Electron => {
                "正在打包 Electron 兼容模式；首次构建需下载 Electron 运行时，可能较慢"
            }
            DesktopRuntime::Tauri => "正在打包 Tauri 轻量模式",
        };
        emit_build_progress(
            options.progress,
            "desktop-package",
            "start",
            package_message,
            None,
        );
        let packaged = run_desktop_worker(runtime, &web_dist, &options.out_dir, product_name)?;
        if !packaged.ok || packaged.runtime != runtime.as_str() || packaged.mode != runtime.mode() {
            return Err(build_error(
                "desktop_worker_invalid_output",
                "桌面 build worker 返回的 runtime/mode 与请求不一致",
                "desktop",
                None,
                None,
                vec![],
            ));
        }
        emit_build_progress(
            options.progress,
            "desktop-package",
            "done",
            "桌面游戏打包完成",
            Some(100),
        );
        Ok(BuildOutput {
            ok: true,
            target: BuildTarget::Desktop.as_str().to_string(),
            out_dir: packaged.out_dir,
            renderer_id: web_output.renderer_id,
            runtime: Some(packaged.runtime),
            mode: Some(packaged.mode),
            executable: Some(packaged.executable),
            artifacts: packaged.artifacts,
            warnings: web_output.warnings,
        })
    })();
    let _ = fs::remove_dir_all(&staging);
    result
}

fn print_build_json<T: Serialize>(output: &T) {
    println!("{}", serde_json::to_string_pretty(output).unwrap());
}

fn print_build_json_line<T: Serialize>(output: &T) {
    println!("{}", serde_json::to_string(output).unwrap());
}

fn print_build_error_json<T: Serialize>(output: &T) {
    eprintln!("{}", serde_json::to_string_pretty(output).unwrap());
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
        eprintln!(
            "[{:?}] {} (code={})",
            issue.severity, issue.message, issue.code
        );
    }
}

fn run_build(options: BuildOptions, format: OutputFormat) -> i32 {
    if let Err(error) = validate_progress_output(options.progress, format) {
        print_build_error_json(&error);
        return 1;
    }
    let target = options.target;
    let progress = options.progress;
    let result = match target {
        BuildTarget::Web => selected_desktop_runtime(target, options.desktop_runtime)
            .and_then(|_| build_web_project(options)),
        BuildTarget::Desktop => build_desktop_project(options),
    };
    match result {
        Ok(output) => {
            match format {
                OutputFormat::Json if progress.is_some() => print_build_json_line(&output),
                OutputFormat::Json => print_build_json(&output),
                OutputFormat::Text => {
                    if let Some(runtime) = &output.runtime {
                        println!(
                            "✓ Desktop build 完成: {} (runtime={}, renderer={})",
                            output.out_dir, runtime, output.renderer_id
                        );
                    } else {
                        println!(
                            "✓ Web build 完成: {} (renderer={})",
                            output.out_dir, output.renderer_id
                        );
                    }
                }
            }
            0
        }
        Err(error) => {
            match format {
                OutputFormat::Json => print_build_error_json(&error),
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

fn run_renderer_check(options: RendererCheckOptions, format: OutputFormat) -> i32 {
    match renderer_check_project(options) {
        Ok(output) => {
            match format {
                OutputFormat::Json => print_build_json(&output),
                OutputFormat::Text => {
                    for diagnostic in &output.diagnostics {
                        let severity = match diagnostic.severity {
                            RendererDiagnosticSeverity::Error => "error",
                            RendererDiagnosticSeverity::Warn => "warn",
                        };
                        eprintln!(
                            "[{severity}] {} {} (renderer={}, step={})",
                            diagnostic.code,
                            diagnostic.message,
                            diagnostic.renderer_id,
                            diagnostic.step
                        );
                        if let Some(file) = &diagnostic.file {
                            if let (Some(line), Some(column)) = (diagnostic.line, diagnostic.column)
                            {
                                eprintln!("file: {file}:{line}:{column}");
                            } else {
                                eprintln!("file: {file}");
                            }
                        }
                    }
                    if output.ok {
                        println!("✓ Renderer check 通过: {}", output.renderer_id);
                    }
                }
            }
            if output.ok {
                0
            } else {
                1
            }
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

fn run_snapshot_worker(
    options: &RendererSnapshotOptions,
    renderer_id: &str,
) -> Result<SnapshotWorkerOutput, BuildError> {
    let worker = snapshot_worker_path().map_err(|message| {
        build_error(
            "snapshot_worker_unavailable",
            message,
            "worker",
            None,
            Some(renderer_id.to_string()),
            vec![],
        )
    })?;
    let output = Command::new(node_executable())
        .arg(&worker)
        .arg("--project")
        .arg(&options.project_path)
        .arg("--renderer")
        .arg(renderer_id)
        .arg("--out")
        .arg(&options.out_dir)
        .output()
        .map_err(|e| {
            build_error(
                "snapshot_worker_failed",
                format!("无法启动渲染层快照 worker: {e}"),
                "worker",
                None,
                Some(renderer_id.to_string()),
                vec![],
            )
        })?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    if output.status.success() {
        let start = stdout.find('{').ok_or_else(|| {
            build_error(
                "snapshot_worker_output_invalid",
                "快照 worker 未输出 JSON",
                "worker",
                None,
                Some(renderer_id.to_string()),
                vec![],
            )
        })?;
        return serde_json::from_str(&stdout[start..]).map_err(|e| {
            build_error(
                "snapshot_worker_output_invalid",
                format!("解析快照 worker 输出失败: {e}"),
                "worker",
                None,
                Some(renderer_id.to_string()),
                vec![],
            )
        });
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    if let Some(error) = parse_worker_error(&stderr, renderer_id, Path::new(&options.project_path))
    {
        return Err(error);
    }
    Err(build_error(
        "snapshot_worker_failed",
        stderr.trim().to_string(),
        "worker",
        None,
        Some(renderer_id.to_string()),
        vec![],
    ))
}

fn parse_snapshot_page_callback(target: &str) -> Option<(String, SnapshotPageReport)> {
    let (path, query) = target.split_once('?')?;
    if path != "/__vibegal_snapshot_result__" {
        return None;
    }
    let values = query
        .split('&')
        .filter_map(|field| {
            let (key, value) = field.split_once('=')?;
            let decoded = percent_decode_url_path(&value.replace('+', " "))?;
            Some((key, decoded))
        })
        .collect::<BTreeMap<_, _>>();
    Some((
        values.get("scene")?.clone(),
        SnapshotPageReport {
            status: values.get("status")?.clone(),
            error: values.get("message").cloned(),
        },
    ))
}

fn serve_snapshot_connection(
    mut stream: std::net::TcpStream,
    snapshot_root: &Path,
    content_root: &Path,
    reports: &std::sync::Arc<std::sync::Mutex<HashMap<String, SnapshotPageReport>>>,
) {
    use std::io::Read;

    if stream.set_nonblocking(false).is_err() {
        return;
    }
    let mut request = [0_u8; 8192];
    let Ok(read) = stream.read(&mut request) else {
        return;
    };
    let first_line = String::from_utf8_lossy(&request[..read]);
    let Some(raw_target) = first_line
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
    else {
        return;
    };
    if std::env::var_os("VIBEGAL_SMOKE_DEBUG").is_some() {
        eprintln!("[vibegal-snapshot] request {raw_target}");
    }
    if let Some((scene, report)) = parse_snapshot_page_callback(raw_target) {
        if let Ok(mut slot) = reports.lock() {
            slot.insert(scene, report);
        }
        let _ = stream.write_all(
            b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        );
        return;
    }
    let raw_path = raw_target.split('?').next().unwrap_or("/");
    let Some(decoded) = percent_decode_url_path(raw_path) else {
        return;
    };
    let relative = decoded.trim_start_matches('/');
    if relative.split('/').any(|part| part == "..") {
        return;
    }
    let (root, rel) = if let Some(content_rel) = relative.strip_prefix("content/") {
        (content_root, content_rel)
    } else {
        (snapshot_root, relative)
    };
    let requested = root.join(if rel.is_empty() { "index.html" } else { rel });
    let canonical_root = match root.canonicalize() {
        Ok(path) => path,
        Err(_) => return,
    };
    let canonical_file = match requested.canonicalize() {
        Ok(path) if path.starts_with(&canonical_root) && path.is_file() => path,
        _ => {
            let _ = stream.write_all(
                b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            );
            return;
        }
    };
    let Ok(body) = fs::read(&canonical_file) else {
        return;
    };
    let header = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        smoke_content_type(&canonical_file),
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(&body);
    let _ = stream.flush();
}

struct SnapshotSceneRun {
    png_exists: bool,
    timed_out: bool,
    timeout_secs: u64,
    spawn_error: Option<String>,
}

fn snapshot_browser_timeout() -> std::time::Duration {
    // 慢机器/CI 上 headless Chrome 截图可能超过默认 45s，
    // 可通过 VIBEGAL_SNAPSHOT_BROWSER_TIMEOUT_SECS 调高。
    const DEFAULT_SECS: u64 = 45;
    let secs = std::env::var("VIBEGAL_SNAPSHOT_BROWSER_TIMEOUT_SECS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|secs| *secs > 0)
        .unwrap_or(DEFAULT_SECS);
    std::time::Duration::from_secs(secs)
}

fn run_snapshot_browser_scene(
    browser: &str,
    url: &str,
    png_path: &Path,
    stage: &SnapshotStage,
) -> SnapshotSceneRun {
    let profile = std::env::temp_dir().join(format!(
        "vibegal-snapshot-browser-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    let mut command = Command::new(browser);
    command
        .arg("--headless=new")
        .arg("--disable-gpu")
        .arg("--disable-dev-shm-usage")
        .arg("--disable-background-networking")
        .arg("--disable-extensions")
        .arg("--no-first-run")
        .arg("--no-sandbox")
        .arg("--hide-scrollbars")
        .arg("--force-device-scale-factor=1")
        .arg("--mute-audio")
        .arg(format!("--window-size={},{}", stage.width, stage.height))
        .arg(format!("--screenshot={}", png_path.display()))
        .arg("--virtual-time-budget=10000")
        .arg(format!("--user-data-dir={}", profile.display()))
        .arg(url)
        .stdout(std::process::Stdio::null());
    if std::env::var_os("VIBEGAL_SMOKE_DEBUG").is_some() {
        command.stderr(std::process::Stdio::inherit());
    } else {
        command.stderr(std::process::Stdio::null());
    }
    let timeout = snapshot_browser_timeout();
    let result = match command.spawn() {
        Ok(mut process) => {
            let deadline = std::time::Instant::now() + timeout;
            let mut timed_out = false;
            // 部分平台/版本的 headless Chrome 写完截图后进程不退出
            // （本机 Chrome 150 macOS 复现：PNG 已生成但进程挂起 90s+）。
            // 截图文件出现即视为成功，给浏览器短暂优雅退出窗口后直接结束进程。
            let mut png_seen_at: Option<std::time::Instant> = None;
            loop {
                match process.try_wait() {
                    Ok(Some(_)) => break,
                    Ok(None) => {
                        if png_path.is_file() {
                            let seen_at = png_seen_at.get_or_insert_with(std::time::Instant::now);
                            if seen_at.elapsed() >= std::time::Duration::from_millis(1500) {
                                let _ = process.kill();
                                let _ = process.wait();
                                break;
                            }
                        } else if std::time::Instant::now() >= deadline {
                            timed_out = true;
                            let _ = process.kill();
                            let _ = process.wait();
                            break;
                        }
                        std::thread::sleep(std::time::Duration::from_millis(50));
                    }
                    Err(_) => break,
                }
            }
            SnapshotSceneRun {
                png_exists: png_path.is_file(),
                timed_out,
                timeout_secs: timeout.as_secs(),
                spawn_error: None,
            }
        }
        Err(error) => SnapshotSceneRun {
            png_exists: false,
            timed_out: false,
            timeout_secs: timeout.as_secs(),
            spawn_error: Some(error.to_string()),
        },
    };
    let _ = fs::remove_dir_all(&profile);
    result
}

fn classify_snapshot_scene(
    scene: &SnapshotWorkerScene,
    png_path: &Path,
    run: &SnapshotSceneRun,
    report: Option<SnapshotPageReport>,
    out_dir: &Path,
) -> SnapshotSceneResult {
    let file = png_path
        .strip_prefix(out_dir)
        .map(slash_path)
        .unwrap_or_else(|_| slash_path(png_path));
    let result = |status: &str, error: Option<String>| SnapshotSceneResult {
        id: scene.id.clone(),
        title: scene.title.clone(),
        file: file.clone(),
        status: status.to_string(),
        error,
    };
    if let Some(spawn_error) = &run.spawn_error {
        return result("error", Some(format!("启动浏览器失败: {spawn_error}")));
    }
    if run.timed_out {
        return result(
            "error",
            Some(format!("浏览器截图超时（{}s）", run.timeout_secs)),
        );
    }
    if !run.png_exists {
        return result("error", Some("浏览器未生成截图".to_string()));
    }
    match report {
        Some(SnapshotPageReport { status, .. }) if status == "ok" => result("ok", None),
        Some(SnapshotPageReport { error, .. }) => result(
            "error",
            Some(error.unwrap_or_else(|| "页面渲染失败".to_string())),
        ),
        None => result(
            "warning",
            Some("未收到页面状态回调（截图已生成，请人工确认）".to_string()),
        ),
    }
}

fn renderer_snapshot_project(
    options: RendererSnapshotOptions,
) -> Result<RendererSnapshotOutput, BuildError> {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};

    let project = app_lib::open_project_for_cli(&options.project_path).map_err(|message| {
        build_error(
            "open_project_failed",
            message,
            "discover",
            None,
            None,
            vec![],
        )
    })?;
    let renderer_id = options
        .renderer_id
        .clone()
        .unwrap_or_else(|| project.meta.active_renderer_id.clone());
    if !project.renderer_ids.iter().any(|id| id == &renderer_id) {
        return Err(build_error(
            "renderer_not_found",
            format!("渲染层不存在或缺少 index.tsx: {renderer_id}"),
            "discover",
            Some(format!("renderers/{renderer_id}/index.tsx")),
            Some(renderer_id),
            vec![],
        ));
    }
    // 静态契约检查先行（报错信息更好）；类型/编译细节由快照 worker 的 esbuild 覆盖。
    let check = renderer_check_project(RendererCheckOptions {
        project_path: options.project_path.clone(),
        renderer_id: Some(renderer_id.clone()),
        compile: false,
    })?;
    if !check.ok {
        return Err(build_error_from_renderer_diagnostics(check.diagnostics));
    }
    let worker_output = run_snapshot_worker(&options, &renderer_id)?;
    let browser = smoke_browser_executable().ok_or_else(|| {
        build_error(
            "snapshot_browser_unavailable",
            "渲染层快照需要 Chrome/Chromium/Edge；可通过 VIBEGAL_SMOKE_BROWSER 指定可执行文件",
            "browser",
            None,
            Some(renderer_id.clone()),
            vec![],
        )
    })?;

    let content_root = Path::new(&project.path).join("content");
    let snapshot_root = PathBuf::from(&worker_output.snapshot_dir);
    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|error| {
        build_error(
            "snapshot_server_failed",
            format!("启动本地快照服务器失败: {error}"),
            "server",
            None,
            Some(renderer_id.clone()),
            vec![],
        )
    })?;
    listener.set_nonblocking(true).map_err(|error| {
        build_error(
            "snapshot_server_failed",
            format!("配置本地快照服务器失败: {error}"),
            "server",
            None,
            Some(renderer_id.clone()),
            vec![],
        )
    })?;
    let address = listener.local_addr().map_err(|error| {
        build_error(
            "snapshot_server_failed",
            error.to_string(),
            "server",
            None,
            Some(renderer_id.clone()),
            vec![],
        )
    })?;
    let stop = Arc::new(AtomicBool::new(false));
    let reports = Arc::new(Mutex::new(HashMap::<String, SnapshotPageReport>::new()));
    let server = {
        let stop = Arc::clone(&stop);
        let reports = Arc::clone(&reports);
        let snapshot_root = snapshot_root.clone();
        let content_root = content_root.clone();
        std::thread::spawn(move || {
            while !stop.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let snapshot_root = snapshot_root.clone();
                        let content_root = content_root.clone();
                        let reports = Arc::clone(&reports);
                        std::thread::spawn(move || {
                            serve_snapshot_connection(
                                stream,
                                &snapshot_root,
                                &content_root,
                                &reports,
                            );
                        });
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(std::time::Duration::from_millis(10));
                    }
                    Err(_) => break,
                }
            }
        })
    };

    let mut scenes = Vec::new();
    for scene in &worker_output.scenes {
        let png_path = options
            .out_dir
            .join(format!("{renderer_id}-{}.png", scene.id));
        let url = format!("http://{address}/snapshot.html?scene={}", scene.id);
        let run = run_snapshot_browser_scene(&browser, &url, &png_path, &worker_output.stage);
        // 截图完成后给页面状态回调最多 3s 宽限
        let report = {
            let grace = std::time::Instant::now() + std::time::Duration::from_secs(3);
            loop {
                let found = reports
                    .lock()
                    .ok()
                    .and_then(|slot| slot.get(&scene.id).cloned());
                if found.is_some() {
                    break found;
                }
                if std::time::Instant::now() >= grace {
                    break None;
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
        };
        scenes.push(classify_snapshot_scene(
            scene,
            &png_path,
            &run,
            report,
            &options.out_dir,
        ));
    }

    stop.store(true, Ordering::Relaxed);
    let _ = server.join();

    let ok = scenes.iter().all(|scene| scene.status != "error");
    Ok(RendererSnapshotOutput {
        ok,
        renderer_id,
        out_dir: options.out_dir.to_string_lossy().to_string(),
        stage: worker_output.stage,
        scenes,
    })
}

fn run_renderer_snapshot(options: RendererSnapshotOptions, format: OutputFormat) -> i32 {
    match renderer_snapshot_project(options) {
        Ok(output) => {
            match format {
                OutputFormat::Json => print_build_json(&output),
                OutputFormat::Text => {
                    for scene in &output.scenes {
                        let mark = match scene.status.as_str() {
                            "ok" => "✓",
                            "warning" => "⚠",
                            _ => "✗",
                        };
                        println!("{mark} {} -> {}", scene.id, scene.file);
                        if let Some(error) = &scene.error {
                            eprintln!("    {error}");
                        }
                    }
                    if output.ok {
                        println!(
                            "✓ Renderer snapshot 完成: {}（{} 个场景）",
                            output.renderer_id,
                            output.scenes.len()
                        );
                    }
                }
            }
            if output.ok {
                0
            } else {
                1
            }
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

fn smoke_error(
    code: &str,
    message: impl Into<String>,
    step: &str,
    file: Option<&str>,
) -> SmokeError {
    SmokeError {
        ok: false,
        code: code.to_string(),
        message: message.into(),
        step: step.to_string(),
        file: file.map(|file| file.to_string()),
    }
}

fn smoke_required_file(
    dist_dir: &Path,
    rel_path: &str,
    code: &str,
    step: &str,
) -> Result<PathBuf, SmokeError> {
    let path = dist_dir.join(rel_path);
    if path.is_file() {
        Ok(path)
    } else {
        Err(smoke_error(
            code,
            format!("导出产物缺少必需文件: {rel_path}"),
            step,
            Some(rel_path),
        ))
    }
}

fn smoke_read_json(
    dist_dir: &Path,
    rel_path: &str,
    code: &str,
    step: &str,
) -> Result<serde_json::Value, SmokeError> {
    let path = smoke_required_file(dist_dir, rel_path, code, step)?;
    let text = fs::read_to_string(&path).map_err(|e| {
        smoke_error(
            code,
            format!("读取 JSON 失败 {rel_path}: {e}"),
            step,
            Some(rel_path),
        )
    })?;
    serde_json::from_str(&text).map_err(|e| {
        smoke_error(
            code,
            format!("解析 JSON 失败 {rel_path}: {e}"),
            step,
            Some(rel_path),
        )
    })
}

fn manifest_string<'a>(manifest: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    manifest.get(key).and_then(|value| value.as_str())
}

fn smoke_base_path(game_manifest: &serde_json::Value) -> Result<String, SmokeError> {
    let base_path = manifest_string(game_manifest, "basePath")
        .or_else(|| {
            game_manifest
                .pointer("/build/basePath")
                .and_then(|value| value.as_str())
        })
        .ok_or_else(|| {
            smoke_error(
                "smoke_missing_base_path",
                "game.manifest.json 缺少 basePath 元数据",
                "manifest",
                Some("game.manifest.json"),
            )
        })?;
    if base_path.is_empty() {
        return Err(smoke_error(
            "smoke_invalid_base_path",
            "game.manifest.json basePath 不能为空",
            "manifest",
            Some("game.manifest.json"),
        ));
    }
    if let Some(build_base_path) = game_manifest
        .pointer("/build/basePath")
        .and_then(|value| value.as_str())
    {
        if build_base_path != base_path {
            return Err(smoke_error(
                "smoke_base_path_mismatch",
                "game.manifest.json basePath 与 build.basePath 不一致",
                "manifest",
                Some("game.manifest.json"),
            ));
        }
    }
    Ok(base_path.to_string())
}

fn smoke_browser_executable() -> Option<String> {
    if let Ok(browser) = std::env::var("VIBEGAL_SMOKE_BROWSER") {
        if !browser.trim().is_empty() {
            return Some(browser);
        }
    }
    let mut candidates = vec![
        "google-chrome".to_string(),
        "chromium".to_string(),
        "chromium-browser".to_string(),
        "chrome".to_string(),
        "msedge".to_string(),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome".to_string(),
        "/Applications/Chromium.app/Contents/MacOS/Chromium".to_string(),
    ];
    for env_name in ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"] {
        if let Ok(root) = std::env::var(env_name) {
            candidates.push(
                Path::new(&root)
                    .join("Google/Chrome/Application/chrome.exe")
                    .to_string_lossy()
                    .to_string(),
            );
            // Edge 同为 Chromium，headless 截图参数兼容，Windows 机器自带。
            candidates.push(
                Path::new(&root)
                    .join("Microsoft/Edge/Application/msedge.exe")
                    .to_string_lossy()
                    .to_string(),
            );
        }
    }
    candidates.into_iter().find(|candidate| {
        browser_candidate_works(candidate)
    })
}

/// 用 --version 探测浏览器可执行文件是否可用。
///
/// 不能用 `.output()`：它会等管道 EOF，而 Chrome/Edge 可能留下
/// crashpad 之类的孙进程继承管道写端，EOF 永远不到（Windows CI 上
/// 曾因此挂死整个 smoke）。这里改用 null stdio + 轮询退出状态，
/// 整个探测有 10 秒上限。
fn browser_candidate_works(candidate: &str) -> bool {
    let Ok(mut child) = Command::new(candidate)
        .arg("--version")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
    else {
        return false;
    };
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(50));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
            Err(_) => return false,
        }
    }
}

fn percent_decode_url_path(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = std::str::from_utf8(bytes.get(index + 1..index + 3)?).ok()?;
            decoded.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

fn smoke_content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|extension| extension.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("js") | Some("mjs") => "text/javascript; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mp3") => "audio/mpeg",
        _ => "application/octet-stream",
    }
}

#[derive(Clone, Debug)]
struct BrowserSmokeReport {
    status: String,
    advanced: bool,
    branch: String,
    save_round_trip: bool,
    media: String,
    error: Option<String>,
}

fn parse_browser_smoke_callback(target: &str) -> Option<BrowserSmokeReport> {
    let (path, query) = target.split_once('?')?;
    if path != "/__vibegal_smoke_result__" {
        return None;
    }
    let values = query
        .split('&')
        .filter_map(|field| {
            let (key, value) = field.split_once('=')?;
            let decoded = percent_decode_url_path(&value.replace('+', " "))?;
            Some((key, decoded))
        })
        .collect::<BTreeMap<_, _>>();
    Some(BrowserSmokeReport {
        status: values.get("status")?.clone(),
        advanced: values.get("advance").is_some_and(|value| value == "true"),
        branch: values.get("branch").cloned().unwrap_or_default(),
        save_round_trip: values.get("save").is_some_and(|value| value == "true"),
        media: values.get("media").cloned().unwrap_or_default(),
        error: values.get("error").cloned(),
    })
}

/// 启动 smoke 本地文件服务器的 accept 线程。
///
/// 每个连接都在独立线程中处理：accept 线程绝不能被单个连接阻塞，否则
/// 浏览器打开的空闲/preconnect 连接会把 accept 线程永远卡在 read 上，
/// 进而让 join 在主线程永久阻塞（Windows CI 上曾复现为 job 跑满 6 小时超时）。
fn spawn_smoke_server(
    listener: std::net::TcpListener,
    root: PathBuf,
    report: std::sync::Arc<std::sync::Mutex<Option<BrowserSmokeReport>>>,
    stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> std::thread::JoinHandle<()> {
    use std::sync::atomic::Ordering;
    std::thread::spawn(move || {
        while !stop.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, _)) => {
                    let connection_root = root.clone();
                    let connection_report = std::sync::Arc::clone(&report);
                    std::thread::spawn(move || {
                        serve_smoke_connection(stream, &connection_root, &connection_report);
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                Err(_) => break,
            }
        }
    })
}

fn serve_smoke_connection(
    mut stream: std::net::TcpStream,
    root: &Path,
    report: &std::sync::Arc<std::sync::Mutex<Option<BrowserSmokeReport>>>,
) {
    use std::io::Read;

    if stream.set_nonblocking(false).is_err() {
        return;
    }
    // 空闲连接（例如浏览器 preconnect）不允许把处理线程永远卡住。
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(10)));
    let mut request = [0_u8; 8192];
    let Ok(read) = stream.read(&mut request) else {
        return;
    };
    let first_line = String::from_utf8_lossy(&request[..read]);
    let Some(raw_target) = first_line
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
    else {
        return;
    };
    if std::env::var_os("VIBEGAL_SMOKE_DEBUG").is_some() {
        eprintln!("[vibegal-smoke] request {raw_target}");
    }
    if let Some(callback) = parse_browser_smoke_callback(raw_target) {
        if let Ok(mut slot) = report.lock() {
            *slot = Some(callback);
        }
        let _ = stream.write_all(
            b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        );
        return;
    }
    let raw_path = raw_target.split('?').next().unwrap_or("/");
    let Some(decoded) = percent_decode_url_path(raw_path) else {
        return;
    };
    let relative = decoded.trim_start_matches('/');
    if relative.split('/').any(|part| part == "..") {
        return;
    }
    let requested = root.join(if relative.is_empty() {
        "index.html"
    } else {
        relative
    });
    let canonical_root = match root.canonicalize() {
        Ok(path) => path,
        Err(_) => return,
    };
    let canonical_file = match requested.canonicalize() {
        Ok(path) if path.starts_with(&canonical_root) && path.is_file() => path,
        _ => {
            let _ = stream.write_all(
                b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            );
            return;
        }
    };
    let Ok(body) = fs::read(&canonical_file) else {
        return;
    };
    let header = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        smoke_content_type(&canonical_file),
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(&body);
    let _ = stream.flush();
}

fn smoke_web_behavior(dist_dir: &Path) -> Result<(), SmokeError> {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};

    let browser = smoke_browser_executable().ok_or_else(|| {
        smoke_error(
            "smoke_browser_unavailable",
            "行为 smoke 需要 Chrome/Chromium/Edge；可通过 VIBEGAL_SMOKE_BROWSER 指定可执行文件",
            "behavior",
            None,
        )
    })?;
    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|error| {
        smoke_error(
            "smoke_server_failed",
            format!("启动本地 smoke 服务器失败: {error}"),
            "behavior",
            None,
        )
    })?;
    listener.set_nonblocking(true).map_err(|error| {
        smoke_error(
            "smoke_server_failed",
            format!("配置本地 smoke 服务器失败: {error}"),
            "behavior",
            None,
        )
    })?;
    let address = listener
        .local_addr()
        .map_err(|error| smoke_error("smoke_server_failed", error.to_string(), "behavior", None))?;
    let stop = Arc::new(AtomicBool::new(false));
    let report = Arc::new(Mutex::new(None::<BrowserSmokeReport>));
    let server = spawn_smoke_server(
        listener,
        dist_dir.to_path_buf(),
        Arc::clone(&report),
        Arc::clone(&stop),
    );
    eprintln!("[vibegal-smoke] behavior server listening on {address}");
    let profile = std::env::temp_dir().join(format!(
        "vibegal-smoke-browser-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    let url = format!("http://{address}/?vibegalSmoke=1");
    let debug = std::env::var_os("VIBEGAL_SMOKE_DEBUG").is_some();
    let mut browser_command = Command::new(&browser);
    browser_command
        .arg("--headless=new")
        .arg("--disable-gpu")
        .arg("--disable-dev-shm-usage")
        .arg("--disable-background-networking")
        .arg("--disable-extensions")
        .arg("--disable-component-extensions-with-background-pages")
        .arg("--no-first-run")
        .arg("--no-sandbox")
        .arg("--autoplay-policy=no-user-gesture-required")
        .arg(format!("--user-data-dir={}", profile.display()))
        .arg(&url)
        .stdout(std::process::Stdio::null());
    if debug {
        browser_command
            .arg("--remote-debugging-port=9225")
            .arg("--enable-logging=stderr")
            .stderr(std::process::Stdio::inherit());
        eprintln!("[vibegal-smoke] opening {url}");
    } else {
        browser_command.stderr(std::process::Stdio::null());
    }
    let child = browser_command.spawn();
    eprintln!("[vibegal-smoke] behavior browser launched: {browser}");
    let browser_result = match child {
        Ok(mut process) => {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
            loop {
                if let Some(callback) = report.lock().ok().and_then(|slot| slot.clone()) {
                    eprintln!(
                        "[vibegal-smoke] behavior report received: status={}",
                        callback.status
                    );
                    let _ = process.kill();
                    let _ = process.wait();
                    break Ok(callback);
                }
                match process.try_wait() {
                    Ok(Some(status)) => {
                        eprintln!("[vibegal-smoke] behavior browser exited early: {status}");
                        break Err(std::io::Error::other(format!(
                            "Chrome/Chromium behavior smoke exited before reporting ({status})"
                        )));
                    }
                    Ok(None) if std::time::Instant::now() < deadline => {
                        std::thread::sleep(std::time::Duration::from_millis(50));
                    }
                    Ok(None) => {
                        eprintln!("[vibegal-smoke] behavior browser timed out, killing");
                        let _ = process.kill();
                        let _ = process.wait();
                        break Err(std::io::Error::new(
                            std::io::ErrorKind::TimedOut,
                            "Chrome/Chromium behavior smoke timed out after 30 seconds",
                        ));
                    }
                    Err(error) => break Err(error),
                }
            }
        }
        Err(error) => Err(std::io::Error::new(error.kind(), error.to_string())),
    };
    stop.store(true, Ordering::Relaxed);
    let _ = server.join();
    let _ = fs::remove_dir_all(&profile);
    let report = browser_result.map_err(|error| {
        smoke_error(
            "smoke_browser_failed",
            format!("启动行为 smoke 浏览器失败: {error}"),
            "behavior",
            None,
        )
    })?;
    if report.status != "passed" {
        return Err(smoke_error(
            "smoke_behavior_failed",
            format!(
                "浏览器行为 smoke 未通过。{}",
                report.error.as_deref().unwrap_or("未生成通过结果")
            ),
            "behavior",
            Some("index.html"),
        ));
    }
    if !report.advanced
        || !report.save_round_trip
        || !matches!(report.branch.as_str(), "chosen" | "not-present")
    {
        return Err(smoke_error(
            "smoke_behavior_incomplete",
            "浏览器 smoke 未完成推进或存档往返",
            "behavior",
            Some("runtime/bundle.js"),
        ));
    }
    let manifest = smoke_read_json(
        dist_dir,
        "content/manifest.json",
        "smoke_missing_content_manifest",
        "behavior",
    )?;
    let has_media = manifest
        .get("cg")
        .and_then(|value| value.as_object())
        .is_some_and(|entries| !entries.is_empty())
        || manifest
            .get("videos")
            .and_then(|value| value.as_object())
            .is_some_and(|entries| !entries.is_empty());
    if has_media && report.media != "loaded" {
        return Err(smoke_error(
            "smoke_media_load_failed",
            "浏览器 smoke 未成功加载 manifest 中的媒体资源",
            "behavior",
            Some("content/manifest.json"),
        ));
    }
    Ok(())
}

fn smoke_web_dist(dist_dir: &Path) -> Result<SmokeOutput, SmokeError> {
    smoke_required_file(dist_dir, "index.html", "smoke_missing_index", "host")?;
    let index = fs::read_to_string(dist_dir.join("index.html")).map_err(|e| {
        smoke_error(
            "smoke_read_index_failed",
            format!("读取 index.html 失败: {e}"),
            "host",
            Some("index.html"),
        )
    })?;
    if !index.contains("runtime/bundle.js") {
        return Err(smoke_error(
            "smoke_index_missing_runtime_script",
            "index.html 未引用 runtime/bundle.js",
            "host",
            Some("index.html"),
        ));
    }

    let game_manifest = smoke_read_json(
        dist_dir,
        "game.manifest.json",
        "smoke_missing_game_manifest",
        "manifest",
    )?;
    smoke_required_file(
        dist_dir,
        "runtime/bundle.js",
        "smoke_missing_runtime_bundle",
        "runtime",
    )?;
    smoke_required_file(
        dist_dir,
        "content/graph.json",
        "smoke_missing_content_graph",
        "content",
    )?;
    let asset_manifest = smoke_read_json(
        dist_dir,
        "asset.manifest.json",
        "smoke_missing_asset_manifest",
        "assets",
    )?;

    let target = manifest_string(&game_manifest, "buildTarget")
        .or_else(|| {
            game_manifest
                .pointer("/build/target")
                .and_then(|value| value.as_str())
        })
        .unwrap_or("");
    if target != "web" {
        return Err(smoke_error(
            "smoke_target_mismatch",
            format!("game.manifest.json target 不是 web: {target}"),
            "manifest",
            Some("game.manifest.json"),
        ));
    }
    let base_path = smoke_base_path(&game_manifest)?;

    if let Some(expected) = manifest_string(&game_manifest, "assetManifestHash") {
        let actual = sha256_file(&dist_dir.join("asset.manifest.json")).map_err(|message| {
            smoke_error(
                "smoke_asset_manifest_hash_failed",
                message,
                "assets",
                Some("asset.manifest.json"),
            )
        })?;
        if actual != expected {
            return Err(smoke_error(
                "smoke_asset_manifest_hash_mismatch",
                "asset.manifest.json hash 与 game.manifest.json 不一致",
                "assets",
                Some("asset.manifest.json"),
            ));
        }
    }
    let assets = asset_manifest
        .get("assets")
        .and_then(|value| value.as_array())
        .ok_or_else(|| {
            smoke_error(
                "smoke_invalid_asset_manifest",
                "asset.manifest.json 缺少 assets 数组",
                "assets",
                Some("asset.manifest.json"),
            )
        })?;
    let mut seen_paths = BTreeSet::new();
    for asset in assets {
        let Some(path) = asset.get("path").and_then(|value| value.as_str()) else {
            return Err(smoke_error(
                "smoke_invalid_asset_manifest",
                "asset manifest entry 缺少 path",
                "assets",
                Some("asset.manifest.json"),
            ));
        };
        if path.starts_with('/') || path.split('/').any(|part| part == "..") {
            return Err(smoke_error(
                "smoke_invalid_manifest_asset_path",
                format!("asset path 必须是安全相对路径: {path}"),
                "assets",
                Some("asset.manifest.json"),
            ));
        }
        if !seen_paths.insert(path.to_string()) {
            return Err(smoke_error(
                "smoke_duplicate_manifest_asset",
                format!("asset path 重复: {path}"),
                "assets",
                Some("asset.manifest.json"),
            ));
        }
        let asset_path = dist_dir.join(path);
        if !asset_path.is_file() {
            return Err(smoke_error(
                "smoke_missing_manifest_asset",
                format!("asset.manifest.json 声明的资源不存在: {path}"),
                "assets",
                Some(path),
            ));
        }
        if let Some(expected_size) = asset.get("size").and_then(|value| value.as_u64()) {
            let actual_size = fs::metadata(&asset_path)
                .map(|metadata| metadata.len())
                .map_err(|e| {
                    smoke_error(
                        "smoke_asset_metadata_failed",
                        format!("读取资源信息失败 {path}: {e}"),
                        "assets",
                        Some(path),
                    )
                })?;
            if actual_size != expected_size {
                return Err(smoke_error(
                    "smoke_asset_size_mismatch",
                    format!("资源大小与 asset manifest 不一致: {path}"),
                    "assets",
                    Some(path),
                ));
            }
        }
        if let Some(expected_hash) = asset.get("sha256").and_then(|value| value.as_str()) {
            let actual_hash = sha256_file(&asset_path).map_err(|message| {
                smoke_error("smoke_asset_hash_failed", message, "assets", Some(path))
            })?;
            if actual_hash != expected_hash {
                return Err(smoke_error(
                    "smoke_asset_hash_mismatch",
                    format!("资源 hash 与 asset manifest 不一致: {path}"),
                    "assets",
                    Some(path),
                ));
            }
        }
    }

    if let Some(expected) = manifest_string(&game_manifest, "contentHash") {
        let actual = content_tree_hash(&dist_dir.join("content")).map_err(|message| {
            smoke_error(
                "smoke_content_hash_failed",
                message,
                "content",
                Some("content"),
            )
        })?;
        if actual != expected {
            return Err(smoke_error(
                "smoke_content_hash_mismatch",
                "contentHash 与 content/ 文件树不一致",
                "content",
                Some("content"),
            ));
        }
    }

    Ok(SmokeOutput {
        ok: true,
        target: "web".to_string(),
        dist_dir: dist_dir.to_string_lossy().to_string(),
        base_path,
        runtime: None,
        mode: None,
        checks: vec![
            "index".to_string(),
            "gameManifest".to_string(),
            "runtime".to_string(),
            "content".to_string(),
            "assets".to_string(),
            "basePath".to_string(),
        ],
    })
}

fn desktop_artifact_path(root: &Path, relative: &str, label: &str) -> Result<PathBuf, SmokeError> {
    let relative_path = Path::new(relative);
    if relative_path.is_absolute()
        || relative_path
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err(smoke_error(
            "smoke_desktop_manifest_path_unsafe",
            format!("desktop manifest 中的 {label} 路径不安全: {relative}"),
            "desktop",
            Some("desktop.manifest.json"),
        ));
    }
    Ok(root.join(relative_path))
}

/// 截取子进程输出的尾部用于错误诊断，避免把完整日志塞进 smoke 错误。
fn smoke_output_tail(output: &str) -> String {
    const LIMIT: usize = 400;
    let trimmed = output.trim();
    if trimmed.len() <= LIMIT {
        return trimmed.to_string();
    }
    let mut start = trimmed.len() - LIMIT;
    while !trimmed.is_char_boundary(start) {
        start += 1;
    }
    format!("…{}", &trimmed[start..])
}

fn run_desktop_shell_smoke(executable: &Path) -> Result<serde_json::Value, SmokeError> {
    run_desktop_shell_smoke_with_timeout(executable, Duration::from_secs(30))
}

/// 启动桌面 Player 并收集 smoke 结果。
///
/// stdout/stderr 重定向到临时文件而不是管道：桌面 Player 会派生孙进程
/// （Windows 上的 WebView2 helper、macOS 上的 WebContent 服务），孙进程会
/// 继承管道写端，等管道 EOF 会在 Player 退出后依然永久阻塞。
fn run_desktop_shell_smoke_with_timeout(
    executable: &Path,
    timeout: Duration,
) -> Result<serde_json::Value, SmokeError> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let output_dir = std::env::temp_dir().join(format!(
        "vibegal-desktop-smoke-{}-{stamp}",
        std::process::id()
    ));
    fs::create_dir_all(&output_dir).map_err(|error| {
        smoke_error(
            "smoke_desktop_failed",
            format!("创建桌面 Player smoke 输出目录失败: {error}"),
            "desktopBehavior",
            None,
        )
    })?;
    let stdout_path = output_dir.join("stdout.log");
    let stderr_path = output_dir.join("stderr.log");
    let stdout_file = fs::File::create(&stdout_path).map_err(|error| {
        let _ = fs::remove_dir_all(&output_dir);
        smoke_error(
            "smoke_desktop_failed",
            format!("创建桌面 Player smoke 输出文件失败: {error}"),
            "desktopBehavior",
            None,
        )
    })?;
    let stderr_file = fs::File::create(&stderr_path).map_err(|error| {
        let _ = fs::remove_dir_all(&output_dir);
        smoke_error(
            "smoke_desktop_failed",
            format!("创建桌面 Player smoke 输出文件失败: {error}"),
            "desktopBehavior",
            None,
        )
    })?;
    let mut command = Command::new(executable);
    command
        .env("VIBEGAL_DESKTOP_SMOKE", "1")
        .stdout(std::process::Stdio::from(stdout_file))
        .stderr(std::process::Stdio::from(stderr_file));
    let mut child = command.spawn().map_err(|error| {
        let _ = fs::remove_dir_all(&output_dir);
        smoke_error(
            "smoke_desktop_launch_failed",
            format!("启动桌面 Player 失败: {error}"),
            "desktopBehavior",
            None,
        )
    })?;
    let deadline = std::time::Instant::now() + timeout;
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(50));
            }
            Ok(None) => {
                timed_out = true;
                let _ = child.kill();
                match child.wait() {
                    Ok(status) => break status,
                    Err(error) => {
                        let _ = fs::remove_dir_all(&output_dir);
                        return Err(smoke_error(
                            "smoke_desktop_failed",
                            format!("等待桌面 Player smoke 失败: {error}"),
                            "desktopBehavior",
                            None,
                        ));
                    }
                }
            }
            Err(error) => {
                let _ = fs::remove_dir_all(&output_dir);
                return Err(smoke_error(
                    "smoke_desktop_failed",
                    format!("等待桌面 Player smoke 失败: {error}"),
                    "desktopBehavior",
                    None,
                ));
            }
        }
    };
    let stdout = fs::read_to_string(&stdout_path).unwrap_or_default();
    let stderr = fs::read_to_string(&stderr_path).unwrap_or_default();
    let _ = fs::remove_dir_all(&output_dir);
    if timed_out {
        let detail = smoke_output_tail(&stderr);
        return Err(smoke_error(
            "smoke_desktop_timeout",
            if detail.is_empty() {
                format!("桌面 Player smoke {timeout:?} 内未完成")
            } else {
                format!("桌面 Player smoke {timeout:?} 内未完成。{detail}")
            },
            "desktopBehavior",
            None,
        ));
    }
    let marker = "VIBEGAL_DESKTOP_SMOKE_RESULT=";
    let result = stdout
        .lines()
        .find_map(|line| line.strip_prefix(marker))
        .and_then(|json| serde_json::from_str::<serde_json::Value>(json).ok())
        .ok_or_else(|| {
            let mut detail = format!("进程退出状态: {status}");
            let stderr_tail = smoke_output_tail(&stderr);
            if !stderr_tail.is_empty() {
                detail.push_str(&format!("。stderr: {stderr_tail}"));
            }
            let stdout_tail = smoke_output_tail(&stdout);
            if !stdout_tail.is_empty() {
                detail.push_str(&format!("。stdout: {stdout_tail}"));
            }
            smoke_error(
                "smoke_desktop_incomplete",
                format!("桌面 Player 未返回 smoke 结果。{detail}"),
                "desktopBehavior",
                None,
            )
        })?;
    if result.get("status").and_then(serde_json::Value::as_str) != Some("passed") {
        return Err(smoke_error(
            "smoke_desktop_behavior_failed",
            format!(
                "桌面 Player 行为 smoke 未通过。{}",
                result
                    .get("error")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("未提供错误")
            ),
            "desktopBehavior",
            None,
        ));
    }
    Ok(result)
}

fn smoke_desktop_dist(dist_dir: &Path, runtime: DesktopRuntime) -> Result<SmokeOutput, SmokeError> {
    let manifest_path = dist_dir.join("desktop.manifest.json");
    let manifest_text = fs::read_to_string(&manifest_path).map_err(|error| {
        smoke_error(
            "smoke_missing_desktop_manifest",
            format!("读取 desktop.manifest.json 失败: {error}"),
            "desktop",
            Some("desktop.manifest.json"),
        )
    })?;
    let manifest: serde_json::Value = serde_json::from_str(&manifest_text).map_err(|error| {
        smoke_error(
            "smoke_invalid_desktop_manifest",
            format!("解析 desktop.manifest.json 失败: {error}"),
            "desktop",
            Some("desktop.manifest.json"),
        )
    })?;
    let actual_runtime = manifest
        .get("runtime")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    if actual_runtime != runtime.as_str() {
        return Err(smoke_error(
            "smoke_desktop_runtime_mismatch",
            format!(
                "桌面产物 runtime 不匹配: expected={}, actual={actual_runtime}",
                runtime.as_str()
            ),
            "desktop",
            Some("desktop.manifest.json"),
        ));
    }
    let web_relative = manifest
        .get("webDist")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| {
            smoke_error(
                "smoke_invalid_desktop_manifest",
                "desktop manifest 缺少 webDist",
                "desktop",
                Some("desktop.manifest.json"),
            )
        })?;
    let executable_relative = manifest
        .get("executable")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| {
            smoke_error(
                "smoke_invalid_desktop_manifest",
                "desktop manifest 缺少 executable",
                "desktop",
                Some("desktop.manifest.json"),
            )
        })?;
    let web_dist = desktop_artifact_path(dist_dir, web_relative, "webDist")?;
    let executable = desktop_artifact_path(dist_dir, executable_relative, "executable")?;
    if !executable.is_file() {
        return Err(smoke_error(
            "smoke_missing_desktop_executable",
            format!("桌面 Player 不存在: {}", executable.display()),
            "desktop",
            Some(executable_relative),
        ));
    }
    let web = smoke_web_dist(&web_dist)?;
    let _behavior = run_desktop_shell_smoke(&executable)?;
    Ok(SmokeOutput {
        ok: true,
        target: "desktop".to_string(),
        dist_dir: dist_dir.to_string_lossy().to_string(),
        base_path: web.base_path,
        runtime: Some(runtime.as_str().to_string()),
        mode: Some(runtime.mode().to_string()),
        checks: vec![
            "desktopManifest".to_string(),
            "desktopExecutable".to_string(),
            "webPayload".to_string(),
            "desktopBehavior".to_string(),
            "advance".to_string(),
            "saveRoundTrip".to_string(),
            "mediaLoad".to_string(),
        ],
    })
}

fn run_smoke(
    dist_dir: PathBuf,
    target: BuildTarget,
    runtime: Option<DesktopRuntime>,
    format: OutputFormat,
) -> i32 {
    let result = match target {
        BuildTarget::Web => {
            if runtime.is_some() {
                Err(smoke_error(
                    "desktop_runtime_not_applicable",
                    "--runtime 仅用于 --target desktop",
                    "desktop",
                    None,
                ))
            } else {
                smoke_web_dist(&dist_dir).and_then(|mut output| {
                    smoke_web_behavior(&dist_dir)?;
                    output.checks.push("browserBehavior".to_string());
                    output.checks.push("advance".to_string());
                    output.checks.push("saveRoundTrip".to_string());
                    output.checks.push("mediaLoad".to_string());
                    Ok(output)
                })
            }
        }
        BuildTarget::Desktop => {
            smoke_desktop_dist(&dist_dir, runtime.unwrap_or(DesktopRuntime::Electron))
        }
    };
    match result {
        Ok(output) => {
            match format {
                OutputFormat::Json => print_build_json(&output),
                OutputFormat::Text => {
                    if let Some(runtime) = &output.runtime {
                        println!(
                            "✓ Desktop smoke 通过: {} (runtime={runtime})",
                            output.dist_dir
                        );
                    } else {
                        println!(
                            "✓ Web smoke 通过: {} (basePath={})",
                            output.dist_dir, output.base_path
                        );
                    }
                }
            }
            0
        }
        Err(error) => {
            match format {
                OutputFormat::Json => print_build_error_json(&error),
                OutputFormat::Text => {
                    eprintln!("[{}] {} (step={})", error.code, error.message, error.step)
                }
            }
            1
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
            runtime,
            out_dir,
            renderer,
            strict,
            allow_warnings,
            base_path,
            format,
            progress,
        } => run_build(
            BuildOptions {
                project_path: path,
                target,
                desktop_runtime: runtime,
                out_dir,
                renderer_id: renderer,
                strict,
                allow_warnings,
                base_path,
                progress,
            },
            format,
        ),
        Commands::RendererCheck {
            path,
            renderer,
            no_compile,
            format,
        } => run_renderer_check(
            RendererCheckOptions {
                project_path: path,
                renderer_id: renderer,
                compile: !no_compile,
            },
            format,
        ),
        Commands::Smoke {
            dist_dir,
            target,
            runtime,
            format,
        } => run_smoke(dist_dir, target, runtime, format),
        Commands::RendererSnapshot {
            path,
            renderer,
            out_dir,
            format,
        } => run_renderer_snapshot(
            RendererSnapshotOptions {
                project_path: path,
                renderer_id: renderer,
                out_dir,
            },
            format,
        ),
        Commands::Doctor { format } => run_doctor(format),
        Commands::InstructionIds {
            command:
                InstructionIdsCommand::Assign {
                    project_path,
                    node,
                    dry_run,
                    format,
                },
        } => run_assign_instruction_ids(&project_path, node.as_deref(), dry_run, format),
        Commands::Node { command } => match command {
            NodeCommand::Insert {
                project_path,
                node_id,
                after,
                instruction_file,
                dry_run,
                format,
            } => match read_cli_json(&instruction_file, "read-instruction") {
                Ok(instruction) => run_node_mutation(
                    &project_path,
                    &node_id,
                    "insert",
                    NodeMutation::Insert { after, instruction },
                    dry_run,
                    format,
                ),
                Err(error) => {
                    emit_operation_error(&error, format);
                    error.exit_code
                }
            },
            NodeCommand::Update {
                project_path,
                node_id,
                story_point_id,
                patch_file,
                dry_run,
                format,
            } => match read_cli_json(&patch_file, "read-patch") {
                Ok(patch) => run_node_mutation(
                    &project_path,
                    &node_id,
                    "update",
                    NodeMutation::Update {
                        story_point_id,
                        patch,
                    },
                    dry_run,
                    format,
                ),
                Err(error) => {
                    emit_operation_error(&error, format);
                    error.exit_code
                }
            },
            NodeCommand::Move {
                project_path,
                node_id,
                story_point_id,
                before,
                dry_run,
                format,
            } => run_node_mutation(
                &project_path,
                &node_id,
                "move",
                NodeMutation::Move {
                    story_point_id,
                    before,
                },
                dry_run,
                format,
            ),
            NodeCommand::Duplicate {
                project_path,
                node_id,
                story_point_id,
                dry_run,
                format,
            } => run_node_mutation(
                &project_path,
                &node_id,
                "duplicate",
                NodeMutation::Duplicate { story_point_id },
                dry_run,
                format,
            ),
            NodeCommand::Delete {
                project_path,
                node_id,
                story_point_id,
                dry_run,
                format,
            } => run_node_mutation(
                &project_path,
                &node_id,
                "delete",
                NodeMutation::Delete { story_point_id },
                dry_run,
                format,
            ),
        },
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

    fn unique_temp_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "vibegal-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
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
        write_text(
            &root.join("content/nodes/start.json"),
            r#"[{"t":"narrate","text":"start"}]"#,
        );
        write_text(
            &root.join("content/nodes/end.json"),
            r#"[{"t":"narrate","text":"end"}]"#,
        );
        write_text(
            &root.join("renderers/default/index.tsx"),
            r#"export default { id: "default", name: "Default", contractVersion: 1, Component: () => null };"#,
        );
        write_text(
            &root.join("renderers/alt/index.tsx"),
            r#"export default { id: "alt", name: "Alt Selected Renderer", contractVersion: 1, Component: () => null };"#,
        );
    }

    fn add_manifest_assets(root: &std::path::Path) {
        write_text(
            &root.join("content/manifest.json"),
            r##"{"characters":{"hero":{"name":"Hero","color":"#ffffff","sprites":{"default":"assets/characters/hero_default.png"}}},"backgrounds":{"room":"assets/backgrounds/room.png"},"audio":{"bgm":{"theme":"assets/audio/bgm/theme.mp3"},"sfx":{},"voice":{}}}"##,
        );
        write_text(
            &root.join("content/assets/backgrounds/room.png"),
            "room image bytes",
        );
        write_text(
            &root.join("content/assets/characters/hero_default.png"),
            "hero sprite bytes",
        );
        write_text(
            &root.join("content/assets/audio/bgm/theme.mp3"),
            "theme audio bytes",
        );
    }

    fn build_options(project: &std::path::Path, out_dir: &std::path::Path) -> BuildOptions {
        BuildOptions {
            project_path: project.to_string_lossy().to_string(),
            target: BuildTarget::Web,
            desktop_runtime: None,
            out_dir: out_dir.to_path_buf(),
            renderer_id: None,
            strict: false,
            allow_warnings: false,
            base_path: "./".to_string(),
            progress: None,
        }
    }

    #[test]
    fn cli_allows_agents_to_select_each_desktop_runtime() {
        for (value, expected) in [
            ("electron", DesktopRuntime::Electron),
            ("tauri", DesktopRuntime::Tauri),
        ] {
            let cli = Cli::try_parse_from([
                "vibegal-cli",
                "build",
                "project",
                "--target",
                "desktop",
                "--runtime",
                value,
                "--out",
                "dist-game",
                "--format",
                "json",
            ])
            .expect("desktop build syntax should parse");
            let Commands::Build {
                target, runtime, ..
            } = cli.command
            else {
                panic!("expected build command");
            };
            assert_eq!(target, BuildTarget::Desktop);
            assert_eq!(runtime, Some(expected));
        }
    }

    #[test]
    fn cli_accepts_doctor_and_jsonl_build_progress_contracts() {
        let doctor = Cli::try_parse_from(["vibegal-cli", "doctor", "--format", "json"])
            .expect("doctor syntax should parse");
        assert!(matches!(
            doctor.command,
            Commands::Doctor {
                format: OutputFormat::Json
            }
        ));

        let build = Cli::try_parse_from([
            "vibegal-cli",
            "build",
            "project",
            "--target",
            "desktop",
            "--out",
            "dist-game",
            "--format",
            "json",
            "--progress",
            "jsonl",
        ])
        .expect("JSONL progress syntax should parse");
        let Commands::Build {
            progress, format, ..
        } = build.command
        else {
            panic!("expected build command");
        };
        assert_eq!(progress, Some(ProgressOutput::Jsonl));
        assert_eq!(format, OutputFormat::Json);
    }

    #[test]
    fn cli_accepts_instruction_id_assignment_contract() {
        let cli = Cli::try_parse_from([
            "vibegal-cli",
            "instruction-ids",
            "assign",
            "project",
            "--node",
            "start",
            "--dry-run",
            "--format",
            "json",
        ])
        .expect("instruction ID assignment syntax should parse");

        let Commands::InstructionIds {
            command:
                InstructionIdsCommand::Assign {
                    project_path,
                    node,
                    dry_run,
                    format,
                },
        } = cli.command
        else {
            panic!("expected instruction-ids assign command");
        };
        assert_eq!(project_path, "project");
        assert_eq!(node.as_deref(), Some("start"));
        assert!(dry_run);
        assert_eq!(format, OutputFormat::Json);
    }

    #[test]
    fn cli_accepts_all_stable_id_node_mutation_contracts() {
        let insert = Cli::try_parse_from([
            "vibegal-cli",
            "node",
            "insert",
            "project",
            "start",
            "--after",
            "sp_anchor",
            "--file",
            "instruction.json",
            "--dry-run",
            "--format",
            "json",
        ])
        .expect("node insert syntax should parse");
        assert!(matches!(
            insert.command,
            Commands::Node {
                command: NodeCommand::Insert {
                    project_path,
                    node_id,
                    after,
                    instruction_file,
                    dry_run: true,
                    format: OutputFormat::Json,
                }
            } if project_path == "project"
                && node_id == "start"
                && after == "sp_anchor"
                && instruction_file == PathBuf::from("instruction.json")
        ));

        let update = Cli::try_parse_from([
            "vibegal-cli",
            "node",
            "update",
            "project",
            "start",
            "sp_target",
            "--patch-file",
            "patch.json",
        ])
        .expect("node update syntax should parse");
        assert!(matches!(
            update.command,
            Commands::Node {
                command: NodeCommand::Update {
                    project_path,
                    node_id,
                    story_point_id,
                    patch_file,
                    dry_run: false,
                    format: OutputFormat::Text,
                }
            } if project_path == "project"
                && node_id == "start"
                && story_point_id == "sp_target"
                && patch_file == PathBuf::from("patch.json")
        ));

        let move_command = Cli::try_parse_from([
            "vibegal-cli",
            "node",
            "move",
            "project",
            "start",
            "sp_target",
            "--before",
            "sp_destination",
        ])
        .expect("node move syntax should parse");
        assert!(matches!(
            move_command.command,
            Commands::Node {
                command: NodeCommand::Move {
                    before,
                    dry_run: false,
                    ..
                }
            } if before == "sp_destination"
        ));

        for verb in ["duplicate", "delete"] {
            let cli = Cli::try_parse_from([
                "vibegal-cli",
                "node",
                verb,
                "project",
                "start",
                "sp_target",
                "--dry-run",
                "--format",
                "json",
            ])
            .unwrap_or_else(|error| panic!("node {verb} syntax should parse: {error}"));
            assert!(matches!(cli.command, Commands::Node { .. }));
        }
    }

    #[test]
    fn cli_rejects_incomplete_identity_and_node_mutation_commands() {
        for args in [
            vec!["vibegal-cli", "instruction-ids", "assign"],
            vec!["vibegal-cli", "node", "insert", "project", "start"],
            vec![
                "vibegal-cli",
                "node",
                "update",
                "project",
                "start",
                "sp_target",
            ],
            vec![
                "vibegal-cli",
                "node",
                "move",
                "project",
                "start",
                "sp_target",
            ],
        ] {
            assert!(Cli::try_parse_from(args).is_err());
        }
    }

    fn make_identity_project(root: &Path) {
        make_project(
            root,
            Some(
                r#"{"version":1,"entryNodeId":"start","nodes":[{"id":"start","title":"Start","file":"nodes/start.json","position":{"x":0,"y":0}},{"id":"end","title":"End","file":"nodes/end.json","position":{"x":200,"y":0}}],"edges":[]}"#,
            ),
        );
        write_text(
            &root.join("content/nodes/start.json"),
            r#"[{"t":"narrate","id":"first","text":"One"},{"t":"say","id":"second","who":"hero","text":"Two"},{"t":"pause","id":"third"},{"t":"narrate","text":"Missing"}]"#,
        );
        write_text(
            &root.join("content/nodes/end.json"),
            r#"[{"t":"narrate","text":"End"}]"#,
        );
    }

    #[test]
    fn instruction_id_assignment_preflights_dry_run_and_is_idempotent() {
        let root = unique_temp_dir("cli-assign-ids");
        make_identity_project(&root);
        let before = fs::read_to_string(root.join("content/nodes/start.json")).unwrap();

        let preview =
            assign_instruction_ids(root.to_string_lossy().as_ref(), Some("start"), true).unwrap();
        assert_eq!(preview.assigned_count, 1);
        assert!(preview.dry_run);
        assert_eq!(
            fs::read_to_string(root.join("content/nodes/start.json")).unwrap(),
            before
        );

        let applied = assign_instruction_ids(root.to_string_lossy().as_ref(), None, false).unwrap();
        assert_eq!(applied.assigned_count, 2);
        let second = assign_instruction_ids(root.to_string_lossy().as_ref(), None, false).unwrap();
        assert_eq!(second.assigned_count, 0);
        assert!(second.changed_files.is_empty());
        let start: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(root.join("content/nodes/start.json")).unwrap(),
        )
        .unwrap();
        assert!(start[3]["id"].as_str().unwrap().starts_with("sp_"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn instruction_id_assignment_closes_the_missing_id_validation_loop() {
        let root = unique_temp_dir("cli-assign-validate");
        make_identity_project(&root);
        write_text(
            &root.join("content/manifest.json"),
            r##"{"characters":{"hero":{"name":"Hero","color":"#ffffff","sprites":{"default":"assets/characters/hero.png"}}},"backgrounds":{},"audio":{"bgm":{},"sfx":{},"voice":{}}}"##,
        );
        write_text(
            &root.join("content/assets/characters/hero.png"),
            "hero image",
        );
        write_text(
            &root.join("content/graph.json"),
            r#"{"version":1,"entryNodeId":"start","nodes":[{"id":"start","title":"Start","file":"nodes/start.json","position":{"x":0,"y":0}},{"id":"end","title":"End","file":"nodes/end.json","position":{"x":200,"y":0}}],"edges":[{"id":"start-end","from":"start","to":"end","mode":"linear"}]}"#,
        );

        assert_eq!(
            run_validate(root.to_string_lossy().as_ref(), OutputFormat::Json),
            2,
            "the fixture should initially report missing-ID warnings"
        );

        let assigned =
            assign_instruction_ids(root.to_string_lossy().as_ref(), None, false).unwrap();
        assert_eq!(assigned.assigned_count, 2);
        assert_eq!(
            run_validate(root.to_string_lossy().as_ref(), OutputFormat::Json),
            0,
            "assign followed by validate should produce a clean project"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn instruction_id_assignment_preserves_existing_and_duplicate_ids() {
        let root = unique_temp_dir("cli-assign-preserve-ids");
        make_identity_project(&root);
        write_text(
            &root.join("content/nodes/start.json"),
            r#"[{"t":"narrate","id":"manual","text":"Manual"},{"t":"say","id":"duplicate","who":"hero","text":"One"},{"t":"pause","id":"duplicate"},{"t":"wait","id":"","ms":10}]"#,
        );
        write_text(
            &root.join("content/nodes/end.json"),
            r#"[{"t":"narrate","id":"end","text":"End"}]"#,
        );

        let assigned =
            assign_instruction_ids(root.to_string_lossy().as_ref(), None, false).unwrap();
        assert_eq!(assigned.assigned_count, 1);

        let saved: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(root.join("content/nodes/start.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(saved[0]["id"], "manual");
        assert_eq!(saved[1]["id"], "duplicate");
        assert_eq!(saved[2]["id"], "duplicate");
        assert!(saved[3]["id"].as_str().unwrap().starts_with("sp_"));
        assert_eq!(
            run_validate(root.to_string_lossy().as_ref(), OutputFormat::Json),
            1,
            "assign must leave duplicate ownership for validation to report"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn instruction_id_assignment_json_output_has_a_stable_machine_contract() {
        let output = InstructionIdAssignOutput {
            ok: true,
            project_path: "C:/project".into(),
            dry_run: false,
            assigned_count: 1,
            changed_files: vec![InstructionIdChangedFile {
                file: "content/nodes/start.json".into(),
                assigned: vec![app_lib::AssignedInstructionId {
                    file: "content/nodes/start.json".into(),
                    node_id: "start".into(),
                    json_path: "$[0].id".into(),
                    id: "sp_test".into(),
                }],
            }],
        };
        let json = serde_json::to_value(output).unwrap();

        assert_eq!(json["ok"], true);
        assert_eq!(json["projectPath"], "C:/project");
        assert_eq!(json["dryRun"], false);
        assert_eq!(json["assignedCount"], 1);
        assert_eq!(json["changedFiles"][0]["file"], "content/nodes/start.json");
        assert_eq!(json["changedFiles"][0]["assigned"][0]["nodeId"], "start");
        assert_eq!(
            json["changedFiles"][0]["assigned"][0]["jsonPath"],
            "$[0].id"
        );
    }

    #[test]
    fn assignment_ignores_orphan_node_files() {
        let root = unique_temp_dir("cli-assign-orphan");
        make_identity_project(&root);
        let orphan = root.join("content/nodes/orphan.json");
        write_text(&orphan, r#"[{"t":"narrate","text":"Orphan"}]"#);
        let before = fs::read_to_string(&orphan).unwrap();

        assign_instruction_ids(root.to_string_lossy().as_ref(), None, false).unwrap();

        assert_eq!(fs::read_to_string(&orphan).unwrap(), before);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn assignment_preflight_failure_does_not_write_other_nodes() {
        let root = unique_temp_dir("cli-assign-preflight");
        make_identity_project(&root);
        let start_before = fs::read_to_string(root.join("content/nodes/start.json")).unwrap();
        write_text(&root.join("content/nodes/end.json"), "not json");

        let error = assign_instruction_ids(root.to_string_lossy().as_ref(), None, false)
            .expect_err("all files must pass preflight before writes begin");
        assert_eq!(error.exit_code, 70);
        assert_eq!(
            fs::read_to_string(root.join("content/nodes/start.json")).unwrap(),
            start_before
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn assignment_write_failure_reports_files_modified_before_the_failure() {
        let root = unique_temp_dir("cli-assign-partial-write");
        make_identity_project(&root);
        let (project_path, planned) =
            preflight_identity_assignment(root.to_string_lossy().as_ref(), None).unwrap();
        let mut writes = 0;

        let error = execute_identity_assignment_plan(
            &project_path,
            planned,
            false,
            |_project_path, _plan| {
                writes += 1;
                if writes == 2 {
                    Err("injected second write failure".to_string())
                } else {
                    Ok(())
                }
            },
        )
        .expect_err("the second node write should fail after the first succeeds");

        assert_eq!(error.code, "instruction_id_write_failed");
        assert_eq!(error.file.as_deref(), Some("content/nodes/end.json"));
        assert_eq!(error.modified_files, vec!["content/nodes/start.json"]);
        assert_eq!(
            serde_json::to_value(&error).unwrap()["modifiedFiles"],
            serde_json::json!(["content/nodes/start.json"])
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn assignment_rejects_traversing_node_paths_without_writing_safe_nodes() {
        let root = unique_temp_dir("cli-assign-path-traversal");
        make_project(
            &root,
            Some(
                r#"{"version":1,"entryNodeId":"start","nodes":[{"id":"start","title":"Start","file":"nodes/start.json","position":{"x":0,"y":0}},{"id":"escape","title":"Escape","file":"../outside.json","position":{"x":200,"y":0}}],"edges":[]}"#,
            ),
        );
        let safe_node = root.join("content/nodes/start.json");
        write_text(&safe_node, r#"[{"t":"narrate","text":"Missing"}]"#);
        write_text(
            &root.join("outside.json"),
            r#"[{"t":"narrate","text":"Outside"}]"#,
        );
        let before = fs::read_to_string(&safe_node).unwrap();

        let error = assign_instruction_ids(root.to_string_lossy().as_ref(), None, false)
            .expect_err("path traversal must fail before assignment writes begin");

        assert_eq!(error.exit_code, 70);
        assert_eq!(fs::read_to_string(&safe_node).unwrap(), before);
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn assignment_rejects_symlinked_node_files_without_writing_safe_nodes() {
        use std::os::unix::fs::symlink;

        let root = unique_temp_dir("cli-assign-symlink");
        make_identity_project(&root);
        let safe_node = root.join("content/nodes/start.json");
        let before = fs::read_to_string(&safe_node).unwrap();
        let external = root.join("external.json");
        write_text(&external, r#"[{"t":"narrate","text":"External"}]"#);
        fs::remove_file(root.join("content/nodes/end.json")).unwrap();
        symlink(&external, root.join("content/nodes/end.json")).unwrap();

        assign_instruction_ids(root.to_string_lossy().as_ref(), None, false)
            .expect_err("node symlinks must fail before assignment writes begin");

        assert_eq!(fs::read_to_string(&safe_node).unwrap(), before);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn assignment_rejects_contract_invalid_graph_as_a_preflight_failure() {
        let root = unique_temp_dir("cli-assign-invalid-graph");
        make_project(&root, Some(r#"{"version":1,"nodes":[],"edges":[]}"#));

        let error = assign_instruction_ids(root.to_string_lossy().as_ref(), None, false)
            .expect_err("invalid graph must not be treated as a successful zero-change run");

        assert_eq!(error.code, "graph_preflight_failed");
        assert_eq!(error.file.as_deref(), Some("content/graph.json"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn pure_node_mutations_follow_stable_identity_semantics() {
        let original = serde_json::json!([
            { "t": "narrate", "id": "first", "text": "One" },
            { "t": "say", "id": "second", "who": "hero", "text": "Two", "meta": { "mood": "calm" } },
            { "t": "pause", "id": "third" }
        ]);

        let inserted = mutate_node_value(
            &original,
            NodeMutation::Insert {
                after: "first".into(),
                instruction: serde_json::json!({
                    "t": "narrate", "id": "must-not-survive", "text": "Inserted"
                }),
            },
        )
        .unwrap();
        assert_eq!(inserted.instructions[1]["text"], "Inserted");
        assert!(inserted.instructions[1].get("id").is_none());

        let updated = mutate_node_value(
            &original,
            NodeMutation::Update {
                story_point_id: "second".into(),
                patch: serde_json::json!({ "text": "Changed", "meta": { "mood": "happy" } }),
            },
        )
        .unwrap();
        assert_eq!(updated.instructions[1]["id"], "second");
        assert_eq!(updated.instructions[1]["t"], "say");
        assert_eq!(updated.instructions[1]["text"], "Changed");
        assert_eq!(updated.instructions[1]["meta"]["mood"], "happy");

        let moved = mutate_node_value(
            &original,
            NodeMutation::Move {
                story_point_id: "third".into(),
                before: "first".into(),
            },
        )
        .unwrap();
        assert_eq!(moved.instructions[0]["id"], "third");
        assert_eq!(moved.before_index, Some(2));
        assert_eq!(moved.after_index, Some(0));

        let duplicated = mutate_node_value(
            &original,
            NodeMutation::Duplicate {
                story_point_id: "second".into(),
            },
        )
        .unwrap();
        assert_eq!(duplicated.instructions[2]["text"], "Two");
        assert!(duplicated.instructions[2].get("id").is_none());

        let deleted = mutate_node_value(
            &original,
            NodeMutation::Delete {
                story_point_id: "second".into(),
            },
        )
        .unwrap();
        assert_eq!(deleted.instructions.as_array().unwrap().len(), 2);
        assert_eq!(deleted.instructions[1]["id"], "third");
    }

    #[test]
    fn node_mutations_reject_ambiguous_targets_and_identity_changes() {
        let duplicate = serde_json::json!([
            { "t": "narrate", "id": "same", "text": "One" },
            { "t": "pause", "id": "same" }
        ]);
        let error = mutate_node_value(
            &duplicate,
            NodeMutation::Delete {
                story_point_id: "same".into(),
            },
        )
        .unwrap_err();
        assert_eq!(error.code, "story_point_id_duplicate");

        let unrelated_duplicate = serde_json::json!([
            { "t": "narrate", "id": "target", "text": "Target" },
            { "t": "pause", "id": "unrelated" },
            { "t": "wait", "id": "unrelated", "ms": 10 }
        ]);
        let error = mutate_node_value(
            &unrelated_duplicate,
            NodeMutation::Delete {
                story_point_id: "target".into(),
            },
        )
        .unwrap_err();
        assert_eq!(error.code, "story_point_id_duplicate");

        let original = serde_json::json!([
            { "t": "say", "id": "target", "who": "hero", "text": "Two" }
        ]);
        for patch in [
            serde_json::json!({ "id": "other" }),
            serde_json::json!({ "t": "narrate" }),
        ] {
            let error = mutate_node_value(
                &original,
                NodeMutation::Update {
                    story_point_id: "target".into(),
                    patch,
                },
            )
            .unwrap_err();
            assert_eq!(error.code, "protected_field_change");
        }

        let error = mutate_node_value(
            &original,
            NodeMutation::Insert {
                after: "target".into(),
                instruction: serde_json::json!({ "t": "bg", "ref": "school" }),
            },
        )
        .unwrap_err();
        assert_eq!(error.code, "instruction_not_story_point");
    }

    #[test]
    fn node_mutation_reports_the_created_id_when_earlier_ids_are_also_missing() {
        let root = unique_temp_dir("cli-mutation-created-id");
        make_identity_project(&root);
        write_text(
            &root.join("content/nodes/start.json"),
            r#"[{"t":"narrate","text":"Earlier missing"},{"t":"pause","id":"anchor"}]"#,
        );

        let output = execute_node_mutation(
            root.to_string_lossy().as_ref(),
            "start",
            "duplicate",
            NodeMutation::Duplicate {
                story_point_id: "anchor".into(),
            },
            false,
        )
        .unwrap();

        assert_eq!(output.assigned.len(), 2);
        let created = output.new_story_point_id.as_deref().unwrap();
        assert_eq!(
            output
                .assigned
                .iter()
                .find(|item| item.json_path == "$[2].id")
                .map(|item| item.id.as_str()),
            Some(created)
        );
        assert_ne!(created, output.assigned[0].id);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn node_mutation_json_output_has_a_stable_machine_contract() {
        let output = NodeMutationOutput {
            ok: true,
            operation: "move".into(),
            project_path: "C:/project".into(),
            node_id: "start".into(),
            file: "content/nodes/start.json".into(),
            dry_run: false,
            story_point_id: Some("sp_target".into()),
            new_story_point_id: Some("sp_created".into()),
            before_index: Some(3),
            after_index: Some(1),
            new_revision: Some(serde_json::json!({
                "relPath": "content/nodes/start.json",
                "mtimeMs": 1234.0,
                "size": 42
            })),
            assigned: vec![app_lib::AssignedInstructionId {
                file: "content/nodes/start.json".into(),
                node_id: "start".into(),
                json_path: "$[1].id".into(),
                id: "sp_created".into(),
            }],
        };

        let json = serde_json::to_value(output).unwrap();
        assert_eq!(json["ok"], true);
        assert_eq!(json["operation"], "move");
        assert_eq!(json["projectPath"], "C:/project");
        assert_eq!(json["nodeId"], "start");
        assert_eq!(json["storyPointId"], "sp_target");
        assert_eq!(json["newStoryPointId"], "sp_created");
        assert_eq!(json["beforeIndex"], 3);
        assert_eq!(json["afterIndex"], 1);
        assert_eq!(json["newRevision"]["relPath"], "content/nodes/start.json");
        assert_eq!(json["assigned"][0]["jsonPath"], "$[1].id");
        assert!(json.get("project_path").is_none());
        assert!(json.get("story_point_id").is_none());
    }

    #[test]
    fn node_mutation_execution_persists_all_five_operations_and_dry_run_is_read_only() {
        let root = unique_temp_dir("cli-mutation-e2e");
        make_identity_project(&root);
        let before = fs::read_to_string(root.join("content/nodes/start.json")).unwrap();
        let preview = execute_node_mutation(
            root.to_string_lossy().as_ref(),
            "start",
            "move",
            NodeMutation::Move {
                story_point_id: "third".into(),
                before: "first".into(),
            },
            true,
        )
        .unwrap();
        assert!(preview.new_revision.is_none());
        assert_eq!(
            fs::read_to_string(root.join("content/nodes/start.json")).unwrap(),
            before
        );

        let instruction_file_value = serde_json::json!({
            "t": "narrate", "id": "discard-this", "text": "Inserted"
        });
        let inserted = execute_node_mutation(
            root.to_string_lossy().as_ref(),
            "start",
            "insert",
            NodeMutation::Insert {
                after: "first".into(),
                instruction: instruction_file_value,
            },
            false,
        )
        .unwrap();
        let inserted_id = inserted.new_story_point_id.unwrap();
        assert!(inserted.new_revision.is_some());

        execute_node_mutation(
            root.to_string_lossy().as_ref(),
            "start",
            "update",
            NodeMutation::Update {
                story_point_id: inserted_id.clone(),
                patch: serde_json::json!({ "text": "Updated" }),
            },
            false,
        )
        .unwrap();
        execute_node_mutation(
            root.to_string_lossy().as_ref(),
            "start",
            "move",
            NodeMutation::Move {
                story_point_id: "third".into(),
                before: "first".into(),
            },
            false,
        )
        .unwrap();
        let duplicate = execute_node_mutation(
            root.to_string_lossy().as_ref(),
            "start",
            "duplicate",
            NodeMutation::Duplicate {
                story_point_id: inserted_id.clone(),
            },
            false,
        )
        .unwrap();
        let duplicate_id = duplicate.new_story_point_id.unwrap();
        assert_ne!(duplicate_id, inserted_id);
        execute_node_mutation(
            root.to_string_lossy().as_ref(),
            "start",
            "delete",
            NodeMutation::Delete {
                story_point_id: inserted_id.clone(),
            },
            false,
        )
        .unwrap();

        let saved: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(root.join("content/nodes/start.json")).unwrap(),
        )
        .unwrap();
        assert!(saved.as_array().unwrap().iter().all(|instruction| {
            instruction.get("id").and_then(serde_json::Value::as_str) != Some(&inserted_id)
        }));
        let duplicated = saved
            .as_array()
            .unwrap()
            .iter()
            .find(|instruction| {
                instruction.get("id").and_then(serde_json::Value::as_str) == Some(&duplicate_id)
            })
            .unwrap();
        assert_eq!(duplicated["text"], "Updated");
        assert_eq!(saved[0]["id"], "third");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn node_mutation_dry_run_rejects_contract_invalid_results_without_writing() {
        let root = unique_temp_dir("cli-mutation-dry-run-invalid");
        make_identity_project(&root);
        let before = fs::read_to_string(root.join("content/nodes/start.json")).unwrap();

        let error = execute_node_mutation(
            root.to_string_lossy().as_ref(),
            "start",
            "update",
            NodeMutation::Update {
                story_point_id: "second".into(),
                patch: serde_json::json!({ "who": null }),
            },
            true,
        )
        .expect_err("dry-run must validate the normalized result");

        assert_eq!(error.code, "node_mutation_invalid");
        assert_eq!(
            fs::read_to_string(root.join("content/nodes/start.json")).unwrap(),
            before
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn jsonl_progress_requires_json_result_format() {
        let error = validate_progress_output(Some(ProgressOutput::Jsonl), OutputFormat::Text)
            .expect_err("text output must reject JSONL progress");
        assert_eq!(error.code, "build_progress_requires_json");
        assert_eq!(error.step, "progress");
        validate_progress_output(Some(ProgressOutput::Jsonl), OutputFormat::Json)
            .expect("JSON output should accept JSONL progress");
        validate_progress_output(None, OutputFormat::Text)
            .expect("the legacy no-progress behavior must remain valid");
    }

    #[test]
    fn progress_events_are_single_line_machine_readable_json() {
        let line = progress_json_line(
            "desktop-package",
            "start",
            "首次构建需下载 Electron 运行时，可能较慢",
            None,
        );
        assert!(!line.contains('\n'));
        let value: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(value["type"], "progress");
        assert_eq!(value["step"], "desktop-package");
        assert_eq!(value["phase"], "start");
        assert!(value["percent"].is_null());
    }

    #[test]
    fn doctor_reports_fixed_runtime_cache_and_injected_node_probe() {
        let root = unique_temp_dir("doctor-cache");
        let marker = electron_runtime_cache_dir_for(&root).join(".vibegal-runtime-ready");
        write_text(&marker, ELECTRON_RUNTIME_VERSION);
        assert!(electron_runtime_is_cached_at(&root));

        let node = probe_node_with("C:/tools/node", "env", |_| Some("v22.14.0\n".to_string()));
        assert!(node.available);
        assert_eq!(node.version.as_deref(), Some("v22.14.0"));
        assert_eq!(node.source.as_deref(), Some("env"));
        assert_eq!(node.path.as_deref(), Some("C:/tools/node"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn desktop_build_defaults_to_compatible_electron_runtime() {
        assert_eq!(
            selected_desktop_runtime(BuildTarget::Desktop, None).unwrap(),
            Some(DesktopRuntime::Electron)
        );
        assert_eq!(
            selected_desktop_runtime(BuildTarget::Web, None).unwrap(),
            None
        );
    }

    #[test]
    fn web_build_rejects_a_desktop_runtime_flag() {
        let error = selected_desktop_runtime(BuildTarget::Web, Some(DesktopRuntime::Tauri))
            .expect_err("web build should reject desktop-only runtime selection");
        assert_eq!(error.code, "desktop_runtime_not_applicable");
        assert_eq!(error.step, "desktop");
    }

    #[test]
    fn export_path_safety_rejects_project_ancestors_and_source_directories() {
        let outer = unique_temp_dir("cli-build-path-safety");
        let project = outer.join("project");
        make_project(&project, None);

        for unsafe_out in [
            outer.clone(),
            project.join("content/export"),
            project.join("renderers/export"),
        ] {
            let error = ensure_export_out_dir_safe(&project, &unsafe_out)
                .expect_err("build output must never erase a project ancestor or source directory");
            assert_eq!(error.code, "build_path_error");
        }
        ensure_export_out_dir_safe(&project, &project.join("dist-game"))
            .expect("a conventional output directory in the project root is safe");
        ensure_export_out_dir_safe(&project, &outer.join("release"))
            .expect("a sibling output directory is safe");
        let _ = std::fs::remove_dir_all(&outer);
    }

    fn renderer_check_options(
        project: &std::path::Path,
        renderer_id: Option<&str>,
    ) -> RendererCheckOptions {
        RendererCheckOptions {
            project_path: project.to_string_lossy().to_string(),
            renderer_id: renderer_id.map(|id| id.to_string()),
            compile: true,
        }
    }

    #[test]
    fn validate_returns_zero_for_clean_graph() {
        let dir = std::env::temp_dir().join(format!(
            "vibegal-cli-ok-{}",
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
            "vibegal-cli-err-{}",
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
            "vibegal-cli-warn-{}",
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
            "vibegal-cli-bad-{}",
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
            "vibegal-cli-json-{}",
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
            "vibegal-cli-node-json-{}",
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
    fn validate_cli_matches_shared_node_contract_fixture() {
        let fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../contracts/fixtures/node-semantic-contract.json");
        let fixture: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(fixture_path).unwrap()).unwrap();
        let dir = unique_temp_dir("cli-node-contract");
        make_project(
            &dir,
            Some(
                r#"{"version":1,"entryNodeId":"a","nodes":[{"id":"a","title":"A","file":"nodes/a.json","position":{"x":0,"y":0}}],"edges":[]}"#,
            ),
        );
        write_text(
            &dir.join("content/manifest.json"),
            &serde_json::to_string(&fixture["manifest"]).unwrap(),
        );
        write_text(
            &dir.join("content/nodes/a.json"),
            &serde_json::to_string(&fixture["instructions"]).unwrap(),
        );

        let project = app_lib::open_project_for_cli(dir.to_string_lossy().as_ref()).unwrap();
        let mut actual = project
            .project_report
            .unwrap()
            .project_issues
            .iter()
            .filter(|issue| issue.source == "node")
            .map(|issue| {
                serde_json::json!({
                    "code": issue.code,
                    "severity": match issue.severity {
                        app_lib::GraphIssueSeverity::Error => "error",
                        app_lib::GraphIssueSeverity::Warn => "warn",
                    },
                    "source": issue.source,
                    "jsonPath": issue.json_path,
                })
            })
            .collect::<Vec<_>>();
        actual.sort_by_key(|issue| format!("{}\0{}", issue["jsonPath"], issue["code"]));
        let mut expected = fixture["expectedIssues"].as_array().unwrap().clone();
        expected.sort_by_key(|issue| format!("{}\0{}", issue["jsonPath"], issue["code"]));

        assert_eq!(actual, expected);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn validate_cli_returns_one_for_contract_invalid_graph() {
        let dir = unique_temp_dir("cli-invalid-graph-structure");
        make_project(&dir, Some(r#"{"version":1,"nodes":[],"edges":[]}"#));

        let code = run_validate(dir.to_string_lossy().as_ref(), OutputFormat::Json);
        let project = app_lib::open_project_for_cli(dir.to_string_lossy().as_ref()).unwrap();
        let issue = project
            .project_report
            .unwrap()
            .project_issues
            .into_iter()
            .find(|issue| issue.code == "graph_invalid_structure")
            .expect("invalid graph must remain a structured project issue");

        assert_eq!(code, 1);
        assert_eq!(issue.severity, app_lib::GraphIssueSeverity::Error);
        assert_eq!(issue.source, "graph");
        assert_eq!(issue.file.as_deref(), Some("content/graph.json"));
        assert_eq!(issue.json_path.as_deref(), Some("$.entryNodeId"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn validate_cli_matches_shared_structural_contract_corpus() {
        let fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../contracts/fixtures/validation-contract.json");
        let corpus: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(fixture_path).unwrap()).unwrap();
        let mut structural_codes = corpus["nodeCases"]
            .as_array()
            .unwrap()
            .iter()
            .chain(corpus["schemaCases"].as_array().unwrap())
            .flat_map(|case| case["issues"].as_array().unwrap())
            .map(|issue| issue["code"].as_str().unwrap().to_string())
            .collect::<std::collections::BTreeSet<_>>();
        structural_codes.insert(
            corpus["limitCase"]["repeatedIssue"]["code"]
                .as_str()
                .unwrap()
                .to_string(),
        );
        structural_codes.insert(
            corpus["limitCase"]["truncationIssue"]["code"]
                .as_str()
                .unwrap()
                .to_string(),
        );

        for case in corpus["nodeCases"].as_array().unwrap() {
            let dir = unique_temp_dir(case["id"].as_str().unwrap());
            make_project(
                &dir,
                Some(
                    r#"{"version":1,"entryNodeId":"a","nodes":[{"id":"a","file":"nodes/a.json"}],"edges":[]}"#,
                ),
            );
            write_text(
                &dir.join("content/nodes/a.json"),
                &serde_json::to_string(&case["input"]).unwrap(),
            );

            assert_cli_contract_case(&dir, case, &structural_codes);
            let _ = std::fs::remove_dir_all(&dir);
        }

        for case in corpus["schemaCases"].as_array().unwrap() {
            let dir = unique_temp_dir(case["id"].as_str().unwrap());
            make_project(
                &dir,
                Some(
                    r#"{"version":1,"entryNodeId":"a","nodes":[{"id":"a","file":"nodes/a.json"}],"edges":[]}"#,
                ),
            );
            write_text(&dir.join("content/nodes/a.json"), "[]");
            let rel_path = match case["schema"].as_str().unwrap() {
                "graph" => "content/graph.json",
                "manifest" => "content/manifest.json",
                "meta" => "content/meta.json",
                schema => panic!("unsupported CLI corpus schema: {schema}"),
            };
            write_text(
                &dir.join(rel_path),
                &serde_json::to_string(&case["input"]).unwrap(),
            );

            assert_cli_contract_case(&dir, case, &structural_codes);
            let _ = std::fs::remove_dir_all(&dir);
        }

        let limit = &corpus["limitCase"];
        let count = limit["count"].as_u64().unwrap() as usize;
        let retained = limit["retained"].as_u64().unwrap() as usize;
        let input = serde_json::Value::Array((0..count).map(|_| serde_json::json!({})).collect());
        let repeated = &limit["repeatedIssue"];
        let mut expected = (0..count)
            .map(|index| {
                serde_json::json!({
                    "code": repeated["code"],
                    "severity": repeated["severity"],
                    "source": repeated["source"],
                    "jsonPath": repeated["jsonPathTemplate"]
                        .as_str()
                        .unwrap()
                        .replace("{index}", &index.to_string()),
                })
            })
            .collect::<Vec<_>>();
        expected.sort_by_key(|issue| format!("{}\0{}", issue["jsonPath"], issue["code"]));
        expected.truncate(retained);
        expected.push(limit["truncationIssue"].clone());
        expected.sort_by_key(|issue| format!("{}\0{}", issue["jsonPath"], issue["code"]));
        let case = serde_json::json!({
            "id": limit["id"],
            "input": input,
            "issues": expected,
        });
        let dir = unique_temp_dir(limit["id"].as_str().unwrap());
        make_project(
            &dir,
            Some(
                r#"{"version":1,"entryNodeId":"a","nodes":[{"id":"a","file":"nodes/a.json"}],"edges":[]}"#,
            ),
        );
        write_text(
            &dir.join("content/nodes/a.json"),
            &serde_json::to_string(&case["input"]).unwrap(),
        );
        assert_cli_contract_case(&dir, &case, &structural_codes);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn cli_open_uses_shared_defaults_without_rewriting_raw_files() {
        let fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../contracts/fixtures/default-projection-contract.json");
        let fixture: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(fixture_path).unwrap()).unwrap();
        let find_case = |schema: &str| {
            fixture["cases"]
                .as_array()
                .unwrap()
                .iter()
                .find(|case| case["schema"] == schema)
                .unwrap()
        };
        let dir = unique_temp_dir("cli-default-projection");
        make_project(
            &dir,
            Some(&serde_json::to_string(&find_case("graph")["input"]).unwrap()),
        );
        let mut node_input = find_case("nodeFile")["input"].as_array().unwrap().clone();
        node_input.retain(|instruction| instruction["t"] != "bgm");
        write_text(
            &dir.join("content/nodes/start.json"),
            &serde_json::to_string(&node_input).unwrap(),
        );
        write_text(
            &dir.join("content/manifest.json"),
            &serde_json::to_string(&find_case("manifest")["input"]).unwrap(),
        );
        write_text(
            &dir.join("content/meta.json"),
            &serde_json::to_string(&find_case("meta")["input"]).unwrap(),
        );
        let watched = [
            "content/graph.json",
            "content/nodes/start.json",
            "content/manifest.json",
            "content/meta.json",
        ];
        let before = watched
            .iter()
            .map(|path| (*path, std::fs::read(dir.join(path)).unwrap()))
            .collect::<Vec<_>>();

        let project = app_lib::open_project_for_cli(dir.to_string_lossy().as_ref()).unwrap();
        let graph = serde_json::to_value(project.graph.unwrap()).unwrap();
        assert_eq!(graph["version"], 1);
        assert_eq!(
            graph["nodes"][0]["position"],
            serde_json::json!({ "x": 0.0, "y": 0.0 })
        );
        assert_eq!(graph["edges"][0]["mode"], "linear");
        assert_eq!(graph["edges"][0]["label"], serde_json::Value::Null);
        assert_eq!(project.content.manifest, find_case("manifest")["input"]);
        assert_eq!(project.content.meta, find_case("meta")["input"]);
        assert!(project
            .project_report
            .unwrap()
            .project_issues
            .iter()
            .all(|issue| !matches!(
                issue.code.as_str(),
                "graph_invalid_structure"
                    | "instruction_invalid_field"
                    | "manifest_invalid_structure"
                    | "meta_invalid_structure"
            )));
        for (path, bytes) in before {
            assert_eq!(std::fs::read(dir.join(path)).unwrap(), bytes, "{path}");
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn validate_cli_ignores_tampered_project_local_schemas() {
        let dir = unique_temp_dir("cli-tampered-project-schema");
        make_project(
            &dir,
            Some(
                r#"{"version":1,"entryNodeId":"a","nodes":[{"id":"a","file":"nodes/a.json"}],"edges":[]}"#,
            ),
        );
        write_text(
            &dir.join("content/nodes/a.json"),
            r#"[{"t":"downloaded-code"}]"#,
        );

        let before = app_lib::open_project_for_cli(dir.to_string_lossy().as_ref())
            .unwrap()
            .project_report
            .unwrap()
            .project_issues;
        write_text(
            &dir.join(".galstudio/schemas/nodeFile.json"),
            r#"{"$schema":"https://json-schema.org/draft/2020-12/schema"}"#,
        );
        let after = app_lib::open_project_for_cli(dir.to_string_lossy().as_ref())
            .unwrap()
            .project_report
            .unwrap()
            .project_issues;

        let stable = |issues: Vec<app_lib::ProjectIssue>| {
            issues
                .into_iter()
                .map(|issue| (issue.code, issue.source, issue.json_path, issue.severity))
                .collect::<Vec<_>>()
        };
        assert_eq!(stable(after), stable(before));
        let _ = std::fs::remove_dir_all(dir);
    }

    fn assert_cli_contract_case(
        project_path: &Path,
        case: &serde_json::Value,
        structural_codes: &std::collections::BTreeSet<String>,
    ) {
        let project = app_lib::open_project_for_cli(project_path.to_string_lossy().as_ref())
            .unwrap_or_else(|error| panic!("case {} failed to open: {error}", case["id"]));
        let mut actual = project
            .project_report
            .into_iter()
            .flat_map(|report| report.project_issues)
            .filter(|issue| structural_codes.contains(&issue.code))
            .map(|issue| {
                serde_json::json!({
                    "code": issue.code,
                    "severity": match issue.severity {
                        app_lib::GraphIssueSeverity::Error => "error",
                        app_lib::GraphIssueSeverity::Warn => "warn",
                    },
                    "source": issue.source,
                    "jsonPath": issue.json_path.unwrap_or_else(|| "$".to_string()),
                })
            })
            .collect::<Vec<_>>();
        actual.sort_by_key(|issue| {
            format!(
                "{}\0{}",
                issue["jsonPath"].as_str().unwrap(),
                issue["code"].as_str().unwrap()
            )
        });

        assert_eq!(
            actual,
            case["issues"].as_array().unwrap().clone(),
            "CLI shared corpus case {}",
            case["id"]
        );
    }

    #[test]
    fn validate_cli_exits_one_for_node_error() {
        let dir = std::env::temp_dir().join(format!(
            "vibegal-cli-node-exit-{}",
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
            "vibegal-cli-build-invalid-{}",
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

        let err = build_web_project(build_options(&dir, &out_dir))
            .expect_err("validation error should fail build");

        assert_eq!(err.code, "project_validation_failed");
        assert_eq!(err.step, "validate");
        assert_eq!(err.file.as_deref(), Some("content/graph.json"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn build_web_uses_selected_renderer_and_copies_content_files() {
        let dir = std::env::temp_dir().join(format!(
            "vibegal-cli-build-selected-{}",
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

        let manifest: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(out_dir.join("game.manifest.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(manifest["rendererId"], "alt");
        assert_eq!(manifest["basePath"], "/games/test/");
        assert_eq!(manifest["buildTarget"], "web");
        let bundle = std::fs::read_to_string(out_dir.join("runtime/bundle.js")).unwrap();
        assert!(bundle.contains("Alt Selected Renderer"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn build_desktop_packages_electron_and_tauri_from_the_same_web_contract() {
        let dir = unique_temp_dir("cli-build-desktop-runtimes");
        make_exportable_project(&dir);
        let electron_dist = dir.join("fake-electron");
        if cfg!(target_os = "macos") {
            // macOS 的 Electron 运行时是完整的 .app bundle 结构，
            // 打包逻辑会整体复制 Electron.app 并改名。
            write_text(
                &electron_dist.join("Electron.app/Contents/MacOS/Electron"),
                "fake electron",
            );
            write_text(
                &electron_dist.join("Electron.app/Contents/Resources/default_app.asar"),
                "fake default app",
            );
            write_text(
                &electron_dist.join("Electron.app/Contents/Info.plist"),
                concat!(
                    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n",
                    "<plist version=\"1.0\">\n",
                    "<dict>\n",
                    "    <key>CFBundleName</key>\n",
                    "    <string>Electron</string>\n",
                    "    <key>CFBundleDisplayName</key>\n",
                    "    <string>Electron</string>\n",
                    "</dict>\n",
                    "</plist>\n",
                ),
            );
        } else {
            let electron_executable = if cfg!(windows) {
                "electron.exe"
            } else {
                "electron"
            };
            write_text(&electron_dist.join(electron_executable), "fake electron");
            write_text(
                &electron_dist.join("resources/default_app.asar"),
                "fake default app",
            );
        }
        let tauri_player = dir.join(tauri_player_executable_name());
        write_text(&tauri_player, "fake tauri player");

        std::env::set_var("VIBEGAL_ELECTRON_DIST", &electron_dist);
        std::env::set_var("VIBEGAL_TAURI_PLAYER", &tauri_player);
        for runtime in [DesktopRuntime::Electron, DesktopRuntime::Tauri] {
            let out_dir = dir.join(format!("desktop-{}", runtime.as_str()));
            let mut options = build_options(&dir, &out_dir);
            options.target = BuildTarget::Desktop;
            options.desktop_runtime = Some(runtime);

            let output = build_desktop_project(options).expect("desktop build should succeed");

            assert_eq!(output.target, "desktop");
            assert_eq!(output.runtime.as_deref(), Some(runtime.as_str()));
            assert_eq!(output.mode.as_deref(), Some(runtime.mode()));
            assert!(output
                .executable
                .as_deref()
                .is_some_and(|file| out_dir.join(file).is_file()));
            let desktop_manifest: serde_json::Value = serde_json::from_str(
                &std::fs::read_to_string(out_dir.join("desktop.manifest.json")).unwrap(),
            )
            .unwrap();
            assert_eq!(desktop_manifest["runtime"], runtime.as_str());
            let web_dist = desktop_manifest["webDist"].as_str().unwrap();
            assert!(out_dir.join(web_dist).join("game.manifest.json").is_file());
            assert!(out_dir.join(web_dist).join("runtime/bundle.js").is_file());
            #[cfg(target_os = "macos")]
            if runtime == DesktopRuntime::Tauri {
                // macOS 的 Tauri 轻量导出必须是真正的 .app bundle，
                // 否则 WebKit/NSBundle 在裸二进制下直接崩溃。
                let product = desktop_manifest["productName"].as_str().unwrap();
                let bundle = out_dir.join(format!("{product}.app"));
                let plist = std::fs::read_to_string(bundle.join("Contents/Info.plist")).unwrap();
                assert!(plist.contains("<string>APPL</string>"));
                assert!(bundle.join("Contents/MacOS").join(product).is_file());
                assert!(bundle.join("Contents/Resources/game/index.html").is_file());
                assert_eq!(
                    web_dist,
                    format!("{product}.app/Contents/Resources/game")
                );
            }
        }
        std::env::remove_var("VIBEGAL_ELECTRON_DIST");
        std::env::remove_var("VIBEGAL_TAURI_PLAYER");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn web_manifest_carries_the_fixed_stage_for_desktop_window_sizing() {
        let dir = unique_temp_dir("cli-build-stage-manifest");
        make_exportable_project(&dir);
        write_text(
            &dir.join("content/meta.json"),
            r#"{"title":"T","typingSpeedCps":30,"autoAdvanceMs":1200,"chapterGapMs":1500,"stage":{"width":1440,"height":810}}"#,
        );
        let out_dir = dir.join("dist-game");

        build_web_project(build_options(&dir, &out_dir)).expect("build should succeed");

        let manifest: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(out_dir.join("game.manifest.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(manifest["stage"]["width"], 1440);
        assert_eq!(manifest["stage"]["height"], 810);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn build_web_reports_renderer_compile_error() {
        let dir = std::env::temp_dir().join(format!(
            "vibegal-cli-build-renderer-error-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let out_dir = dir.join("dist-game");
        make_exportable_project(&dir);
        write_text(
            &dir.join("renderers/alt/index.tsx"),
            "import debounce from \"lodash\";\nexport default { id: \"alt\", name: \"Alt\", contractVersion: 1, Component: () => debounce(null) };",
        );
        let mut options = build_options(&dir, &out_dir);
        options.renderer_id = Some("alt".to_string());

        let err =
            build_web_project(options).expect_err("unsupported renderer import should fail build");

        assert_eq!(err.code, "renderer_unsupported_import");
        assert_eq!(err.step, "renderer");
        assert_eq!(err.renderer_id.as_deref(), Some("alt"));
        assert_eq!(err.file.as_deref(), Some("renderers/alt/index.tsx"));
        assert_eq!(err.line, Some(1));
        assert_eq!(err.column, Some(22));
        assert_eq!(err.diagnostics.len(), 1);
        assert_eq!(err.diagnostics[0].code, "renderer_unsupported_import");
        assert_eq!(
            err.diagnostics[0].snippet.as_deref(),
            Some("import debounce from \"lodash\";")
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn renderer_check_reports_unsupported_bare_import() {
        let dir = std::env::temp_dir().join(format!(
            "vibegal-cli-renderer-check-import-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        make_exportable_project(&dir);
        write_text(
            &dir.join("renderers/default/index.tsx"),
            "import { Stage } from \"./Stage\";\nexport default { id: \"default\", name: \"Default\", contractVersion: 1, Component: Stage };",
        );
        write_text(
            &dir.join("renderers/default/Stage.tsx"),
            "import debounce from \"lodash\";\nexport const Stage = () => debounce(null);",
        );

        let output = renderer_check_project(renderer_check_options(&dir, Some("default"))).unwrap();

        assert!(!output.ok);
        assert_eq!(output.renderer_id, "default");
        assert_eq!(
            output.diagnostics[0].severity,
            RendererDiagnosticSeverity::Error
        );
        assert_eq!(output.diagnostics[0].code, "renderer_unsupported_import");
        assert_eq!(output.diagnostics[0].renderer_id, "default");
        assert_eq!(output.diagnostics[0].step, "compile");
        assert_eq!(
            output.diagnostics[0].file.as_deref(),
            Some("renderers/default/Stage.tsx")
        );
        assert_eq!(output.diagnostics[0].line, Some(1));
        assert_eq!(output.diagnostics[0].column, Some(22));
        assert_eq!(
            output.diagnostics[0].snippet.as_deref(),
            Some("import debounce from \"lodash\";")
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn renderer_check_node_available() -> bool {
        Command::new(node_executable())
            .arg("--version")
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }

    #[test]
    fn renderer_check_passes_clean_renderer_with_compile() {
        if !renderer_check_node_available() {
            return;
        }
        let dir = std::env::temp_dir().join(format!(
            "vibegal-cli-renderer-check-compile-ok-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        make_exportable_project(&dir);

        let output = renderer_check_project(renderer_check_options(&dir, Some("default"))).unwrap();

        assert!(
            output.ok,
            "干净渲染层应通过真实编译检查: {:?}",
            output.diagnostics
        );
        assert!(output.diagnostics.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn renderer_check_reports_typecheck_error_from_worker() {
        if !renderer_check_node_available() {
            return;
        }
        let dir = std::env::temp_dir().join(format!(
            "vibegal-cli-renderer-check-typecheck-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        make_exportable_project(&dir);
        write_text(
            &dir.join("renderers/default/index.tsx"),
            "const broken: number = \"not a number\";\nexport default { id: \"default\", name: \"Default\", contractVersion: 1, Component: () => null };",
        );

        let output = renderer_check_project(renderer_check_options(&dir, Some("default"))).unwrap();

        assert!(!output.ok);
        assert!(
            output.diagnostics.iter().any(|diagnostic| {
                diagnostic.code == "renderer_typecheck_failed"
                    && diagnostic.step == "typecheck"
                    && diagnostic.severity == RendererDiagnosticSeverity::Error
            }),
            "应包含 worker 的 typecheck 诊断: {:?}",
            output.diagnostics
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn renderer_check_no_compile_skips_worker_typecheck() {
        let dir = std::env::temp_dir().join(format!(
            "vibegal-cli-renderer-check-no-compile-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        make_exportable_project(&dir);
        write_text(
            &dir.join("renderers/default/index.tsx"),
            "const broken: number = \"not a number\";\nexport default { id: \"default\", name: \"Default\", contractVersion: 1, Component: () => null };",
        );

        let mut options = renderer_check_options(&dir, Some("default"));
        options.compile = false;
        let output = renderer_check_project(options).unwrap();

        assert!(output.ok);
        assert!(output.diagnostics.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn snapshot_page_callback_parses_scene_status_and_message() {
        let parsed =
            parse_snapshot_page_callback("/__vibegal_snapshot_result__?scene=dialogue&status=ok");
        assert_eq!(
            parsed.map(|(scene, report)| (scene, report.status, report.error)),
            Some(("dialogue".to_string(), "ok".to_string(), None))
        );

        let parsed = parse_snapshot_page_callback(
            "/__vibegal_snapshot_result__?scene=choice&status=error&message=Component%20crashed%20%E5%B4%A9%E6%BA%83",
        );
        assert_eq!(
            parsed.map(|(scene, report)| (scene, report.status, report.error)),
            Some((
                "choice".to_string(),
                "error".to_string(),
                Some("Component crashed 崩溃".to_string())
            ))
        );

        assert!(parse_snapshot_page_callback("/snapshot.html?scene=dialogue").is_none());
        assert!(parse_snapshot_page_callback("/__vibegal_snapshot_result__?status=ok").is_none());
    }

    #[test]
    fn snapshot_browser_timeout_defaults_to_45s_and_honors_env_override() {
        std::env::remove_var("VIBEGAL_SNAPSHOT_BROWSER_TIMEOUT_SECS");
        assert_eq!(snapshot_browser_timeout().as_secs(), 45);
        std::env::set_var("VIBEGAL_SNAPSHOT_BROWSER_TIMEOUT_SECS", "120");
        assert_eq!(snapshot_browser_timeout().as_secs(), 120);
        // 非法值（0、非数字）回退到默认 45s
        std::env::set_var("VIBEGAL_SNAPSHOT_BROWSER_TIMEOUT_SECS", "0");
        assert_eq!(snapshot_browser_timeout().as_secs(), 45);
        std::env::set_var("VIBEGAL_SNAPSHOT_BROWSER_TIMEOUT_SECS", "not-a-number");
        assert_eq!(snapshot_browser_timeout().as_secs(), 45);
        std::env::remove_var("VIBEGAL_SNAPSHOT_BROWSER_TIMEOUT_SECS");
    }

    #[test]
    fn renderer_snapshot_end_to_end() {
        if !renderer_check_node_available()
            || smoke_browser_executable().is_none()
            || snapshot_worker_path().is_err()
        {
            return;
        }
        let dir = std::env::temp_dir().join(format!(
            "vibegal-cli-snapshot-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        make_exportable_project(&dir);
        let out_dir = dir.join("snapshots");

        let output = renderer_snapshot_project(RendererSnapshotOptions {
            project_path: dir.to_string_lossy().to_string(),
            renderer_id: Some("default".to_string()),
            out_dir: out_dir.clone(),
        })
        .unwrap();

        assert!(output.ok, "快照应全部成功: {:?}", output.scenes);
        // 场景目录会随 fixtures 扩充增长（内置 4 个 + 项目自定义），不断言具体数量。
        assert!(
            !output.scenes.is_empty(),
            "快照至少应包含内置场景: {:?}",
            output.scenes
        );
        for scene in &output.scenes {
            assert_eq!(
                scene.status, "ok",
                "场景 {} 应成功: {:?}",
                scene.id, scene.error
            );
            let png = out_dir.join(format!("default-{}.png", scene.id));
            assert!(png.is_file(), "缺少截图 {}", png.display());
            assert!(
                std::fs::metadata(&png).map(|meta| meta.len()).unwrap_or(0) > 0,
                "截图不能为空: {}",
                png.display()
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn renderer_check_reports_missing_default_export() {
        let dir = std::env::temp_dir().join(format!(
            "vibegal-cli-renderer-check-default-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        make_exportable_project(&dir);
        write_text(
            &dir.join("renderers/default/index.tsx"),
            "export const Component = () => null;",
        );

        let output = renderer_check_project(renderer_check_options(&dir, Some("default"))).unwrap();

        assert!(!output.ok);
        assert_eq!(
            output.diagnostics[0].code,
            "renderer_missing_default_export"
        );
        assert_eq!(output.diagnostics[0].step, "manifest");
        assert_eq!(
            output.diagnostics[0].file.as_deref(),
            Some("renderers/default/index.tsx")
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn renderer_check_reports_wrong_manifest_id() {
        let dir = std::env::temp_dir().join(format!(
            "vibegal-cli-renderer-check-id-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        make_exportable_project(&dir);
        write_text(
            &dir.join("renderers/default/index.tsx"),
            "export default { id: \"other\", name: \"Default\", contractVersion: 1, Component: () => null };",
        );

        let output = renderer_check_project(renderer_check_options(&dir, Some("default"))).unwrap();

        assert!(!output.ok);
        assert_eq!(output.diagnostics[0].code, "renderer_manifest_id_mismatch");
        assert_eq!(output.diagnostics[0].step, "manifest");
        assert_eq!(output.diagnostics[0].line, Some(1));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn renderer_check_reports_missing_contract_version() {
        let dir = std::env::temp_dir().join(format!(
            "vibegal-cli-renderer-check-contract-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        make_exportable_project(&dir);
        write_text(
            &dir.join("renderers/default/index.tsx"),
            "export default { id: \"default\", name: \"Default\", Component: () => null };",
        );

        let output = renderer_check_project(renderer_check_options(&dir, Some("default"))).unwrap();

        assert!(!output.ok);
        assert_eq!(output.diagnostics[0].code, "renderer_contract_missing");
        assert_eq!(output.diagnostics[0].step, "contract");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn renderer_check_reports_unsupported_contract_version() {
        let dir = std::env::temp_dir().join(format!(
            "vibegal-cli-renderer-check-future-contract-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        make_exportable_project(&dir);
        write_text(
            &dir.join("renderers/default/index.tsx"),
            "export default { id: \"default\", name: \"Default\", contractVersion: 2, Component: () => null };",
        );

        let output = renderer_check_project(renderer_check_options(&dir, Some("default"))).unwrap();

        assert!(!output.ok);
        assert_eq!(output.diagnostics[0].code, "renderer_contract_unsupported");
        assert_eq!(output.diagnostics[0].step, "contract");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn build_web_writes_asset_manifest() {
        let dir = unique_temp_dir("cli-build-asset-manifest");
        let out_dir = dir.join("dist-game");
        make_exportable_project(&dir);
        add_manifest_assets(&dir);

        build_web_project(build_options(&dir, &out_dir)).expect("build should succeed");

        let asset_manifest_path = out_dir.join("asset.manifest.json");
        assert!(asset_manifest_path.is_file());
        let manifest: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(asset_manifest_path).unwrap()).unwrap();
        assert_eq!(manifest["schemaVersion"], 1);
        let assets = manifest["assets"].as_array().expect("assets array");
        let room = assets
            .iter()
            .find(|asset| asset["path"] == "content/assets/backgrounds/room.png")
            .expect("background asset is described");
        assert_eq!(room["kind"], "background");
        assert_eq!(room["id"], "room");
        assert_eq!(room["size"], "room image bytes".len() as u64);
        assert_eq!(room["sha256"].as_str().unwrap().len(), 64);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn build_web_hashes_content_and_assets() {
        let dir = unique_temp_dir("cli-build-hashes");
        let out_dir = dir.join("dist-game");
        make_exportable_project(&dir);
        add_manifest_assets(&dir);

        build_web_project(build_options(&dir, &out_dir)).expect("build should succeed");

        let manifest: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(out_dir.join("game.manifest.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(manifest["schemaVersion"], 1);
        assert_eq!(manifest["rendererContractVersion"], 1);
        assert_eq!(manifest["vibegalBuildSchemaVersion"], 1);
        assert_eq!(manifest["build"]["target"], "web");
        assert_eq!(manifest["build"]["mode"], "production");
        assert_eq!(manifest["build"]["basePath"], "./");
        assert_eq!(manifest["basePath"], "./");
        assert_eq!(manifest["contentHash"].as_str().unwrap().len(), 64);
        assert_eq!(manifest["assetManifestHash"].as_str().unwrap().len(), 64);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn build_web_is_stable_except_built_at() {
        let dir = unique_temp_dir("cli-build-stable");
        let out_a = dir.join("dist-a");
        let out_b = dir.join("dist-b");
        make_exportable_project(&dir);
        add_manifest_assets(&dir);

        build_web_project(build_options(&dir, &out_a)).expect("first build should succeed");
        build_web_project(build_options(&dir, &out_b)).expect("second build should succeed");

        let asset_a = std::fs::read_to_string(out_a.join("asset.manifest.json")).unwrap();
        let asset_b = std::fs::read_to_string(out_b.join("asset.manifest.json")).unwrap();
        assert_eq!(asset_a, asset_b);

        let mut manifest_a: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(out_a.join("game.manifest.json")).unwrap(),
        )
        .unwrap();
        let mut manifest_b: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(out_b.join("game.manifest.json")).unwrap(),
        )
        .unwrap();
        manifest_a["builtAt"] = serde_json::Value::Null;
        manifest_b["builtAt"] = serde_json::Value::Null;
        manifest_a["build"]["builtAt"] = serde_json::Value::Null;
        manifest_b["build"]["builtAt"] = serde_json::Value::Null;
        assert_eq!(manifest_a, manifest_b);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn smoke_web_fails_missing_runtime_bundle() {
        let dir = unique_temp_dir("cli-smoke-missing-runtime");
        let out_dir = dir.join("dist-game");
        make_exportable_project(&dir);
        build_web_project(build_options(&dir, &out_dir)).expect("build should succeed");
        std::fs::remove_file(out_dir.join("runtime/bundle.js")).unwrap();

        let err = smoke_web_dist(&out_dir).expect_err("missing runtime bundle should fail smoke");

        assert_eq!(err.code, "smoke_missing_runtime_bundle");
        assert_eq!(err.step, "runtime");
        assert_eq!(err.file.as_deref(), Some("runtime/bundle.js"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn browser_smoke_callback_parses_behavior_result() {
        let report = parse_browser_smoke_callback(
            "/__vibegal_smoke_result__?status=passed&advance=true&branch=chosen&save=true&media=loaded",
        )
        .expect("behavior callback should parse");

        assert_eq!(report.status, "passed");
        assert!(report.advanced);
        assert!(report.save_round_trip);
        assert_eq!(report.branch, "chosen");
        assert_eq!(report.media, "loaded");
        assert!(parse_browser_smoke_callback("/content/manifest.json").is_none());
    }

    #[test]
    fn installed_cli_resolves_packaged_exporter_candidates() {
        let executable = Path::new("/Applications/VibeGal-Studio.app/Contents/MacOS/vibegal-cli");
        let candidates = worker_path_candidates(Some(executable), EXPORT_WORKER_RELATIVE_PATH);

        assert!(candidates.contains(&PathBuf::from(
            "/Applications/VibeGal-Studio.app/Contents/Resources/exporter/packages/studio/scripts/build-web-export.mjs"
        )));
        assert!(candidates.contains(&PathBuf::from(
            "/Applications/VibeGal-Studio.app/Contents/MacOS/resources/exporter/packages/studio/scripts/build-web-export.mjs"
        )));

        let snapshot_candidates =
            worker_path_candidates(Some(executable), SNAPSHOT_WORKER_RELATIVE_PATH);
        assert!(snapshot_candidates.contains(&PathBuf::from(
            "/Applications/VibeGal-Studio.app/Contents/Resources/exporter/packages/studio/scripts/renderer-snapshot.mjs"
        )));
    }

    #[test]
    fn browser_smoke_server_sends_large_runtime_bundle_without_truncation() {
        use std::io::Read;
        use std::sync::{Arc, Mutex};

        let root = unique_temp_dir("smoke-large-runtime");
        let payload = vec![b'x'; 1_500_000];
        write_text(&root.join("index.html"), "ok");
        fs::create_dir_all(root.join("runtime")).unwrap();
        fs::write(root.join("runtime/bundle.js"), &payload).unwrap();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let mut client = std::net::TcpStream::connect(address).unwrap();
        let (stream, _) = loop {
            match listener.accept() {
                Ok(pair) => break pair,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::yield_now();
                }
                Err(error) => panic!("accept failed: {error}"),
            }
        };
        let report = Arc::new(Mutex::new(None));
        let server_root = root.clone();
        let server_report = Arc::clone(&report);
        let server = std::thread::spawn(move || {
            serve_smoke_connection(stream, &server_root, &server_report);
        });

        client
            .write_all(
                b"GET /runtime/bundle.js HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
            )
            .unwrap();
        let mut response = Vec::new();
        client.read_to_end(&mut response).unwrap();
        server.join().unwrap();
        let body_start = response
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .map(|index| index + 4)
            .unwrap();

        let body = &response[body_start..];
        assert_eq!(body.len(), payload.len());
        assert!(body.iter().all(|byte| *byte == b'x'));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn browser_smoke_server_is_not_blocked_by_idle_connections() {
        use std::io::Read;
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::{Arc, Mutex};

        let root = unique_temp_dir("smoke-idle-connection");
        write_text(&root.join("index.html"), "ok-body");
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let report = Arc::new(Mutex::new(None));
        let server = spawn_smoke_server(
            listener,
            root.clone(),
            Arc::clone(&report),
            Arc::clone(&stop),
        );

        // 浏览器 preconnect 式的空闲连接：只建立连接，不发送任何数据。
        let _idle = std::net::TcpStream::connect(address).unwrap();

        // 真实请求必须仍然能被及时处理，而不是排在空闲连接后面干等。
        let mut client = std::net::TcpStream::connect(address).unwrap();
        client
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        client
            .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .unwrap();
        let mut response = Vec::new();
        client.read_to_end(&mut response).unwrap();
        assert!(
            response.windows(7).any(|window| window == b"ok-body"),
            "real request must be served while an idle connection is open"
        );

        // 停止服务器必须即刻完成，不能被空闲连接拖住。
        stop.store(true, Ordering::Relaxed);
        let started = std::time::Instant::now();
        server.join().unwrap();
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "server shutdown must not block on idle connections"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn smoke_web_fails_missing_manifest_asset() {
        let dir = unique_temp_dir("cli-smoke-missing-asset");
        let out_dir = dir.join("dist-game");
        make_exportable_project(&dir);
        add_manifest_assets(&dir);
        build_web_project(build_options(&dir, &out_dir)).expect("build should succeed");
        std::fs::remove_file(out_dir.join("content/assets/backgrounds/room.png")).unwrap();

        let err = smoke_web_dist(&out_dir).expect_err("missing asset should fail smoke");

        assert_eq!(err.code, "smoke_missing_manifest_asset");
        assert_eq!(err.step, "assets");
        assert_eq!(
            err.file.as_deref(),
            Some("content/assets/backgrounds/room.png")
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn build_web_respects_base_path_in_manifest_and_smoke() {
        let dir = unique_temp_dir("cli-smoke-base-path");
        let out_dir = dir.join("dist-game");
        make_exportable_project(&dir);
        let mut options = build_options(&dir, &out_dir);
        options.base_path = "/foo/".to_string();

        build_web_project(options).expect("build should succeed");
        let manifest: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(out_dir.join("game.manifest.json")).unwrap(),
        )
        .unwrap();

        assert_eq!(manifest["basePath"], "/foo/");
        assert_eq!(manifest["build"]["basePath"], "/foo/");
        let smoke =
            smoke_web_dist(&out_dir).expect("smoke should accept absolute base path metadata");
        assert_eq!(smoke.base_path, "/foo/");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn desktop_tauri_prep_doc_exists() {
        let doc = workspace_root().join("docs/desktop-tauri-wrapper-prep.md");
        let text = std::fs::read_to_string(doc).expect("desktop prep doc should exist");

        assert!(text.contains("Tauri"));
        assert!(text.contains("Non-goals"));
        assert!(text.contains("signing"));
        assert!(text.contains("notarization"));
    }

    #[cfg(unix)]
    fn write_executable_script(dir: &Path, name: &str, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let path = dir.join(name);
        write_text(&path, body);
        let mut permissions = std::fs::metadata(&path).unwrap().permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&path, permissions).unwrap();
        path
    }

    #[cfg(unix)]
    #[test]
    fn desktop_shell_smoke_reads_result_from_file_redirected_output() {
        let dir = unique_temp_dir("cli-desktop-smoke-pass");
        let player = write_executable_script(
            &dir,
            "fake-player.sh",
            "#!/bin/sh\necho 'VIBEGAL_DESKTOP_SMOKE_RESULT={\"status\":\"passed\"}'\n",
        );

        let result = run_desktop_shell_smoke_with_timeout(&player, Duration::from_secs(5))
            .expect("smoke should pass");

        assert_eq!(
            result.get("status").and_then(serde_json::Value::as_str),
            Some("passed")
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn desktop_shell_smoke_reports_exit_status_and_stderr_when_result_missing() {
        let dir = unique_temp_dir("cli-desktop-smoke-incomplete");
        let player = write_executable_script(
            &dir,
            "fake-player.sh",
            "#!/bin/sh\necho 'boom' >&2\nexit 3\n",
        );

        let err = run_desktop_shell_smoke_with_timeout(&player, Duration::from_secs(5))
            .expect_err("missing smoke result should fail");

        assert_eq!(err.code, "smoke_desktop_incomplete");
        assert!(err.message.contains("exit status: 3"));
        assert!(err.message.contains("boom"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn desktop_shell_smoke_timeout_does_not_block_on_child_output() {
        let dir = unique_temp_dir("cli-desktop-smoke-timeout");
        let player = write_executable_script(&dir, "fake-player.sh", "#!/bin/sh\nsleep 30\n");

        let started = std::time::Instant::now();
        let err = run_desktop_shell_smoke_with_timeout(&player, Duration::from_millis(300))
            .expect_err("long-running player should time out");

        assert_eq!(err.code, "smoke_desktop_timeout");
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "timeout path must return promptly instead of waiting for pipe EOF"
        );
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
