//! Desktop game build service shared by the future Studio UI adapter and CLI.
//!
//! The installed CLI owns validation and packaging. The application backend
//! invokes that same executable so there is only one public build contract.

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

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
    pub renderer_id: Option<String>,
    #[serde(default)]
    pub strict: bool,
    #[serde(default)]
    pub allow_warnings: bool,
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

pub(crate) fn build_desktop_game(
    cli_path: &Path,
    request: DesktopBuildRequest,
) -> Result<serde_json::Value, DesktopBuildFailure> {
    if !cli_path.is_file() {
        return Err(DesktopBuildFailure {
            ok: false,
            code: "desktop_cli_unavailable".to_string(),
            message: format!("找不到随 Studio 分发的 vibegal-cli: {}", cli_path.display()),
            cli_error: None,
        });
    }
    let output = Command::new(cli_path)
        .args(command_args(&request))
        .output()
        .map_err(|error| DesktopBuildFailure {
            ok: false,
            code: "desktop_build_spawn_failed".to_string(),
            message: format!("启动 vibegal-cli 失败: {error}"),
            cli_error: None,
        })?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if output.status.success() {
        return serde_json::from_str(stdout.trim()).map_err(|error| DesktopBuildFailure {
            ok: false,
            code: "desktop_build_invalid_output".to_string(),
            message: format!("vibegal-cli 返回了无效 JSON: {error}"),
            cli_error: None,
        });
    }
    let cli_error = serde_json::from_str(stderr.trim()).ok();
    Err(DesktopBuildFailure {
        ok: false,
        code: "desktop_build_failed".to_string(),
        message: cli_error
            .as_ref()
            .and_then(|value: &serde_json::Value| value.get("message"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or_else(|| stderr.trim())
            .to_string(),
        cli_error,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(runtime: Option<DesktopRuntime>) -> DesktopBuildRequest {
        DesktopBuildRequest {
            project_path: "C:/game".to_string(),
            out_dir: "C:/release".to_string(),
            runtime,
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
}
