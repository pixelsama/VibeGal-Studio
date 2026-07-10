use std::path::{Path, PathBuf};

#[path = "build_support/contracts.rs"]
mod contract_artifacts;

use contract_artifacts::{verify_contracts, CONTRACT_SOURCES};

fn main() {
    verify_embedded_contracts();
    prepare_cli_sidecar_placeholder();
    tauri_build::build()
}

/// The Rust build never invokes Node or regenerates contracts. Generated
/// artifacts are tracked input and must prove their provenance through hashes.
fn verify_embedded_contracts() {
    let generated = Path::new("generated/contracts");
    let contracts = Path::new("../../contracts");
    println!("cargo:rerun-if-changed={}", generated.display());
    for source in CONTRACT_SOURCES {
        println!(
            "cargo:rerun-if-changed={}",
            contracts.join(source).display()
        );
    }

    verify_contracts(generated, contracts).unwrap_or_else(|error| panic!("{error}"));
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
    let sidecar = PathBuf::from("binaries").join(format!("vibegal-cli-{target}{exe_suffix}"));
    if sidecar.exists() {
        return;
    }
    if let Some(parent) = sidecar.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&sidecar, b"#!/bin/sh\necho 'vibegal-cli sidecar placeholder; run tauri build to bundle the release CLI.' >&2\nexit 1\n");
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
