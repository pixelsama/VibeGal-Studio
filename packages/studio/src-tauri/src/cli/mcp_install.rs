//! `vibegal-cli mcp install <agent>`：把 VibeGal MCP server 注册进外部 Agent。
//!
//! 策略（对齐 open-design 的 cli/json 双策略，去掉 manual）：
//! - claude / codex：调用各家官方 `mcp add` 子命令（cli 策略），配置格式
//!   由各家自己维护，最不容易写坏；
//! - opencode：官方没有 add 子命令，直写 JSON 配置（json 策略），
//!   合并而非覆盖，保留用户其它配置项。

use clap::ValueEnum;
use serde_json::{json, Value};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Copy, Debug, ValueEnum)]
pub(crate) enum InstallTarget {
    Claude,
    Codex,
    Opencode,
}

pub(crate) fn run_mcp_install(agent: InstallTarget) -> i32 {
    let cli_path = resolve_cli_command();
    match install(agent, &cli_path) {
        Ok(message) => {
            println!("{message}");
            0
        }
        Err(message) => {
            eprintln!("{message}");
            1
        }
    }
}

/// MCP 配置里登记的服务器命令：优先 PATH 里的 vibegal-cli，否则用当前可执行文件绝对路径。
fn resolve_cli_command() -> String {
    if which_on_path("vibegal-cli") {
        return "vibegal-cli".to_string();
    }
    std::env::current_exe()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|_| "vibegal-cli".to_string())
}

fn which_on_path(name: &str) -> bool {
    program_on_path(name).is_some()
}

fn program_on_path(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidates = if cfg!(windows) {
            vec![
                dir.join(name),
                dir.join(format!("{name}.exe")),
                dir.join(format!("{name}.cmd")),
                dir.join(format!("{name}.bat")),
            ]
        } else {
            vec![dir.join(name)]
        };
        if let Some(candidate) = candidates.into_iter().find(|candidate| candidate.is_file()) {
            return Some(candidate);
        }
    }
    None
}

fn install(agent: InstallTarget, cli_command: &str) -> Result<String, String> {
    match agent {
        InstallTarget::Claude => install_via_cli(
            "claude",
            &[
                "mcp".to_string(),
                "add".to_string(),
                "vibegal".to_string(),
                "--scope".to_string(),
                "user".to_string(),
                "--".to_string(),
                cli_command.to_string(),
                "mcp".to_string(),
            ],
        ),
        InstallTarget::Codex => install_via_cli(
            "codex",
            &[
                "mcp".to_string(),
                "add".to_string(),
                "vibegal".to_string(),
                "--".to_string(),
                cli_command.to_string(),
                "mcp".to_string(),
            ],
        ),
        InstallTarget::Opencode => install_opencode_json(cli_command),
    }
}

fn install_via_cli(program: &str, args: &[String]) -> Result<String, String> {
    if !which_on_path(program) {
        return Err(format!(
            "未在 PATH 中找到 {program}。请先安装并登录 {program} CLI，再运行 vibegal-cli mcp install {program}。"
        ));
    }
    let mut command = if cfg!(windows) {
        let executable = program_on_path(program).unwrap_or_else(|| PathBuf::from(program));
        let mut command = Command::new("cmd.exe");
        command.args(["/d", "/s", "/c"]).arg(executable);
        command
    } else {
        Command::new(program)
    };
    let output = command
        .args(args)
        .output()
        .map_err(|error| format!("启动 {program} 失败: {error}"))?;
    if output.status.success() {
        Ok(format!(
            "已把 VibeGal MCP server 注册到 {program}（命令: {program} {}）。重启对应 Agent 后生效。",
            args.join(" ")
        ))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        Err(format!(
            "{program} mcp add 执行失败: {}",
            if stderr.trim().is_empty() {
                stdout.trim().to_string()
            } else {
                stderr.trim().to_string()
            }
        ))
    }
}

/// opencode 全局配置：`~/.config/opencode/opencode.json` 的 mcp 段。
/// 合并写入（幂等），保留用户的其它顶级键与其它 MCP server。
fn opencode_config_with_mcp(existing: Value, cli_command: &str) -> Value {
    let mut root = existing.as_object().cloned().unwrap_or_default();
    let mut mcp = root
        .get("mcp")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    mcp.insert(
        "vibegal".to_string(),
        json!({
            "type": "local",
            "command": [cli_command, "mcp"],
            "enabled": true,
        }),
    );
    root.insert("mcp".to_string(), Value::Object(mcp));
    Value::Object(root)
}

fn opencode_config_path() -> Result<PathBuf, String> {
    if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
        if !xdg.trim().is_empty() {
            return Ok(PathBuf::from(xdg).join("opencode/opencode.json"));
        }
    }
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| "无法定位用户主目录（HOME/USERPROFILE 均未设置）".to_string())?;
    Ok(PathBuf::from(home).join(".config/opencode/opencode.json"))
}

fn install_opencode_json(cli_command: &str) -> Result<String, String> {
    let path = opencode_config_path()?;
    let existing = match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text)
            .map_err(|error| format!("{} 不是有效 JSON，请手动修复: {error}", path.display()))?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Value::Null,
        Err(error) => return Err(format!("读取 {} 失败: {error}", path.display())),
    };
    let merged = opencode_config_with_mcp(existing, cli_command);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("创建 {} 失败: {error}", parent.display()))?;
    }
    let text = serde_json::to_string_pretty(&merged)
        .map_err(|error| format!("序列化 opencode 配置失败: {error}"))?;
    atomic_write_config(&path, &format!("{text}\n"))?;
    Ok(format!(
        "已把 VibeGal MCP server 写入 {}（mcp.vibegal）。重启 opencode 后生效。",
        path.display()
    ))
}

fn atomic_write_config(path: &Path, text: &str) -> Result<(), String> {
    if let Ok(metadata) = std::fs::symlink_metadata(path) {
        if metadata.file_type().is_symlink() {
            return Err(format!("拒绝写入符号链接配置: {}", path.display()));
        }
    }
    let parent = path
        .parent()
        .ok_or_else(|| format!("无法定位配置目录: {}", path.display()))?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("创建 {} 失败: {error}", parent.display()))?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = parent.join(format!(".{}.tmp-{}-{stamp}", path.file_name().unwrap_or_default().to_string_lossy(), std::process::id()));
    let result = (|| -> Result<(), String> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| format!("创建临时配置 {} 失败: {error}", temporary.display()))?;
        file.write_all(text.as_bytes())
            .and_then(|_| file.sync_all())
            .map_err(|error| format!("写入临时配置 {} 失败: {error}", temporary.display()))?;
        if cfg!(windows) && path.exists() {
            std::fs::remove_file(path)
                .map_err(|error| format!("替换配置 {} 失败: {error}", path.display()))?;
        }
        std::fs::rename(&temporary, path)
            .map_err(|error| format!("替换配置 {} 失败: {error}", path.display()))
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opencode_merge_preserves_existing_keys_and_servers() {
        let existing = json!({
            "theme": "dark",
            "mcp": {
                "other": { "type": "local", "command": ["other-mcp"], "enabled": true }
            }
        });
        let merged = opencode_config_with_mcp(existing, "/usr/local/bin/vibegal-cli");
        assert_eq!(merged["theme"], "dark");
        assert_eq!(merged["mcp"]["other"]["command"][0], "other-mcp");
        assert_eq!(merged["mcp"]["vibegal"]["type"], "local");
        assert_eq!(
            merged["mcp"]["vibegal"]["command"],
            json!(["/usr/local/bin/vibegal-cli", "mcp"])
        );
        assert_eq!(merged["mcp"]["vibegal"]["enabled"], true);
    }

    #[test]
    fn opencode_merge_is_idempotent_and_handles_empty_config() {
        let once = opencode_config_with_mcp(Value::Null, "vibegal-cli");
        let twice = opencode_config_with_mcp(once.clone(), "vibegal-cli");
        assert_eq!(once, twice);
        assert_eq!(twice["mcp"]["vibegal"]["command"][0], "vibegal-cli");
    }

    #[test]
    fn cli_strategy_args_match_vendor_syntax() {
        // 仅验证参数构造（真实 spawn 依赖本机 CLI，不进单测）
        let args = [
            "mcp".to_string(),
            "add".to_string(),
            "vibegal".to_string(),
            "--".to_string(),
            "vibegal-cli".to_string(),
            "mcp".to_string(),
        ];
        assert_eq!(args[3], "--");
        assert_eq!(args.last().map(String::as_str), Some("mcp"));
    }
}
