#!/usr/bin/env node
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { updateSignaturePayload } from "./update-manifest-contract.mjs";

const signingKey = process.env.VIBEGAL_UPDATER_SIGNING_KEY;
const signingKeyPath = process.env.VIBEGAL_UPDATER_SIGNING_KEY_PATH;
const signingKeyPassword = process.env.VIBEGAL_UPDATER_SIGNING_KEY_PASSWORD;

async function readSigningKey() {
  if (signingKey && signingKeyPath) {
    throw new Error("Provide the updater signing key as inline content or a file path, not both");
  }
  if (signingKey) return signingKey;
  if (signingKeyPath) return readFile(path.resolve(signingKeyPath), "utf8");
  return null;
}

async function main() {
  const [manifestPath] = process.argv.slice(2);
  if (!manifestPath) {
    throw new Error("Usage: sign-update-manifest.mjs <manifest.json>");
  }
  const resolved = path.resolve(manifestPath);
  const manifest = JSON.parse(await readFile(resolved, "utf8"));
  const pem = await readSigningKey();
  if (!pem) {
    throw new Error("Updater signing key is unavailable; keep the release marked unsigned-dry-run");
  }
  delete manifest.signature;
  const privateKey = createPrivateKey({
    key: pem,
    format: "pem",
    ...(signingKeyPassword ? { passphrase: signingKeyPassword } : {}),
  });
  const payload = updateSignaturePayload(manifest);
  manifest.signature = sign(null, payload, privateKey).toString("base64");
  if (!verify(null, payload, createPublicKey(privateKey), Buffer.from(manifest.signature, "base64"))) {
    throw new Error("Updater manifest signature self-verification failed");
  }
  await writeFile(resolved, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ signed: true, manifest: resolved })}\n`);
}

await main();
