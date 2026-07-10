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
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Parser)]
#[command(name = "vibegal-cli", about = "VibeGal-Studio 项目校验命令行")]
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
    /// 检查 renderer contract 与编译约束
    RendererCheck {
        /// 项目根目录路径
        path: String,
        /// 指定要检查的 renderer id。默认使用 gal.project.json activeRendererId。
        #[arg(long)]
        renderer: Option<String>,
        /// 输出格式：text（默认，人类可读）或 json（结构化）
        #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
        format: OutputFormat,
    },
    /// 对导出目录执行发行 smoke 检查
    Smoke {
        /// 导出目录路径
        dist_dir: PathBuf,
        /// smoke 目标。V1.1 仅支持 web。
        #[arg(long, value_enum)]
        target: BuildTarget,
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

#[derive(Debug)]
struct RendererCheckOptions {
    project_path: String,
    renderer_id: Option<String>,
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

fn build_worker_path_candidates(executable: Option<&Path>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(parent) = executable.and_then(Path::parent) {
        candidates.push(parent.join(EXPORT_WORKER_RELATIVE_PATH));
        candidates.push(parent.join("resources").join(EXPORT_WORKER_RELATIVE_PATH));
        if let Some(parent_parent) = parent.parent() {
            candidates.push(
                parent_parent
                    .join("Resources")
                    .join(EXPORT_WORKER_RELATIVE_PATH),
            );
            candidates.push(
                parent_parent
                    .join("resources")
                    .join(EXPORT_WORKER_RELATIVE_PATH),
            );
        }
    }
    candidates
}

fn build_worker_path() -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("VIBEGAL_EXPORT_WORKER") {
        let path = PathBuf::from(path);
        return path
            .is_file()
            .then_some(path)
            .ok_or_else(|| "VIBEGAL_EXPORT_WORKER 指向的导出器不存在".to_string());
    }

    let mut candidates = build_worker_path_candidates(std::env::current_exe().ok().as_deref());
    if cfg!(debug_assertions) {
        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scripts/build-web-export.mjs"),
        );
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

fn node_executable() -> String {
    std::env::var("VIBEGAL_NODE").unwrap_or_else(|_| "node".to_string())
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
    RendererDiagnostic {
        severity: RendererDiagnosticSeverity::Error,
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

    Ok(RendererCheckOutput {
        ok: diagnostics.is_empty(),
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
    let built_at = built_at_iso();
    let game_manifest = serde_json::json!({
        "schemaVersion": 1,
        "projectId": project.meta.name,
        "title": title,
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
        eprintln!(
            "[{:?}] {} (code={})",
            issue.severity, issue.message, issue.code
        );
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

fn run_renderer_check(options: RendererCheckOptions, format: OutputFormat) -> i32 {
    match renderer_check_project(options) {
        Ok(output) => {
            match format {
                OutputFormat::Json => print_build_json(&output),
                OutputFormat::Text => {
                    if output.ok {
                        println!("✓ Renderer check 通过: {}", output.renderer_id);
                    } else {
                        for diagnostic in &output.diagnostics {
                            eprintln!(
                                "[{}] {} (renderer={}, step={})",
                                diagnostic.code,
                                diagnostic.message,
                                diagnostic.renderer_id,
                                diagnostic.step
                            );
                            if let Some(file) = &diagnostic.file {
                                if let (Some(line), Some(column)) =
                                    (diagnostic.line, diagnostic.column)
                                {
                                    eprintln!("file: {file}:{line}:{column}");
                                } else {
                                    eprintln!("file: {file}");
                                }
                            }
                        }
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
        }
    }
    candidates.into_iter().find(|candidate| {
        Command::new(candidate)
            .arg("--version")
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    })
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

fn serve_smoke_connection(
    mut stream: std::net::TcpStream,
    root: &Path,
    report: &std::sync::Arc<std::sync::Mutex<Option<BrowserSmokeReport>>>,
) {
    use std::io::{Read, Write};

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
            "行为 smoke 需要 Chrome/Chromium；可通过 VIBEGAL_SMOKE_BROWSER 指定可执行文件",
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
    let server_stop = Arc::clone(&stop);
    let server_report = Arc::clone(&report);
    let root = dist_dir.to_path_buf();
    let server = std::thread::spawn(move || {
        while !server_stop.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, _)) => serve_smoke_connection(stream, &root, &server_report),
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                Err(_) => break,
            }
        }
    });
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
    let browser_result = match child {
        Ok(mut process) => {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
            loop {
                if let Some(callback) = report.lock().ok().and_then(|slot| slot.clone()) {
                    let _ = process.kill();
                    let _ = process.wait();
                    break Ok(callback);
                }
                match process.try_wait() {
                    Ok(Some(status)) => {
                        break Err(std::io::Error::other(format!(
                            "Chrome/Chromium behavior smoke exited before reporting ({status})"
                        )))
                    }
                    Ok(None) if std::time::Instant::now() < deadline => {
                        std::thread::sleep(std::time::Duration::from_millis(50));
                    }
                    Ok(None) => {
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

fn run_smoke(dist_dir: PathBuf, target: BuildTarget, format: OutputFormat) -> i32 {
    let result = match target {
        BuildTarget::Web => smoke_web_dist(&dist_dir).and_then(|mut output| {
            smoke_web_behavior(&dist_dir)?;
            output.checks.push("browserBehavior".to_string());
            output.checks.push("advance".to_string());
            output.checks.push("saveRoundTrip".to_string());
            output.checks.push("mediaLoad".to_string());
            Ok(output)
        }),
    };
    match result {
        Ok(output) => {
            match format {
                OutputFormat::Json => print_build_json(&output),
                OutputFormat::Text => println!(
                    "✓ Web smoke 通过: {} (basePath={})",
                    output.dist_dir, output.base_path
                ),
            }
            0
        }
        Err(error) => {
            match format {
                OutputFormat::Json => print_build_json(&error),
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
        Commands::RendererCheck {
            path,
            renderer,
            format,
        } => run_renderer_check(
            RendererCheckOptions {
                project_path: path,
                renderer_id: renderer,
            },
            format,
        ),
        Commands::Smoke {
            dist_dir,
            target,
            format,
        } => run_smoke(dist_dir, target, format),
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
            out_dir: out_dir.to_path_buf(),
            renderer_id: None,
            strict: false,
            allow_warnings: false,
            base_path: "./".to_string(),
        }
    }

    fn renderer_check_options(
        project: &std::path::Path,
        renderer_id: Option<&str>,
    ) -> RendererCheckOptions {
        RendererCheckOptions {
            project_path: project.to_string_lossy().to_string(),
            renderer_id: renderer_id.map(|id| id.to_string()),
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
        let candidates = build_worker_path_candidates(Some(executable));

        assert!(candidates.contains(&PathBuf::from(
            "/Applications/VibeGal-Studio.app/Contents/Resources/exporter/packages/studio/scripts/build-web-export.mjs"
        )));
        assert!(candidates.contains(&PathBuf::from(
            "/Applications/VibeGal-Studio.app/Contents/MacOS/resources/exporter/packages/studio/scripts/build-web-export.mjs"
        )));
    }

    #[test]
    fn browser_smoke_server_sends_large_runtime_bundle_without_truncation() {
        use std::io::{Read, Write};
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
