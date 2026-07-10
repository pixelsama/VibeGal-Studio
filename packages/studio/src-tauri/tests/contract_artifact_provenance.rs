#[path = "../build_support/contracts.rs"]
mod contract_artifacts;

use contract_artifacts::{verify_contracts, CONTRACT_ARTIFACTS, CONTRACT_SOURCES};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn build_contract_verifier_rejects_tampered_artifact_and_source() {
    let source_generated = manifest_dir().join("generated/contracts");
    let source_contracts = manifest_dir().join("../../contracts");
    let root = unique_temp_dir();
    let generated = root.join("generated");
    let contracts = root.join("contracts");

    copy_file(
        &source_generated.join("contract-manifest.json"),
        &generated.join("contract-manifest.json"),
    );
    for artifact in CONTRACT_ARTIFACTS {
        copy_file(&source_generated.join(artifact), &generated.join(artifact));
    }
    for source in CONTRACT_SOURCES {
        copy_file(&source_contracts.join(source), &contracts.join(source));
    }

    verify_contracts(&generated, &contracts).expect("tracked contracts must be self-consistent");

    fs::write(generated.join("graph.schema.json"), b"{}\n").unwrap();
    assert!(verify_contracts(&generated, &contracts)
        .unwrap_err()
        .contains("stale generated contract artifact"));
    copy_file(
        &source_generated.join("graph.schema.json"),
        &generated.join("graph.schema.json"),
    );

    fs::write(contracts.join("src/schema.ts"), b"// tampered\n").unwrap();
    assert!(verify_contracts(&generated, &contracts)
        .unwrap_err()
        .contains("do not match source"));

    let _ = fs::remove_dir_all(root);
}

fn copy_file(source: &Path, destination: &Path) {
    fs::create_dir_all(destination.parent().unwrap()).unwrap();
    fs::copy(source, destination).unwrap();
}

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn unique_temp_dir() -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("vibegal-contract-build-{stamp}"))
}
