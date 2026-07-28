#!/usr/bin/env node
import { createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import { updateSignaturePayload } from "./update-manifest-contract.mjs";

function parseVersion(value) {
  const match = String(value).match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/);
  if (!match) throw new Error(`Invalid SemVer: ${value}`);
  return {
    core: match.slice(1, 4).map(Number),
    prerelease: match[4]?.split(".") ?? [],
  };
}

function compareIdentifiers(left, right) {
  const leftNumber = /^\d+$/.test(left) ? Number(left) : null;
  const rightNumber = /^\d+$/.test(right) ? Number(right) : null;
  if (leftNumber !== null && rightNumber !== null) return Math.sign(leftNumber - rightNumber);
  if (leftNumber !== null) return -1;
  if (rightNumber !== null) return 1;
  return left.localeCompare(right);
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return Math.sign(a.core[index] - b.core[index]);
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return Math.sign(b.prerelease.length - a.prerelease.length);
  }
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    if (a.prerelease[index] === undefined) return -1;
    if (b.prerelease[index] === undefined) return 1;
    const compared = compareIdentifiers(a.prerelease[index], b.prerelease[index]);
    if (compared !== 0) return compared;
  }
  return 0;
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("Update manifest must be an object");
  if (manifest.schemaVersion !== 1) throw new Error("Unsupported update manifest schema");
  parseVersion(manifest.version);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(manifest.channel)) throw new Error("Update channel is invalid");
  if (!Number.isFinite(Date.parse(manifest.publishedAt))) throw new Error("Update publication time is invalid");
  if (!manifest.platforms || typeof manifest.platforms !== "object" || Array.isArray(manifest.platforms)) throw new Error("Update platforms are required");
  if (Object.keys(manifest.platforms).length === 0) throw new Error("At least one update platform is required");
  for (const [platform, entry] of Object.entries(manifest.platforms)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`Invalid platform entry: ${platform}`);
    const endpoint = new URL(entry.url);
    if (endpoint.protocol !== "https:") throw new Error(`Update URL must use HTTPS: ${platform}`);
    if (endpoint.username || endpoint.password) throw new Error(`Update URL must not contain credentials: ${platform}`);
    if (!/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error(`Invalid SHA-256: ${platform}`);
  }
  if (typeof manifest.signature !== "string" || !manifest.signature) throw new Error("Update signature is required");
}

export function verifyUpdateManifest({ currentVersion, manifest, publicKey }) {
  validateManifest(manifest);
  parseVersion(currentVersion);
  if (compareVersions(manifest.version, currentVersion) <= 0) {
    return { accepted: false, reason: "not-newer", version: manifest.version };
  }
  try {
    const signature = Buffer.from(manifest.signature, "base64");
    const key = createPublicKey(publicKey);
    const accepted = verify(null, updateSignaturePayload(manifest), key, signature);
    return {
      accepted,
      reason: accepted ? "accepted" : "signature-invalid",
      version: manifest.version,
    };
  } catch {
    return { accepted: false, reason: "signature-invalid", version: manifest.version };
  }
}

async function main() {
  const [manifestPath, currentVersion, publicKeyPath] = process.argv.slice(2);
  if (!manifestPath || !currentVersion || !publicKeyPath) {
    throw new Error("Usage: verify-update-manifest.mjs <manifest.json> <current-version> <public-key.pem>");
  }
  const manifest = JSON.parse(await readFile(path.resolve(manifestPath), "utf8"));
  const publicKey = await readFile(path.resolve(publicKeyPath), "utf8");
  const result = verifyUpdateManifest({ currentVersion, manifest, publicKey });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.accepted) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
