//! Desktop game build service shared by the future Studio UI adapter and CLI.
//!
//! The installed CLI owns validation and packaging. The application backend
//! invokes that same executable so there is only one public build contract.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) const DESKTOP_BUILD_PROGRESS_EVENT: &str = "desktop_build_progress";

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum DesktopRuntime {
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
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopBuildRequest {
    pub project_path: String,
    pub out_dir: String,
    #[serde(default)]
    pub runtime: Option<DesktopRuntime>,
    #[serde(default)]
    pub build_id: Option<String>,
    #[serde(default)]
    pub renderer_id: Option<String>,
    #[serde(default)]
    pub strict: bool,
    #[serde(default)]
    pub allow_warnings: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopSmokeRequest {
    pub dist_dir: String,
    #[serde(default)]
    pub runtime: Option<DesktopRuntime>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopBuildProgress {
    pub build_id: String,
    pub project_path: String,
    pub step: String,
    pub phase: String,
    pub message: String,
    pub percent: Option<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopBuildFailure {
    pub ok: bool,
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cli_error: Option<serde_json::Value>,
}

struct ActiveDesktopBuild {
    child: Arc<Mutex<Child>>,
    cancelled: Arc<AtomicBool>,
}

impl Clone for ActiveDesktopBuild {
    fn clone(&self) -> Self {
        Self {
            child: Arc::clone(&self.child),
            cancelled: Arc::clone(&self.cancelled),
        }
    }
}

#[derive(Clone, Default)]
pub(crate) struct DesktopBuildRegistry {
    active: Arc<Mutex<HashMap<String, ActiveDesktopBuild>>>,
}

fn command_args(request: &DesktopBuildRequest) -> Vec<String> {
    let runtime = request.runtime.unwrap_or(DesktopRuntime::Electron);
    let mut args = vec![
        "build".to_string(),
        request.project_path.clone(),
        "--target".to_string(),
        "desktop".to_string(),
        "--runtime".to_string(),
        runtime.as_str().to_string(),
        "--out".to_string(),
        request.out_dir.clone(),
        "--format".to_string(),
        "json".to_string(),
        "--progress".to_string(),
        "jsonl".to_string(),
    ];
    if let Some(renderer_id) = request.renderer_id.as_deref() {
        args.extend(["--renderer".to_string(), renderer_id.to_string()]);
    }
    if request.strict {
        args.push("--strict".to_string());
    }
    if request.allow_warnings {
        args.push("--allow-warnings".to_string());
    }
    args
}

fn smoke_command_args(request: &DesktopSmokeRequest) -> Vec<String> {
    let runtime = request.runtime.unwrap_or(DesktopRuntime::Electron);
    vec![
        "smoke".to_string(),
        request.dist_dir.clone(),
        "--target".to_string(),
        "desktop".to_string(),
        "--runtime".to_string(),
        runtime.as_str().to_string(),
        "--format".to_string(),
        "json".to_string(),
    ]
}

fn unavailable_failure(cli_path: &Path) -> DesktopBuildFailure {
    DesktopBuildFailure {
        ok: false,
        code: "desktop_cli_unavailable".to_string(),
        message: format!("找不到随 Studio 分发的 vibegal-cli: {}", cli_path.display()),
        cli_error: None,
    }
}

fn cli_failure(code: &str, stderr: &str) -> DesktopBuildFailure {
    let cli_error = serde_json::from_str(stderr.trim()).ok();
    DesktopBuildFailure {
        ok: false,
        code: code.to_string(),
        message: cli_error
            .as_ref()
            .and_then(|value: &serde_json::Value| value.get("message"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or_else(|| stderr.trim())
            .to_string(),
        cli_error,
    }
}

fn spawn_failure(error: impl std::fmt::Display) -> DesktopBuildFailure {
    DesktopBuildFailure {
        ok: false,
        code: "desktop_build_spawn_failed".to_string(),
        message: format!("启动 vibegal-cli 失败: {error}"),
        cli_error: None,
    }
}

fn invalid_output_failure(message: impl Into<String>) -> DesktopBuildFailure {
    DesktopBuildFailure {
        ok: false,
        code: "desktop_build_invalid_output".to_string(),
        message: message.into(),
        cli_error: None,
    }
}

fn terminate_build_process(child: &mut Child) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut taskkill = Command::new("taskkill.exe");
        taskkill
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW);
        if taskkill.status().is_ok_and(|status| status.success()) {
            return Ok(());
        }
    }
    child.kill()
}

fn effective_build_id(request: &DesktopBuildRequest) -> String {
    request
        .build_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            format!("desktop-{}-{stamp}", std::process::id())
        })
}

#[derive(Deserialize)]
struct CliProgressLine {
    #[serde(rename = "type")]
    kind: String,
    step: String,
    phase: String,
    message: String,
    percent: Option<u8>,
}

fn parse_progress_line(
    line: &str,
    build_id: &str,
    project_path: &str,
) -> Option<DesktopBuildProgress> {
    let progress: CliProgressLine = serde_json::from_str(line).ok()?;
    (progress.kind == "progress").then(|| DesktopBuildProgress {
        build_id: build_id.to_string(),
        project_path: project_path.to_string(),
        step: progress.step,
        phase: progress.phase,
        message: progress.message,
        percent: progress.percent,
    })
}

fn absolutize_build_executable(value: &mut serde_json::Value) {
    let Some(object) = value.as_object_mut() else {
        return;
    };
    let Some(out_dir) = object
        .get("outDir")
        .and_then(serde_json::Value::as_str)
        .map(std::path::PathBuf::from)
    else {
        return;
    };
    let Some(executable) = object
        .get("executable")
        .and_then(serde_json::Value::as_str)
        .map(std::path::PathBuf::from)
    else {
        return;
    };
    if executable.is_absolute() {
        return;
    }
    object.insert(
        "executable".to_string(),
        serde_json::Value::String(out_dir.join(executable).to_string_lossy().to_string()),
    );
}

impl DesktopBuildRegistry {
    fn register(
        &self,
        build_id: &str,
        child: Arc<Mutex<Child>>,
        cancelled: Arc<AtomicBool>,
    ) -> Result<(), DesktopBuildFailure> {
        let mut active = self.active.lock().map_err(|_| DesktopBuildFailure {
            ok: false,
            code: "desktop_build_state_failed".to_string(),
            message: "桌面构建状态已损坏".to_string(),
            cli_error: None,
        })?;
        if active.contains_key(build_id) {
            return Err(DesktopBuildFailure {
                ok: false,
                code: "desktop_build_duplicate_id".to_string(),
                message: format!("构建标识已在运行: {build_id}"),
                cli_error: None,
            });
        }
        active.insert(
            build_id.to_string(),
            ActiveDesktopBuild { child, cancelled },
        );
        Ok(())
    }

    fn remove(&self, build_id: &str) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(build_id);
        }
    }

    pub(crate) fn cancel(&self, build_id: &str) -> Result<(), DesktopBuildFailure> {
        let build = self
            .active
            .lock()
            .map_err(|_| DesktopBuildFailure {
                ok: false,
                code: "desktop_build_state_failed".to_string(),
                message: "桌面构建状态已损坏".to_string(),
                cli_error: None,
            })?
            .get(build_id)
            .cloned()
            .ok_or_else(|| DesktopBuildFailure {
                ok: false,
                code: "desktop_build_not_found".to_string(),
                message: format!("没有正在运行的桌面构建: {build_id}"),
                cli_error: None,
            })?;
        build.cancelled.store(true, Ordering::SeqCst);
        let mut child = build.child.lock().map_err(|_| DesktopBuildFailure {
            ok: false,
            code: "desktop_build_state_failed".to_string(),
            message: "无法访问正在运行的桌面构建进程".to_string(),
            cli_error: None,
        })?;
        terminate_build_process(&mut child).map_err(|error| DesktopBuildFailure {
            ok: false,
            code: "desktop_build_cancel_failed".to_string(),
            message: format!("取消桌面构建失败: {error}"),
            cli_error: None,
        })
    }
}

pub(crate) fn build_desktop_game(
    cli_path: &Path,
    request: DesktopBuildRequest,
    registry: &DesktopBuildRegistry,
    mut on_progress: impl FnMut(DesktopBuildProgress),
) -> Result<serde_json::Value, DesktopBuildFailure> {
    if !cli_path.is_file() {
        return Err(unavailable_failure(cli_path));
    }
    let build_id = effective_build_id(&request);
    let mut child = Command::new(cli_path)
        .args(command_args(&request))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(spawn_failure)?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| invalid_output_failure("无法读取 vibegal-cli 的标准输出"))?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| invalid_output_failure("无法读取 vibegal-cli 的错误输出"))?;
    let child = Arc::new(Mutex::new(child));
    let cancelled = Arc::new(AtomicBool::new(false));
    if let Err(error) = registry.register(&build_id, Arc::clone(&child), Arc::clone(&cancelled)) {
        if let Ok(mut child) = child.lock() {
            let _ = terminate_build_process(&mut child);
        }
        return Err(error);
    }

    let stderr_reader = thread::spawn(move || {
        let mut text = String::new();
        let _ = stderr.read_to_string(&mut text);
        text
    });
    let mut final_result = None;
    let mut stdout_error = None;
    for line in BufReader::new(stdout).lines() {
        match line {
            Ok(line) if line.trim().is_empty() => {}
            Ok(line) => {
                if let Some(progress) = parse_progress_line(&line, &build_id, &request.project_path)
                {
                    on_progress(progress);
                } else {
                    match serde_json::from_str::<serde_json::Value>(&line) {
                        Ok(value) => final_result = Some(value),
                        Err(error) => {
                            stdout_error =
                                Some(format!("vibegal-cli 返回了无法解析的 JSONL: {error}"));
                        }
                    }
                }
            }
            Err(error) => {
                stdout_error = Some(format!("读取 vibegal-cli 输出失败: {error}"));
                break;
            }
        }
    }
    let status = child
        .lock()
        .map_err(|_| invalid_output_failure("无法等待 vibegal-cli 进程"))?
        .wait()
        .map_err(spawn_failure);
    registry.remove(&build_id);
    let stderr = stderr_reader.join().unwrap_or_default();

    if cancelled.load(Ordering::SeqCst) {
        return Err(DesktopBuildFailure {
            ok: false,
            code: "desktop_build_cancelled".to_string(),
            message: "桌面构建已取消".to_string(),
            cli_error: None,
        });
    }
    let status = status?;
    if !status.success() {
        return Err(cli_failure("desktop_build_failed", &stderr));
    }
    if let Some(message) = stdout_error {
        return Err(invalid_output_failure(message));
    }
    let mut result =
        final_result.ok_or_else(|| invalid_output_failure("vibegal-cli 未返回最终构建结果"))?;
    absolutize_build_executable(&mut result);
    Ok(result)
}

pub(crate) fn desktop_build_preflight(
    cli_path: &Path,
) -> Result<serde_json::Value, DesktopBuildFailure> {
    if !cli_path.is_file() {
        return Ok(serde_json::json!({
            "ok": false,
            "cliAvailable": false,
        }));
    }
    let output = Command::new(cli_path)
        .args(["doctor", "--format", "json"])
        .output()
        .map_err(spawn_failure)?;
    if !output.status.success() {
        return Err(cli_failure(
            "desktop_build_failed",
            &String::from_utf8_lossy(&output.stderr),
        ));
    }
    let mut value: serde_json::Value = serde_json::from_slice(&output.stdout).map_err(|error| {
        invalid_output_failure(format!("vibegal-cli doctor 返回了无效 JSON: {error}"))
    })?;
    if let Some(object) = value.as_object_mut() {
        object.insert("cliAvailable".to_string(), serde_json::Value::Bool(true));
    }
    Ok(value)
}

pub(crate) fn smoke_desktop_game(
    cli_path: &Path,
    request: DesktopSmokeRequest,
) -> Result<serde_json::Value, DesktopBuildFailure> {
    if !cli_path.is_file() {
        return Err(unavailable_failure(cli_path));
    }
    let output = Command::new(cli_path)
        .args(smoke_command_args(&request))
        .output()
        .map_err(spawn_failure)?;
    if !output.status.success() {
        return Err(cli_failure(
            "desktop_smoke_failed",
            &String::from_utf8_lossy(&output.stderr),
        ));
    }
    serde_json::from_slice(&output.stdout).map_err(|error| {
        invalid_output_failure(format!("vibegal-cli smoke 返回了无效 JSON: {error}"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_temp_dir(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "vibegal-game-build-{name}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ))
    }

    fn write_fake_cli(
        root: &Path,
        name: &str,
        unix_body: &str,
        windows_body: &str,
    ) -> std::path::PathBuf {
        std::fs::create_dir_all(root).unwrap();
        #[cfg(windows)]
        let _ = unix_body;
        #[cfg(not(windows))]
        let _ = windows_body;
        #[cfg(windows)]
        let (path, body) = (
            root.join(format!("{name}.cmd")),
            format!("@echo off\r\n{windows_body}\r\n"),
        );
        #[cfg(not(windows))]
        let (path, body) = (root.join(name), format!("#!/bin/sh\n{unix_body}\n"));
        std::fs::write(&path, body).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = std::fs::metadata(&path).unwrap().permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(&path, permissions).unwrap();
        }
        path
    }

    fn request(runtime: Option<DesktopRuntime>) -> DesktopBuildRequest {
        DesktopBuildRequest {
            project_path: "C:/game".to_string(),
            out_dir: "C:/release".to_string(),
            runtime,
            build_id: Some("build-123".to_string()),
            renderer_id: None,
            strict: false,
            allow_warnings: false,
        }
    }

    #[test]
    fn backend_defaults_to_compatible_electron() {
        let args = command_args(&request(None));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--runtime", "electron"]));
    }

    #[test]
    fn backend_can_explicitly_request_lightweight_tauri() {
        let mut request = request(Some(DesktopRuntime::Tauri));
        request.renderer_id = Some("custom".to_string());
        request.strict = true;
        request.allow_warnings = true;
        let args = command_args(&request);
        assert!(args.windows(2).any(|pair| pair == ["--runtime", "tauri"]));
        assert!(args.windows(2).any(|pair| pair == ["--renderer", "custom"]));
        assert!(args.contains(&"--strict".to_string()));
        assert!(args.contains(&"--allow-warnings".to_string()));
    }

    #[test]
    fn backend_build_enables_jsonl_progress_for_event_forwarding() {
        let args = command_args(&request(None));
        assert!(args.windows(2).any(|pair| pair == ["--progress", "jsonl"]));
        assert!(args.windows(2).any(|pair| pair == ["--format", "json"]));
    }

    #[test]
    fn smoke_command_defaults_to_electron_and_keeps_json_contract() {
        let args = smoke_command_args(&DesktopSmokeRequest {
            dist_dir: "C:/release".to_string(),
            runtime: None,
        });
        assert_eq!(
            args,
            [
                "smoke",
                "C:/release",
                "--target",
                "desktop",
                "--runtime",
                "electron",
                "--format",
                "json"
            ]
        );
    }

    #[test]
    fn cli_error_json_drives_backend_failure_message() {
        let failure = cli_failure(
            "desktop_smoke_failed",
            r#"{"ok":false,"code":"smoke_failed","message":"行为检查失败"}"#,
        );
        assert_eq!(failure.code, "desktop_smoke_failed");
        assert_eq!(failure.message, "行为检查失败");
        assert_eq!(failure.cli_error.unwrap()["code"], "smoke_failed");
    }

    #[test]
    fn preflight_missing_cli_is_a_status_not_an_error() {
        let root = std::env::temp_dir().join(format!("vibegal-missing-cli-{}", std::process::id()));
        let value = desktop_build_preflight(&root).expect("missing CLI is a reportable status");
        assert_eq!(value["ok"], false);
        assert_eq!(value["cliAvailable"], false);
    }

    #[test]
    fn ndjson_progress_line_becomes_frontend_event_payload() {
        let payload = parse_progress_line(
            r#"{"type":"progress","step":"web-build","phase":"done","message":"完成","percent":75}"#,
            "build-1",
            "C:/game",
        )
        .unwrap();
        assert_eq!(payload.build_id, "build-1");
        assert_eq!(payload.project_path, "C:/game");
        assert_eq!(payload.step, "web-build");
        assert_eq!(payload.phase, "done");
        assert_eq!(payload.percent, Some(75));
        assert!(parse_progress_line(r#"{"ok":true}"#, "build-1", "C:/game").is_none());
    }

    #[test]
    fn backend_streams_fake_cli_progress_and_returns_final_result() {
        let root = unique_temp_dir("progress");
        let cli = write_fake_cli(
            &root,
            "fake-cli-progress",
            "printf '%s\\n' '{\"type\":\"progress\",\"step\":\"validate\",\"phase\":\"start\",\"message\":\"开始\",\"percent\":null}'\nprintf '%s\\n' '{\"ok\":true,\"target\":\"desktop\"}'",
            "echo {\"type\":\"progress\",\"step\":\"validate\",\"phase\":\"start\",\"message\":\"start\",\"percent\":null}\r\necho {\"ok\":true,\"target\":\"desktop\"}",
        );
        let registry = DesktopBuildRegistry::default();
        let mut events = Vec::new();
        let result = build_desktop_game(&cli, request(None), &registry, |event| events.push(event))
            .expect("fake CLI should complete");
        assert_eq!(result["ok"], true);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].build_id, "build-123");
        assert_eq!(events[0].step, "validate");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn cancelling_a_registered_build_kills_the_cli_and_returns_cancelled() {
        let root = unique_temp_dir("cancel");
        let cli = write_fake_cli(
            &root,
            "fake-cli-cancel",
            "printf '%s\\n' '{\"type\":\"progress\",\"step\":\"validate\",\"phase\":\"start\",\"message\":\"开始\",\"percent\":null}'\nwhile :; do :; done",
            "echo {\"type\":\"progress\",\"step\":\"validate\",\"phase\":\"start\",\"message\":\"start\",\"percent\":null}\r\n:loop\r\ngoto loop",
        );
        let registry = DesktopBuildRegistry::default();
        let worker_registry = registry.clone();
        let (progress_tx, progress_rx) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            build_desktop_game(&cli, request(None), &worker_registry, |event| {
                let _ = progress_tx.send(event);
            })
        });
        progress_rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("fake CLI should emit progress before cancellation");
        registry
            .cancel("build-123")
            .expect("active build should cancel");
        let error = worker
            .join()
            .unwrap()
            .expect_err("cancelled build must fail");
        assert_eq!(error.code, "desktop_build_cancelled");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn preflight_parses_fake_cli_doctor_and_marks_cli_available() {
        let root = unique_temp_dir("preflight");
        let cli = write_fake_cli(
            &root,
            "fake-cli-doctor",
            "printf '%s\\n' '{\"ok\":true,\"node\":{\"available\":true}}'",
            "echo {\"ok\":true,\"node\":{\"available\":true}}",
        );
        let value = desktop_build_preflight(&cli).expect("fake doctor output should parse");
        assert_eq!(value["ok"], true);
        assert_eq!(value["cliAvailable"], true);
        assert_eq!(value["node"]["available"], true);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn app_build_result_exposes_an_absolute_executable_path() {
        let out_dir = unique_temp_dir("absolute-executable");
        let mut value = serde_json::json!({
            "ok": true,
            "outDir": out_dir,
            "executable": "Sakura.exe",
        });
        absolutize_build_executable(&mut value);
        let executable = Path::new(value["executable"].as_str().unwrap());
        assert!(executable.is_absolute());
        assert_eq!(executable.parent(), Some(out_dir.as_path()));
    }
}
