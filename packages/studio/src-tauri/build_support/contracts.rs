use sha2::{Digest, Sha256};
use std::path::Path;

pub const CONTRACT_ARTIFACTS: [&str; 6] = [
    "nodeFile.schema.json",
    "graph.schema.json",
    "manifest.schema.json",
    "meta.schema.json",
    "fixture.schema.json",
    "diagnostics.json",
];

pub const CONTRACT_SOURCES: [&str; 6] = [
    "src/schema.ts",
    "src/diagnostics.ts",
    "src/fixtures.ts",
    "src/schemaExport.ts",
    "scripts/generate-contracts.ts",
    "package.json",
];

pub fn verify_contracts(generated: &Path, contracts: &Path) -> Result<(), String> {
    let manifest_path = generated.join("contract-manifest.json");
    let manifest = read_json(&manifest_path)?;
    ensure_equal(
        manifest.get("formatVersion"),
        Some(&serde_json::json!(1)),
        "unsupported contract manifest format",
    )?;
    ensure_equal(
        manifest.get("generatorVersion"),
        Some(&serde_json::json!(1)),
        "unsupported contract generator version",
    )?;
    ensure_equal(
        manifest.get("zodVersion"),
        Some(&serde_json::json!("4.4.3")),
        "unexpected Zod version",
    )?;

    let artifact_hashes = manifest
        .get("artifactSha256")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| "contract manifest has no artifactSha256 object".to_string())?;
    let source_hashes = manifest
        .get("sourceSha256")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| "contract manifest has no sourceSha256 object".to_string())?;
    if artifact_hashes.len() != CONTRACT_ARTIFACTS.len() {
        return Err("contract artifact set changed without manifest update".to_string());
    }
    if source_hashes.len() != CONTRACT_SOURCES.len() {
        return Err("contract source set changed without manifest update".to_string());
    }

    for artifact in CONTRACT_ARTIFACTS {
        verify_hash(
            &generated.join(artifact),
            artifact_hashes.get(artifact),
            &format!("stale generated contract artifact: {artifact}"),
        )?;
    }
    for source in CONTRACT_SOURCES {
        verify_source_hash(
            &contracts.join(source),
            source_hashes.get(source),
            &format!("generated contracts do not match source: {source}"),
        )?;
    }
    Ok(())
}

fn verify_hash(
    path: &Path,
    expected: Option<&serde_json::Value>,
    message: &str,
) -> Result<(), String> {
    let expected = expected
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| format!("{message}: missing hash"))?;
    let actual = sha256_file(path)?;
    if actual == expected {
        Ok(())
    } else {
        Err(message.to_string())
    }
}

fn ensure_equal(
    actual: Option<&serde_json::Value>,
    expected: Option<&serde_json::Value>,
    message: &str,
) -> Result<(), String> {
    if actual == expected {
        Ok(())
    } else {
        Err(message.to_string())
    }
}

fn read_json(path: &Path) -> Result<serde_json::Value, String> {
    let bytes = std::fs::read(path).map_err(|error| {
        format!(
            "missing required contract artifact {}: {error}",
            path.display()
        )
    })?;
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("invalid JSON in {}: {error}", path.display()))
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let bytes =
        std::fs::read(path).map_err(|error| format!("cannot read {}: {error}", path.display()))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn verify_source_hash(
    path: &Path,
    expected: Option<&serde_json::Value>,
    message: &str,
) -> Result<(), String> {
    let expected = expected
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| format!("{message}: missing hash"))?;
    let actual = sha256_text_file(path)?;
    if actual == expected {
        Ok(())
    } else {
        Err(message.to_string())
    }
}

/// Mirrors `hashTextFile` in packages/contracts/scripts/generate-contracts.ts:
/// contract sources are hashed after normalizing CRLF to LF, so Windows
/// checkouts (autocrlf) produce the same digest as LF platforms.
fn sha256_text_file(path: &Path) -> Result<String, String> {
    let bytes =
        std::fs::read(path).map_err(|error| format!("cannot read {}: {error}", path.display()))?;
    Ok(format!("{:x}", Sha256::digest(normalize_lf(&bytes))))
}

fn normalize_lf(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len());
    for (index, &byte) in bytes.iter().enumerate() {
        if byte == b'\r' && bytes.get(index + 1) == Some(&b'\n') {
            continue;
        }
        out.push(byte);
    }
    out
}
