use super::support::*;

// ── 应用设置（AppSettings）测试 ──

#[test]
fn app_settings_defaults_to_system() {
    let s = AppSettings::default();
    assert_eq!(s.theme, ThemeMode::System);
}

#[test]
fn app_settings_serde_roundtrip_preserves_theme() {
    let s = AppSettings {
        theme: ThemeMode::Light,
    };
    let json = serde_json::to_string(&s).unwrap();
    assert!(json.contains(r#""theme":"light""#));
    // 反序列化回来应一致
    let back: AppSettings = serde_json::from_str(&json).unwrap();
    assert_eq!(back, s);
}

#[test]
fn app_settings_serde_roundtrip_preserves_system_theme() {
    let s = AppSettings {
        theme: ThemeMode::System,
    };
    let json = serde_json::to_string(&s).unwrap();
    assert!(json.contains(r#""theme":"system""#));
    let back: AppSettings = serde_json::from_str(&json).unwrap();
    assert_eq!(back, s);
}

#[test]
fn app_settings_deserialize_missing_theme_uses_default() {
    // 旧版/部分设置文件缺 theme 字段时应回退到默认 system
    let back: AppSettings = serde_json::from_str("{}").unwrap();
    assert_eq!(back.theme, ThemeMode::System);
}

#[test]
fn app_settings_deserialize_unknown_theme_uses_default() {
    let back: AppSettings = serde_json::from_str(r#"{"theme":"solarized"}"#).unwrap();
    assert_eq!(back.theme, ThemeMode::System);
}

// symlink 安装流程只在 Unix 上可用（Windows 走"手动加入 PATH"降级），相关用例仅 Unix 运行。
#[cfg(unix)]
#[test]
fn cli_tool_status_detects_managed_symlink() {
    let root = unique_temp_dir("cli-status");
    let bin_dir = root.join("bin");
    fs::create_dir_all(&bin_dir).unwrap();
    let launcher = root.join("VibeGal-Studio.app/Contents/Resources/bin/vibegal-cli");
    let sidecar = root.join("VibeGal-Studio.app/Contents/MacOS/vibegal-cli");
    fs::create_dir_all(launcher.parent().unwrap()).unwrap();
    fs::create_dir_all(sidecar.parent().unwrap()).unwrap();
    fs::write(&launcher, "#!/bin/sh\n").unwrap();
    fs::write(&sidecar, "#!/bin/sh\n").unwrap();
    let link = bin_dir.join("vibegal-cli");

    create_cli_tool_symlink(&launcher, &link).unwrap();
    let status = cli_tool_status_inner(
        &launcher,
        &sidecar,
        &[link.clone()],
        Some(bin_dir.to_str().unwrap()),
    )
    .unwrap();

    assert!(status.installed);
    assert!(status.cli_available);
    assert!(!status.link_occupied);
    assert!(status.in_path);
    assert_eq!(status.link_path, link.to_string_lossy());

    let _ = fs::remove_dir_all(&root);
}

#[cfg(unix)]
#[test]
fn cli_tool_status_does_not_report_app_path_as_terminal_issue() {
    let root = unique_temp_dir("cli-status-no-app-path");
    let bin_dir = root.join("bin");
    fs::create_dir_all(&bin_dir).unwrap();
    let launcher = root.join("VibeGal-Studio.app/Contents/Resources/bin/vibegal-cli");
    let sidecar = root.join("VibeGal-Studio.app/Contents/MacOS/vibegal-cli");
    fs::create_dir_all(launcher.parent().unwrap()).unwrap();
    fs::create_dir_all(sidecar.parent().unwrap()).unwrap();
    fs::write(&launcher, "#!/bin/sh\n").unwrap();
    fs::write(&sidecar, "#!/bin/sh\n").unwrap();
    let link = bin_dir.join("vibegal-cli");

    create_cli_tool_symlink(&launcher, &link).unwrap();
    let status =
        cli_tool_status_inner(&launcher, &sidecar, &[link.clone()], Some("/usr/bin:/bin")).unwrap();

    assert!(status.installed);
    assert!(!status.in_path);
    assert_eq!(status.issue, None);

    let _ = fs::remove_dir_all(&root);
}

#[cfg(target_os = "macos")]
#[test]
fn cli_tool_candidate_link_paths_use_global_shell_path_on_macos() {
    assert_eq!(
        cli_tool_candidate_link_paths(),
        vec![PathBuf::from("/usr/local/bin/vibegal-cli")]
    );
}

#[cfg(windows)]
#[test]
fn cli_tool_candidate_link_paths_empty_on_windows() {
    // Windows 不支持一键安装命令链接：候选路径必须为空，让状态降级为手动引导
    assert!(cli_tool_candidate_link_paths().is_empty());
}

#[test]
fn cli_launcher_path_uses_resource_bin_wrapper() {
    let resources = PathBuf::from("/Applications/VibeGal-Studio.app/Contents/Resources");
    let expected = if cfg!(windows) {
        resources.join("bin/vibegal-cli.exe")
    } else {
        resources.join("bin/vibegal-cli")
    };

    assert_eq!(cli_launcher_path_from_resource_dir(&resources), expected);
}

#[cfg(unix)]
#[test]
fn install_cli_tool_links_global_command_to_wrapper_not_sidecar() {
    let root = unique_temp_dir("cli-install-wrapper");
    let bin_dir = root.join("bin");
    fs::create_dir_all(&bin_dir).unwrap();
    let launcher = root.join("VibeGal-Studio.app/Contents/Resources/bin/vibegal-cli");
    let sidecar = root.join("VibeGal-Studio.app/Contents/MacOS/vibegal-cli");
    fs::create_dir_all(launcher.parent().unwrap()).unwrap();
    fs::create_dir_all(sidecar.parent().unwrap()).unwrap();
    fs::write(&launcher, "#!/usr/bin/env bash\n").unwrap();
    fs::write(&sidecar, "#!/usr/bin/env bash\n").unwrap();
    let link = bin_dir.join("vibegal-cli");

    let status = install_cli_tool_inner(
        &launcher,
        &sidecar,
        &[link.clone()],
        Some(bin_dir.to_str().unwrap()),
    )
    .unwrap();

    assert!(status.installed);
    assert_eq!(fs::read_link(&link).unwrap(), launcher);

    let _ = fs::remove_dir_all(&root);
}

#[cfg(unix)]
#[test]
fn cli_tool_status_allows_repairing_legacy_sidecar_symlink() {
    let root = unique_temp_dir("cli-status-legacy-sidecar");
    let bin_dir = root.join("bin");
    fs::create_dir_all(&bin_dir).unwrap();
    let launcher = root.join("VibeGal-Studio.app/Contents/Resources/bin/vibegal-cli");
    let sidecar = root.join("VibeGal-Studio.app/Contents/MacOS/vibegal-cli");
    fs::create_dir_all(launcher.parent().unwrap()).unwrap();
    fs::create_dir_all(sidecar.parent().unwrap()).unwrap();
    fs::write(&launcher, "#!/bin/sh\n").unwrap();
    fs::write(&sidecar, "#!/bin/sh\n").unwrap();
    let link = bin_dir.join("vibegal-cli");
    create_cli_tool_symlink(&sidecar, &link).unwrap();

    let status = cli_tool_status_inner(
        &launcher,
        &sidecar,
        &[link.clone()],
        Some(bin_dir.to_str().unwrap()),
    )
    .unwrap();

    assert!(!status.installed);
    assert!(!status.link_occupied);
    assert!(status.cli_available);

    let _ = fs::remove_dir_all(&root);
}

#[cfg(unix)]
#[test]
fn install_cli_tool_replaces_legacy_sidecar_symlink_with_wrapper() {
    let root = unique_temp_dir("cli-install-legacy-sidecar");
    let bin_dir = root.join("bin");
    fs::create_dir_all(&bin_dir).unwrap();
    let launcher = root.join("VibeGal-Studio.app/Contents/Resources/bin/vibegal-cli");
    let sidecar = root.join("VibeGal-Studio.app/Contents/MacOS/vibegal-cli");
    fs::create_dir_all(launcher.parent().unwrap()).unwrap();
    fs::create_dir_all(sidecar.parent().unwrap()).unwrap();
    fs::write(&launcher, "#!/usr/bin/env bash\n").unwrap();
    fs::write(&sidecar, "#!/usr/bin/env bash\n").unwrap();
    let link = bin_dir.join("vibegal-cli");
    create_cli_tool_symlink(&sidecar, &link).unwrap();

    let status = install_cli_tool_inner(
        &launcher,
        &sidecar,
        &[link.clone()],
        Some(bin_dir.to_str().unwrap()),
    )
    .unwrap();

    assert!(status.installed);
    assert_eq!(fs::read_link(&link).unwrap(), launcher);

    let _ = fs::remove_dir_all(&root);
}

#[cfg(unix)]
#[test]
fn bundled_cli_wrapper_execs_sidecar_from_symlink() {
    use std::os::unix::fs::{symlink, PermissionsExt};

    let root = unique_temp_dir("cli-wrapper-exec");
    let wrapper = root.join("VibeGal-Studio.app/Contents/Resources/bin/vibegal-cli");
    let sidecar = root.join("VibeGal-Studio.app/Contents/MacOS/vibegal-cli");
    let link = root.join("bin/vibegal-cli");
    fs::create_dir_all(wrapper.parent().unwrap()).unwrap();
    fs::create_dir_all(sidecar.parent().unwrap()).unwrap();
    fs::create_dir_all(link.parent().unwrap()).unwrap();
    fs::write(&wrapper, include_str!("../../../resources/bin/vibegal-cli")).unwrap();
    fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o755)).unwrap();
    symlink("/bin/echo", &sidecar).unwrap();
    symlink(&wrapper, &link).unwrap();

    let output = std::process::Command::new("/usr/bin/env")
        .arg("bash")
        .arg(&link)
        .args(["validate", "."])
        .output()
        .unwrap();

    assert!(
        output.status.success(),
        "status: {}\nstdout: {}\nstderr: {}",
        output.status,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(String::from_utf8_lossy(&output.stdout), "validate .\n");

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn admin_symlink_script_quotes_paths_for_shell() {
    let cli = PathBuf::from("/Applications/Gal Studio's.app/Contents/Resources/bin/vibegal-cli");
    let link = PathBuf::from("/usr/local/bin/vibegal-cli");

    let script = admin_symlink_script(&cli, &link).unwrap();

    assert!(
        script.contains("'/Applications/Gal Studio'\\''s.app/Contents/Resources/bin/vibegal-cli'")
    );
    assert!(script.contains("'/usr/local/bin/vibegal-cli'"));
    assert!(script.contains("/bin/ln -s"));
}

#[test]
fn applescript_string_literal_escapes_shell_script() {
    assert_eq!(
        applescript_string_literal("echo \"hi\" && echo \\done"),
        "\"echo \\\"hi\\\" && echo \\\\done\""
    );
}

#[test]
fn install_cli_tool_refuses_to_overwrite_existing_command() {
    let root = unique_temp_dir("cli-install-occupied");
    let bin_dir = root.join("bin");
    fs::create_dir_all(&bin_dir).unwrap();
    let launcher = root.join("vibegal-cli-launcher");
    let sidecar = root.join("vibegal-cli-sidecar");
    fs::write(&launcher, "#!/bin/sh\n").unwrap();
    fs::write(&sidecar, "#!/bin/sh\n").unwrap();
    let link = bin_dir.join("vibegal-cli");
    fs::write(&link, "someone else's command").unwrap();

    let error = install_cli_tool_inner(
        &launcher,
        &sidecar,
        &[link.clone()],
        Some(bin_dir.to_str().unwrap()),
    )
    .unwrap_err();

    assert!(error.contains("已存在"));
    assert_eq!(fs::read_to_string(&link).unwrap(), "someone else's command");

    let _ = fs::remove_dir_all(&root);
}

#[cfg(unix)]
#[test]
fn uninstall_cli_tool_only_removes_managed_symlink() {
    let root = unique_temp_dir("cli-uninstall");
    let bin_dir = root.join("bin");
    fs::create_dir_all(&bin_dir).unwrap();
    let launcher = root.join("vibegal-cli-launcher");
    let sidecar = root.join("vibegal-cli-sidecar");
    fs::write(&launcher, "#!/bin/sh\n").unwrap();
    fs::write(&sidecar, "#!/bin/sh\n").unwrap();
    let link = bin_dir.join("vibegal-cli");
    create_cli_tool_symlink(&launcher, &link).unwrap();

    let status = uninstall_cli_tool_inner(
        &launcher,
        &sidecar,
        &[link.clone()],
        Some(bin_dir.to_str().unwrap()),
    )
    .unwrap();

    assert!(!link.exists());
    assert!(!status.installed);
    assert!(status.cli_available);

    let _ = fs::remove_dir_all(&root);
}

// ── 无一键安装路径的平台（Windows）降级行为 ──

#[test]
fn cli_tool_status_without_install_paths_degrades_to_manual_guidance() {
    // link_path 为空、不报错、CLI 可用：前端据此展示"复制路径 + 手动加入 PATH"的引导
    let root = unique_temp_dir("cli-status-manual");
    let launcher = root.join("vibegal-cli");
    let sidecar = root.join("vibegal-cli-sidecar");
    fs::write(&launcher, "bin").unwrap();
    fs::write(&sidecar, "bin").unwrap();

    let status = cli_tool_status_inner(&launcher, &sidecar, &[], None).unwrap();

    assert!(!status.installed);
    assert!(status.cli_available);
    assert!(status.link_path.is_empty());
    assert!(!status.link_occupied);
    assert!(!status.in_path);
    assert_eq!(status.issue, None);

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn cli_tool_status_without_install_paths_reports_missing_cli() {
    let root = unique_temp_dir("cli-status-manual-missing");
    let launcher = root.join("vibegal-cli");
    let sidecar = root.join("vibegal-cli-sidecar");

    let status = cli_tool_status_inner(&launcher, &sidecar, &[], None).unwrap();

    assert!(!status.cli_available);
    assert!(status.issue.is_some());

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn install_cli_tool_without_install_paths_errors() {
    let root = unique_temp_dir("cli-install-no-paths");
    let launcher = root.join("vibegal-cli");
    let sidecar = root.join("vibegal-cli-sidecar");
    fs::write(&launcher, "bin").unwrap();
    fs::write(&sidecar, "bin").unwrap();

    let error = install_cli_tool_inner(&launcher, &sidecar, &[], None).unwrap_err();

    assert!(
        error.contains("没有可用的命令行安装路径"),
        "unexpected error: {error}"
    );

    let _ = fs::remove_dir_all(&root);
}
