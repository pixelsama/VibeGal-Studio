//! Native desktop interactions used by the export workspace.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DesktopPlatform {
    Windows,
    MacOs,
    Linux,
}

impl DesktopPlatform {
    fn current() -> Self {
        if cfg!(target_os = "windows") {
            Self::Windows
        } else if cfg!(target_os = "macos") {
            Self::MacOs
        } else {
            Self::Linux
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
struct DesktopLaunchSpec {
    program: PathBuf,
    args: Vec<OsString>,
    cwd: Option<PathBuf>,
}

fn app_bundle_ancestor(path: &Path) -> Option<PathBuf> {
    path.ancestors().find_map(|ancestor| {
        ancestor
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| name.to_ascii_lowercase().ends_with(".app"))
            .map(|_| ancestor.to_path_buf())
    })
}

fn desktop_launch_spec(
    executable: &Path,
    platform: DesktopPlatform,
) -> Result<DesktopLaunchSpec, String> {
    if platform == DesktopPlatform::MacOs {
        if let Some(bundle) = app_bundle_ancestor(executable) {
            return Ok(DesktopLaunchSpec {
                program: PathBuf::from("open"),
                args: vec![OsString::from("-n"), bundle.into_os_string()],
                cwd: None,
            });
        }
    }
    if platform == DesktopPlatform::Windows
        && !executable
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
    {
        return Err("Windows 桌面游戏产物必须是 .exe 文件".to_string());
    }
    let cwd = executable
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .ok_or_else(|| "无法确定桌面游戏产物所在目录".to_string())?;
    Ok(DesktopLaunchSpec {
        program: executable.to_path_buf(),
        args: Vec::new(),
        cwd: Some(cwd),
    })
}

fn spawn_detached(spec: DesktopLaunchSpec) -> Result<(), String> {
    let mut command = Command::new(&spec.program);
    command.args(&spec.args);
    if let Some(cwd) = &spec.cwd {
        command.current_dir(cwd);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("启动桌面游戏失败: {error}"))
}

pub(crate) fn reveal_path(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("要显示的路径不存在: {}", path.display()));
    }
    let path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
    };
    let mut command = match DesktopPlatform::current() {
        DesktopPlatform::Windows => {
            let mut command = Command::new("explorer.exe");
            command.arg(format!("/select,{}", path.display()));
            command
        }
        DesktopPlatform::MacOs => {
            let mut command = Command::new("open");
            command.arg("-R").arg(&path);
            command
        }
        DesktopPlatform::Linux => {
            let target = if path.is_dir() {
                path.clone()
            } else {
                path.parent().unwrap_or(&path).to_path_buf()
            };
            let mut command = Command::new("xdg-open");
            command.arg(target);
            command
        }
    };
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法在文件管理器中显示路径: {error}"))
}

pub(crate) fn run_desktop_game(executable: &Path) -> Result<(), String> {
    if !executable.exists() {
        return Err(format!("桌面游戏产物不存在: {}", executable.display()));
    }
    let executable = if executable.is_absolute() {
        executable.to_path_buf()
    } else {
        executable
            .canonicalize()
            .unwrap_or_else(|_| executable.to_path_buf())
    };
    spawn_detached(desktop_launch_spec(
        &executable,
        DesktopPlatform::current(),
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    #[test]
    fn macos_app_executable_launches_the_bundle_with_open_n() {
        let spec = desktop_launch_spec(
            Path::new("/Games/Sakura.app/Contents/MacOS/Electron"),
            DesktopPlatform::MacOs,
        )
        .expect("an executable inside an app bundle should be recognized");
        assert_eq!(spec.program, PathBuf::from("open"));
        assert_eq!(
            spec.args,
            vec![OsString::from("-n"), OsString::from("/Games/Sakura.app")]
        );
        assert_eq!(spec.cwd, None);
    }

    #[test]
    fn portable_executable_uses_its_parent_as_working_directory() {
        let windows = desktop_launch_spec(
            Path::new("C:/Games/Sakura/Sakura.exe"),
            DesktopPlatform::Windows,
        )
        .unwrap();
        assert_eq!(windows.program, PathBuf::from("C:/Games/Sakura/Sakura.exe"));
        assert_eq!(windows.cwd, Some(PathBuf::from("C:/Games/Sakura")));
        assert!(windows.args.is_empty());

        let linux =
            desktop_launch_spec(Path::new("/games/sakura/sakura"), DesktopPlatform::Linux).unwrap();
        assert_eq!(linux.cwd, Some(PathBuf::from("/games/sakura")));
    }

    #[test]
    fn windows_rejects_non_exe_game_targets() {
        let error = desktop_launch_spec(
            Path::new("C:/Games/Sakura/readme.txt"),
            DesktopPlatform::Windows,
        )
        .expect_err("Windows game targets must be executables");
        assert!(error.contains(".exe"));
    }

    #[test]
    fn system_commands_reject_missing_paths_before_spawning() {
        let missing = std::env::temp_dir().join(format!(
            "vibegal-missing-system-target-{}",
            std::process::id()
        ));
        assert!(reveal_path(&missing).unwrap_err().contains("不存在"));
        assert!(run_desktop_game(&missing).unwrap_err().contains("不存在"));
    }
}
