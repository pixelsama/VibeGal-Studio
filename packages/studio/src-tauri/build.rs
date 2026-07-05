fn main() {
    prepare_cli_sidecar_placeholder();
    tauri_build::build()
}

fn prepare_cli_sidecar_placeholder() {
    let target = match std::env::var("TARGET") {
        Ok(target) => target,
        Err(_) => return,
    };
    let exe_suffix = if target.contains("windows") {
        ".exe"
    } else {
        ""
    };
    let sidecar =
        std::path::PathBuf::from("binaries").join(format!("galstudio-cli-{target}{exe_suffix}"));

    if sidecar.exists() {
        return;
    }
    if let Some(parent) = sidecar.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let _ = std::fs::write(
        &sidecar,
        b"#!/bin/sh\necho 'galstudio-cli sidecar placeholder; run tauri build to bundle the release CLI.' >&2\nexit 1\n",
    );

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = std::fs::metadata(&sidecar) {
            let mut permissions = metadata.permissions();
            permissions.set_mode(0o755);
            let _ = std::fs::set_permissions(&sidecar, permissions);
        }
    }
}
