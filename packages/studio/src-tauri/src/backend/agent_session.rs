//! External Agent CLI session service (codex / claude / opencode).
//!
//! 每个「轮次」启动一个一次性子进程：cwd = 项目根目录，stdout NDJSON
//! 逐行归一化为 [`AgentStreamEvent`] 并转发给前端。多轮对话通过各家
//! 自己的 session resume 机制实现（claude --resume / codex exec resume /
//! opencode --session），应用本身不维护常驻进程。
//!
//! App 不接触任何模型密钥：登录态完全复用用户本机 CLI 配置（BYOK）。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
#[cfg(windows)]
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub(crate) const AGENT_TURN_EVENT: &str = "agent_turn_event";

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum AgentKind {
    Codex,
    Claude,
    Opencode,
}

impl AgentKind {
    pub(crate) fn command_name(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Claude => "claude",
            Self::Opencode => "opencode",
        }
    }

    pub(crate) fn all() -> [AgentKind; 3] {
        [Self::Codex, Self::Claude, Self::Opencode]
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentTurnRequest {
    pub project_path: String,
    pub agent: AgentKind,
    pub prompt: String,
    #[serde(default)]
    pub agent_session_id: Option<String>,
    #[serde(default)]
    pub turn_id: Option<String>,
}

/// 归一化后的流事件。对外 payload 通过 [`AgentTurnEvent`] 附加 turnId/agent。
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", tag = "kind", rename_all_fields = "camelCase")]
pub(crate) enum AgentStreamEvent {
    /// Agent 端会话标识（首轮产生，后续轮次用于 resume）
    Session { session_id: String },
    /// 一段完整的助手文本
    Message { text: String },
    /// 一次工具调用（已完成）
    Tool { name: String, summary: String },
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentTurnEvent {
    pub turn_id: String,
    pub agent: AgentKind,
    #[serde(flatten)]
    pub event: AgentStreamEvent,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentTurnOutcome {
    pub ok: bool,
    pub agent_session_id: Option<String>,
    pub text: String,
    pub is_error: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentFailure {
    pub ok: bool,
    pub code: String,
    pub message: String,
}

impl AgentFailure {
    pub(crate) fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            ok: false,
            code: code.to_string(),
            message: message.into(),
        }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentAvailability {
    pub agent: AgentKind,
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

struct ActiveAgentTurn {
    child: Arc<Mutex<Child>>,
    cancelled: Arc<AtomicBool>,
}

impl Clone for ActiveAgentTurn {
    fn clone(&self) -> Self {
        Self {
            child: Arc::clone(&self.child),
            cancelled: Arc::clone(&self.cancelled),
        }
    }
}

#[derive(Clone, Default)]
pub(crate) struct AgentSessionRegistry {
    active: Arc<Mutex<HashMap<String, ActiveAgentTurn>>>,
}

/// npm 安装的 CLI 在 Windows 上是 .cmd 垫片，CreateProcess 不会按
/// PATHEXT 解析；只有 .cmd/.bat 垫片才经 cmd 启动，原生 .exe 直接执行。
fn agent_command(name: &str) -> Command {
    #[cfg(windows)]
    {
        let executable = windows_program_path(name).unwrap_or_else(|| PathBuf::from(name));
        match executable.extension().and_then(|extension| extension.to_str()) {
            Some("cmd") | Some("bat") => {
                let mut command = Command::new("cmd.exe");
                command.args(["/d", "/s", "/c"]).arg(executable);
                command
            }
            _ => Command::new(executable),
        }
    }
    #[cfg(not(windows))]
    {
        Command::new(name)
    }
}

#[cfg(windows)]
fn windows_program_path(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        for candidate in [
            dir.join(name),
            dir.join(format!("{name}.exe")),
            dir.join(format!("{name}.cmd")),
            dir.join(format!("{name}.bat")),
        ] {
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn turn_command_args(agent: AgentKind, request: &AgentTurnRequest) -> Vec<String> {
    let session_id = request
        .agent_session_id
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    match agent {
        AgentKind::Claude => {
            let mut args = vec![
                "-p".to_string(),
                request.prompt.clone(),
                "--output-format".to_string(),
                "stream-json".to_string(),
                "--verbose".to_string(),
                "--permission-mode".to_string(),
                "acceptEdits".to_string(),
            ];
            if let Some(session_id) = session_id {
                args.extend(["--resume".to_string(), session_id.to_string()]);
            }
            args
        }
        AgentKind::Codex => {
            let mut args = vec![
                "exec".to_string(),
                "--json".to_string(),
                "--sandbox".to_string(),
                "workspace-write".to_string(),
                "--skip-git-repo-check".to_string(),
            ];
            match session_id {
                Some(session_id) => {
                    args.push("resume".to_string());
                    args.push(session_id.to_string());
                }
                None => {}
            }
            args.push(request.prompt.clone());
            args
        }
        AgentKind::Opencode => {
            let mut args = vec![
                "run".to_string(),
                "--format".to_string(),
                "json".to_string(),
                "--auto".to_string(),
            ];
            if let Some(session_id) = session_id {
                args.extend(["--session".to_string(), session_id.to_string()]);
            }
            args.push(request.prompt.clone());
            args
        }
    }
}

fn effective_turn_id(request: &AgentTurnRequest) -> String {
    request
        .turn_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            format!("agent-turn-{}-{stamp}", std::process::id())
        })
}

fn terminate_turn_process(child: &mut Child) -> std::io::Result<()> {
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

fn truncate_summary(text: &str, max: usize) -> String {
    let flattened: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut chars = flattened.chars();
    let head: String = chars.by_ref().take(max).collect();
    if chars.next().is_some() {
        format!("{head}…")
    } else {
        head
    }
}

// ---------------------------------------------------------------------------
// NDJSON 归一化（纯函数，逐家适配；一律走 Value 防御式解析，容忍字段增删）
// ---------------------------------------------------------------------------

fn parse_claude_line(line: &str, events: &mut Vec<AgentStreamEvent>) {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
        return;
    };
    let kind = value.get("type").and_then(serde_json::Value::as_str);
    match kind {
        Some("system") => {
            if value.get("subtype").and_then(serde_json::Value::as_str) == Some("init") {
                if let Some(session_id) = value.get("session_id").and_then(serde_json::Value::as_str)
                {
                    events.push(AgentStreamEvent::Session {
                        session_id: session_id.to_string(),
                    });
                }
            }
        }
        Some("assistant") => {
            let Some(content) = value
                .get("message")
                .and_then(|message| message.get("content"))
                .and_then(serde_json::Value::as_array)
            else {
                return;
            };
            let mut text = String::new();
            for block in content {
                match block.get("type").and_then(serde_json::Value::as_str) {
                    Some("text") => {
                        if let Some(part) = block.get("text").and_then(serde_json::Value::as_str) {
                            text.push_str(part);
                        }
                    }
                    Some("tool_use") => {
                        // 文本先于工具调用产出，保持消息的时间顺序
                        if !text.trim().is_empty() {
                            events.push(AgentStreamEvent::Message {
                                text: std::mem::take(&mut text),
                            });
                        }
                        let name = block
                            .get("name")
                            .and_then(serde_json::Value::as_str)
                            .unwrap_or("tool")
                            .to_string();
                        let input = block.get("input").cloned().unwrap_or(serde_json::Value::Null);
                        let summary_source = input
                            .get("command")
                            .or_else(|| input.get("file_path"))
                            .or_else(|| input.get("pattern"))
                            .and_then(serde_json::Value::as_str)
                            .map(str::to_string)
                            .unwrap_or_else(|| input.to_string());
                        events.push(AgentStreamEvent::Tool {
                            name,
                            summary: truncate_summary(&summary_source, 120),
                        });
                    }
                    _ => {}
                }
            }
            if !text.trim().is_empty() {
                events.push(AgentStreamEvent::Message { text });
            }
        }
        _ => {}
    }
}

fn parse_codex_line(line: &str, events: &mut Vec<AgentStreamEvent>) {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
        return;
    };
    match value.get("type").and_then(serde_json::Value::as_str) {
        Some("thread.started") => {
            if let Some(thread_id) = value.get("thread_id").and_then(serde_json::Value::as_str) {
                events.push(AgentStreamEvent::Session {
                    session_id: thread_id.to_string(),
                });
            }
        }
        Some("item.completed") => {
            let Some(item) = value.get("item") else {
                return;
            };
            match item.get("type").and_then(serde_json::Value::as_str) {
                Some("agent_message") => {
                    if let Some(text) = item.get("text").and_then(serde_json::Value::as_str) {
                        if !text.trim().is_empty() {
                            events.push(AgentStreamEvent::Message {
                                text: text.to_string(),
                            });
                        }
                    }
                }
                Some("command_execution") => {
                    let command = item
                        .get("command")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("");
                    events.push(AgentStreamEvent::Tool {
                        name: "bash".to_string(),
                        summary: truncate_summary(command, 120),
                    });
                }
                Some("file_change") => {
                    let paths = item
                        .get("changes")
                        .and_then(serde_json::Value::as_array)
                        .map(|changes| {
                            changes
                                .iter()
                                .filter_map(|change| {
                                    change.get("path").and_then(serde_json::Value::as_str)
                                })
                                .collect::<Vec<_>>()
                                .join(", ")
                        })
                        .unwrap_or_default();
                    events.push(AgentStreamEvent::Tool {
                        name: "edit".to_string(),
                        summary: truncate_summary(&paths, 120),
                    });
                }
                _ => {}
            }
        }
        _ => {}
    }
}

fn parse_opencode_line(
    line: &str,
    events: &mut Vec<AgentStreamEvent>,
    session_seen: &mut bool,
) {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
        return;
    };
    if !*session_seen {
        if let Some(session_id) = value
            .get("part")
            .and_then(|part| part.get("sessionID"))
            .and_then(serde_json::Value::as_str)
        {
            *session_seen = true;
            events.push(AgentStreamEvent::Session {
                session_id: session_id.to_string(),
            });
        }
    }
    let part = value.get("part").cloned().unwrap_or(serde_json::Value::Null);
    match value.get("type").and_then(serde_json::Value::as_str) {
        Some("text") => {
            // opencode 的 text 事件携带该 part 的累计文本，只在 part 结束
            // （time.end 存在）时作为完整段落上报，避免前端重复追加。
            let finished = part
                .get("time")
                .and_then(|time| time.get("end"))
                .is_some();
            if !finished {
                return;
            }
            if let Some(text) = part.get("text").and_then(serde_json::Value::as_str) {
                if !text.trim().is_empty() {
                    events.push(AgentStreamEvent::Message {
                        text: text.to_string(),
                    });
                }
            }
        }
        Some("tool_use") => {
            let name = part
                .get("tool")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("tool")
                .to_string();
            let input = part
                .get("state")
                .and_then(|state| state.get("input"))
                .cloned()
                .unwrap_or(serde_json::Value::Null);
            let summary_source = input
                .get("command")
                .or_else(|| input.get("filePath"))
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| input.to_string());
            events.push(AgentStreamEvent::Tool {
                name,
                summary: truncate_summary(&summary_source, 120),
            });
        }
        _ => {}
    }
}

#[derive(Default)]
struct TurnStreamState {
    events: Vec<AgentStreamEvent>,
    opencode_session_seen: bool,
}

impl TurnStreamState {
    fn push_line(&mut self, agent: AgentKind, line: &str) {
        match agent {
            AgentKind::Claude => parse_claude_line(line, &mut self.events),
            AgentKind::Codex => parse_codex_line(line, &mut self.events),
            AgentKind::Opencode => {
                parse_opencode_line(line, &mut self.events, &mut self.opencode_session_seen)
            }
        }
    }

    fn drain(&mut self) -> Vec<AgentStreamEvent> {
        std::mem::take(&mut self.events)
    }
}

// ---------------------------------------------------------------------------
// 注册表与执行
// ---------------------------------------------------------------------------

impl AgentSessionRegistry {
    fn register(
        &self,
        turn_id: &str,
        child: Arc<Mutex<Child>>,
        cancelled: Arc<AtomicBool>,
    ) -> Result<(), AgentFailure> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| AgentFailure::new("agent_state_failed", "Agent 会话状态已损坏"))?;
        if active.contains_key(turn_id) {
            return Err(AgentFailure::new(
                "agent_turn_duplicate_id",
                format!("轮次标识已在运行: {turn_id}"),
            ));
        }
        active.insert(
            turn_id.to_string(),
            ActiveAgentTurn { child, cancelled },
        );
        Ok(())
    }

    fn remove(&self, turn_id: &str) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(turn_id);
        }
    }

    pub(crate) fn cancel(&self, turn_id: &str) -> Result<(), AgentFailure> {
        let turn = self
            .active
            .lock()
            .map_err(|_| AgentFailure::new("agent_state_failed", "Agent 会话状态已损坏"))?
            .get(turn_id)
            .cloned()
            .ok_or_else(|| {
                AgentFailure::new(
                    "agent_turn_not_found",
                    format!("没有正在运行的 Agent 轮次: {turn_id}"),
                )
            })?;
        turn.cancelled.store(true, Ordering::SeqCst);
        let mut child = turn
            .child
            .lock()
            .map_err(|_| AgentFailure::new("agent_state_failed", "无法访问正在运行的 Agent 进程"))?;
        terminate_turn_process(&mut child).map_err(|error| {
            AgentFailure::new("agent_cancel_failed", format!("取消 Agent 轮次失败: {error}"))
        })
    }
}

pub(crate) fn detect_agents() -> Vec<AgentAvailability> {
    AgentKind::all()
        .into_iter()
        .map(|agent| {
            let version = probe_agent_version(agent);
            AgentAvailability {
                agent,
                available: version.is_some(),
                version,
            }
        })
        .collect()
}

fn probe_agent_version(agent: AgentKind) -> Option<String> {
    let mut child = agent_command(agent.command_name())
        .arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    // --version 理应瞬间返回；给 10s 兜底防卡死，超时按不可用处理，
    // 并在超时时杀掉进程，避免孤儿 CLI 在后台残留。
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    let mut output = Vec::new();
    loop {
        let status = match child.try_wait() {
            Ok(Some(status)) => status,
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(50));
                continue;
            }
            Err(_) => return None,
        };
        if !status.success() {
            return None;
        }
        let _ = stdout.read_to_end(&mut output);
        break;
    }
    let text = String::from_utf8_lossy(&output);
    let version = text.split_whitespace().last()?.to_string();
    Some(version)
}

pub(crate) fn run_agent_turn(
    request: AgentTurnRequest,
    registry: &AgentSessionRegistry,
    mut on_event: impl FnMut(AgentTurnEvent),
) -> Result<AgentTurnOutcome, AgentFailure> {
    let project_path = Path::new(&request.project_path);
    if !project_path.is_dir() {
        return Err(AgentFailure::new(
            "agent_project_missing",
            format!("项目目录不存在: {}", request.project_path),
        ));
    }
    let agent = request.agent;
    let turn_id = effective_turn_id(&request);
    let mut command = agent_command(agent.command_name());
    command
        .args(turn_command_args(agent, &request))
        .current_dir(project_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|error| {
        AgentFailure::new(
            "agent_spawn_failed",
            format!(
                "启动 {} 失败（CLI 是否已安装并在 PATH 中？）: {error}",
                agent.command_name()
            ),
        )
    })?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AgentFailure::new("agent_invalid_output", "无法读取 Agent 的标准输出"))?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| AgentFailure::new("agent_invalid_output", "无法读取 Agent 的错误输出"))?;
    let child = Arc::new(Mutex::new(child));
    let cancelled = Arc::new(AtomicBool::new(false));
    if let Err(error) = registry.register(&turn_id, Arc::clone(&child), Arc::clone(&cancelled)) {
        if let Ok(mut child) = child.lock() {
            let _ = terminate_turn_process(&mut child);
        }
        return Err(error);
    }

    let stderr_reader = thread::spawn(move || {
        let mut text = String::new();
        let _ = stderr.read_to_string(&mut text);
        text
    });

    let mut state = TurnStreamState::default();
    let mut assistant_text = String::new();
    let mut agent_session_id = request.agent_session_id.clone();
    let mut stdout_error = None;
    for line in BufReader::new(stdout).lines() {
        match line {
            Ok(line) if line.trim().is_empty() => {}
            Ok(line) => {
                state.push_line(agent, &line);
                for event in state.drain() {
                    match &event {
                        AgentStreamEvent::Session { session_id } => {
                            agent_session_id = Some(session_id.clone());
                        }
                        AgentStreamEvent::Message { text } => {
                            if !assistant_text.is_empty() {
                                assistant_text.push_str("\n\n");
                            }
                            assistant_text.push_str(text);
                        }
                        AgentStreamEvent::Tool { .. } => {}
                    }
                    on_event(AgentTurnEvent {
                        turn_id: turn_id.clone(),
                        agent,
                        event,
                    });
                }
            }
            Err(error) => {
                stdout_error = Some(format!("读取 Agent 输出失败: {error}"));
                break;
            }
        }
    }
    let status = child
        .lock()
        .map_err(|_| AgentFailure::new("agent_invalid_output", "无法等待 Agent 进程"))?
        .wait()
        .map_err(|error| AgentFailure::new("agent_spawn_failed", format!("等待 Agent 进程失败: {error}")));
    registry.remove(&turn_id);
    let stderr = stderr_reader.join().unwrap_or_default();

    if cancelled.load(Ordering::SeqCst) {
        return Err(AgentFailure::new("agent_turn_cancelled", "Agent 轮次已取消"));
    }
    let status = status?;
    if !status.success() {
        let detail = stderr.trim();
        return Err(AgentFailure::new(
            "agent_turn_failed",
            if detail.is_empty() {
                format!("{} 退出码异常: {status}", agent.command_name())
            } else {
                truncate_summary(detail, 400)
            },
        ));
    }
    if let Some(message) = stdout_error {
        return Err(AgentFailure::new("agent_invalid_output", message));
    }
    Ok(AgentTurnOutcome {
        ok: true,
        agent_session_id,
        text: assistant_text,
        is_error: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 改 PATH 环境变量的测试互斥：并行测试若同时改写/恢复 PATH，
    /// 一方可能把另一方注入的假 CLI 目录抹掉，导致 spawn 到真实 CLI。
    static PATH_ENV_LOCK: Mutex<()> = Mutex::new(());

    fn unique_temp_dir(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "vibegal-agent-{name}-{}-{}",
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

    fn request(agent: AgentKind) -> AgentTurnRequest {
        AgentTurnRequest {
            project_path: "C:/game".to_string(),
            agent,
            prompt: "写一段开场白".to_string(),
            agent_session_id: None,
            turn_id: Some("turn-1".to_string()),
        }
    }

    // ---- 参数构造 ----

    #[test]
    fn claude_first_turn_uses_stream_json_print_mode() {
        let args = turn_command_args(AgentKind::Claude, &request(AgentKind::Claude));
        assert!(args.windows(2).any(|pair| pair == ["--output-format", "stream-json"]));
        assert!(args.windows(2).any(|pair| pair == ["-p", "写一段开场白"]));
        assert!(args.windows(2).any(|pair| pair == ["--permission-mode", "acceptEdits"]));
        assert!(!args.contains(&"--resume".to_string()));
    }

    #[test]
    fn claude_follow_up_turn_resumes_agent_session() {
        let mut req = request(AgentKind::Claude);
        req.agent_session_id = Some("sess-42".to_string());
        let args = turn_command_args(AgentKind::Claude, &req);
        assert!(args.windows(2).any(|pair| pair == ["--resume", "sess-42"]));
    }

    #[test]
    fn codex_first_turn_runs_exec_with_json_and_workspace_write() {
        let args = turn_command_args(AgentKind::Codex, &request(AgentKind::Codex));
        assert_eq!(args.first().map(String::as_str), Some("exec"));
        assert!(args.contains(&"--json".to_string()));
        assert!(args.windows(2).any(|pair| pair == ["--sandbox", "workspace-write"]));
        assert!(!args.contains(&"resume".to_string()));
        assert_eq!(args.last().map(String::as_str), Some("写一段开场白"));
    }

    #[test]
    fn codex_follow_up_turn_uses_resume_subcommand() {
        let mut req = request(AgentKind::Codex);
        req.agent_session_id = Some("thread-9".to_string());
        let args = turn_command_args(AgentKind::Codex, &req);
        let resume_at = args.iter().position(|arg| arg == "resume").unwrap();
        assert_eq!(args[resume_at + 1], "thread-9");
        assert_eq!(args.last().map(String::as_str), Some("写一段开场白"));
    }

    #[test]
    fn opencode_first_turn_runs_json_format_with_auto_approve() {
        let args = turn_command_args(AgentKind::Opencode, &request(AgentKind::Opencode));
        assert_eq!(args.first().map(String::as_str), Some("run"));
        assert!(args.windows(2).any(|pair| pair == ["--format", "json"]));
        assert!(args.contains(&"--auto".to_string()));
        assert!(!args.contains(&"--session".to_string()));
    }

    #[test]
    fn opencode_follow_up_turn_continues_session() {
        let mut req = request(AgentKind::Opencode);
        req.agent_session_id = Some("ses_1".to_string());
        let args = turn_command_args(AgentKind::Opencode, &req);
        assert!(args.windows(2).any(|pair| pair == ["--session", "ses_1"]));
    }

    // ---- NDJSON 归一化 ----

    #[test]
    fn claude_init_and_assistant_blocks_become_normalized_events() {
        let mut events = Vec::new();
        parse_claude_line(
            r#"{"type":"system","subtype":"init","session_id":"sess-1","tools":["Bash"]}"#,
            &mut events,
        );
        parse_claude_line(
            r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"先看一下项目结构。"},{"type":"tool_use","name":"Bash","input":{"command":"ls content/"}}]}}"#,
            &mut events,
        );
        assert_eq!(
            events,
            vec![
                AgentStreamEvent::Session {
                    session_id: "sess-1".to_string()
                },
                AgentStreamEvent::Message {
                    text: "先看一下项目结构。".to_string()
                },
                AgentStreamEvent::Tool {
                    name: "Bash".to_string(),
                    summary: "ls content/".to_string()
                },
            ]
        );
    }

    #[test]
    fn claude_result_and_user_lines_are_ignored() {
        let mut events = Vec::new();
        parse_claude_line(
            r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"ok"}]}}"#,
            &mut events,
        );
        parse_claude_line(
            r#"{"type":"result","subtype":"success","result":"完成","session_id":"sess-1"}"#,
            &mut events,
        );
        parse_claude_line("not json at all", &mut events);
        assert!(events.is_empty());
    }

    #[test]
    fn codex_thread_items_become_normalized_events() {
        let mut events = Vec::new();
        parse_codex_line(r#"{"type":"thread.started","thread_id":"thread-1"}"#, &mut events);
        parse_codex_line(r#"{"type":"turn.started"}"#, &mut events);
        parse_codex_line(
            r#"{"type":"item.completed","item":{"id":"item_0","type":"command_execution","command":"ls content/","aggregated_output":"graph.json","exit_code":0,"status":"completed"}}"#,
            &mut events,
        );
        parse_codex_line(
            r#"{"type":"item.completed","item":{"id":"item_1","type":"file_change","changes":[{"path":"content/graph.json","kind":"update"}],"status":"completed"}}"#,
            &mut events,
        );
        parse_codex_line(
            r#"{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"已更新开场节点。"}}"#,
            &mut events,
        );
        parse_codex_line(
            r#"{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}"#,
            &mut events,
        );
        assert_eq!(
            events,
            vec![
                AgentStreamEvent::Session {
                    session_id: "thread-1".to_string()
                },
                AgentStreamEvent::Tool {
                    name: "bash".to_string(),
                    summary: "ls content/".to_string()
                },
                AgentStreamEvent::Tool {
                    name: "edit".to_string(),
                    summary: "content/graph.json".to_string()
                },
                AgentStreamEvent::Message {
                    text: "已更新开场节点。".to_string()
                },
            ]
        );
    }

    #[test]
    fn opencode_finished_parts_become_normalized_events() {
        let mut events = Vec::new();
        let mut session_seen = false;
        parse_opencode_line(
            r#"{"type":"step_start","part":{"id":"part0","sessionID":"ses_1","type":"step-start"}}"#,
            &mut events,
            &mut session_seen,
        );
        parse_opencode_line(
            r#"{"type":"text","part":{"id":"part1","sessionID":"ses_1","type":"text","text":"进行中…"}}"#,
            &mut events,
            &mut session_seen,
        );
        parse_opencode_line(
            r#"{"type":"text","part":{"id":"part1","sessionID":"ses_1","type":"text","text":"进行中…完成了。","time":{"start":1,"end":2}}}"#,
            &mut events,
            &mut session_seen,
        );
        parse_opencode_line(
            r#"{"type":"tool_use","part":{"id":"part2","sessionID":"ses_1","type":"tool","tool":"bash","state":{"status":"completed","input":{"command":"ls content/"}}}}"#,
            &mut events,
            &mut session_seen,
        );
        assert_eq!(
            events,
            vec![
                AgentStreamEvent::Session {
                    session_id: "ses_1".to_string()
                },
                AgentStreamEvent::Message {
                    text: "进行中…完成了。".to_string()
                },
                AgentStreamEvent::Tool {
                    name: "bash".to_string(),
                    summary: "ls content/".to_string()
                },
            ]
        );
    }

    #[test]
    fn tool_summaries_are_flattened_and_truncated() {
        let long = "x".repeat(500);
        let summary = truncate_summary(&format!("multi\nline {long}"), 120);
        assert!(!summary.contains('\n'));
        assert!(summary.chars().count() <= 121);
        assert!(summary.ends_with('…'));
    }

    #[cfg(windows)]
    #[test]
    fn windows_cmd_shims_are_launched_through_cmd() {
        let _path_guard = PATH_ENV_LOCK.lock().unwrap();
        let root = unique_temp_dir("windows-command");
        let bin_dir = root.join("bin");
        let shim = write_fake_cli(&bin_dir, "codex", "", "exit /b 0");
        let original_path = std::env::var_os("PATH").unwrap_or_default();
        let mut paths = std::env::split_paths(&original_path).collect::<Vec<_>>();
        paths.insert(0, bin_dir);
        std::env::set_var("PATH", std::env::join_paths(paths).unwrap());

        let command = agent_command("codex");
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();

        std::env::set_var("PATH", original_path);
        let _ = std::fs::remove_dir_all(root);
        assert_eq!(command.get_program(), "cmd.exe");
        assert_eq!(
            args,
            vec![
                "/d".to_string(),
                "/s".to_string(),
                "/c".to_string(),
                shim.to_string_lossy().into_owned(),
            ]
        );
    }

    // ---- 端到端（假 CLI）----

    #[test]
    fn streams_fake_claude_turn_and_collects_outcome() {
        let root = unique_temp_dir("stream");
        let project = root.join("project");
        std::fs::create_dir_all(&project).unwrap();
        let bin_dir = root.join("bin");
        write_fake_cli(
            &bin_dir,
            "claude",
            "printf '%s\\n' '{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"sess-7\"}'\nprintf '%s\\n' '{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"你好\"}]}}'",
            "echo {\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"sess-7\"}\r\necho {\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"hi\"}]}}",
        );
        // 通过 PATH 注入假 CLI（仅 Unix；Windows 走 cmd /c 与 PATHEXT 语义不同，跳过）
        #[cfg(not(windows))]
        {
            let _path_guard = PATH_ENV_LOCK.lock().unwrap();
            let original_path = std::env::var_os("PATH").unwrap_or_default();
            let mut paths = std::env::split_paths(&original_path).collect::<Vec<_>>();
            paths.insert(0, bin_dir.clone());
            std::env::set_var("PATH", std::env::join_paths(paths).unwrap());
            let registry = AgentSessionRegistry::default();
            let mut events = Vec::new();
            let mut req = request(AgentKind::Claude);
            req.project_path = project.to_string_lossy().to_string();
            let outcome = run_agent_turn(req, &registry, |event| events.push(event))
                .expect("fake claude turn should succeed");
            std::env::set_var("PATH", original_path);
            assert_eq!(outcome.agent_session_id.as_deref(), Some("sess-7"));
            assert_eq!(outcome.text, "你好");
            assert!(events
                .iter()
                .any(|event| event.event == AgentStreamEvent::Session {
                    session_id: "sess-7".to_string()
                }));
            assert!(events
                .iter()
                .all(|event| event.turn_id == "turn-1" && event.agent == AgentKind::Claude));
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn cancelling_a_turn_kills_the_cli_and_returns_cancelled() {
        #[cfg(not(windows))]
        {
            let _path_guard = PATH_ENV_LOCK.lock().unwrap();
            let root = unique_temp_dir("cancel");
            let project = root.join("project");
            std::fs::create_dir_all(&project).unwrap();
            let bin_dir = root.join("bin");
            write_fake_cli(
                &bin_dir,
                "claude",
                "printf '%s\\n' '{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"sess-8\"}'\nwhile :; do :; done",
                "echo placeholder",
            );
            let original_path = std::env::var_os("PATH").unwrap_or_default();
            let mut paths = std::env::split_paths(&original_path).collect::<Vec<_>>();
            paths.insert(0, bin_dir.clone());
            std::env::set_var("PATH", std::env::join_paths(paths).unwrap());
            let registry = AgentSessionRegistry::default();
            let worker_registry = registry.clone();
            let (event_tx, event_rx) = std::sync::mpsc::channel();
            let worker = std::thread::spawn(move || {
                let mut req = request(AgentKind::Claude);
                req.project_path = project.to_string_lossy().to_string();
                run_agent_turn(req, &worker_registry, |event| {
                    let _ = event_tx.send(event);
                })
            });
            event_rx
                .recv_timeout(Duration::from_secs(5))
                .expect("fake claude should emit session before cancellation");
            registry.cancel("turn-1").expect("active turn should cancel");
            let error = worker
                .join()
                .unwrap()
                .expect_err("cancelled turn must fail");
            std::env::set_var("PATH", original_path);
            assert_eq!(error.code, "agent_turn_cancelled");
            let _ = std::fs::remove_dir_all(root);
        }
    }
}
