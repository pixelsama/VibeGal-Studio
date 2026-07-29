import { createHash } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { verifyUpdateManifest } from "./verify-update-manifest.mjs";

function assertHttps(value, label) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(`${label} must be an HTTPS URL without credentials`);
  }
  return url;
}

function safeArtifactName(url, version, platform) {
  const candidate = path.basename(url.pathname);
  if (candidate && candidate !== "." && candidate !== "..") return candidate;
  return `vibegal-${version}-${platform}.update`;
}

async function successfulResponse(fetchImpl, url, label) {
  const response = await fetchImpl(url.href, { redirect: "follow" });
  if (!response?.ok) throw new Error(`${label} request failed: HTTP ${response?.status ?? "unknown"}`);
  if (response.url) assertHttps(response.url, `${label} final URL`);
  return response;
}

/**
 * Fetches and verifies a signed update, then atomically stages it outside the
 * current installation. Installation remains a separate platform step, so a
 * failed attempt cannot overwrite the running version and is safe to retry.
 */
export async function stageDesktopUpdate({
  endpoint,
  currentVersion,
  publicKey,
  platform,
  downloadDirectory,
  channel = "stable",
  fetchImpl = globalThis.fetch,
}) {
  if (typeof fetchImpl !== "function") throw new Error("No fetch implementation is available");
  const manifestUrl = assertHttps(endpoint, "Update endpoint");
  const manifestResponse = await successfulResponse(fetchImpl, manifestUrl, "Update manifest");
  const manifest = await manifestResponse.json();
  if (manifest.channel !== channel) {
    throw new Error(`Update channel mismatch: expected ${channel}, received ${manifest.channel}`);
  }
  const verification = verifyUpdateManifest({ currentVersion, manifest, publicKey });
  if (!verification.accepted) return { status: "not-available", ...verification };

  const artifact = manifest.platforms?.[platform];
  if (!artifact) return { status: "not-available", reason: "platform-unavailable", version: manifest.version };
  const artifactUrl = assertHttps(artifact.url, "Update artifact URL");
  const response = await successfulResponse(fetchImpl, artifactUrl, "Update artifact");
  const bytes = Buffer.from(await response.arrayBuffer());
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== artifact.sha256) {
    throw new Error(`Update artifact SHA-256 mismatch: expected ${artifact.sha256}, received ${actualHash}`);
  }

  const versionDirectory = path.join(downloadDirectory, manifest.version);
  await mkdir(versionDirectory, { recursive: true });
  const destination = path.join(versionDirectory, safeArtifactName(artifactUrl, manifest.version, platform));
  const partial = `${destination}.part`;
  try {
    await writeFile(partial, bytes, { flag: "w", mode: 0o600 });
    await rm(destination, { force: true });
    await rename(partial, destination);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
  return {
    status: "staged",
    version: manifest.version,
    path: destination,
    sha256: actualHash,
    url: artifact.url,
  };
}
