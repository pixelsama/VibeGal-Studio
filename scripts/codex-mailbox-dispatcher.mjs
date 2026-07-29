#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { watch } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

import {
  buildCodexInvocation,
  claimNextMailboxMessage,
  finalizeMailboxClaim,
  heartbeatMailboxClaim,
  mailboxDirectory,
  recoverStaleMailboxClaims,
} from "./agent-mailbox-core.mjs";
import {
  classifyCodexRun,
  codexDispatcherHelp,
  createSerialRunner,
  parseCodexDispatcherArgs,
} from "./codex-mailbox-dispatcher-core.mjs";

const options = parseCodexDispatcherArgs(process.argv.slice(2));
if (options.help) {
  process.stdout.write(codexDispatcherHelp());
  process.exit(0);
}

const config = await loadConfig(options.configPath);
const runtimeDir = path.join(config.exchangeRoot, "runtime", "codex");
const lock = options.dryRun ? null : await acquireDispatcherLock(path.join(runtimeDir, "dispatcher.lock"));
let activeChild = null;
let stopping = false;
const drainMailbox = createSerialRunner(drainMailboxUnsafe);

try {
  const recovered = options.dryRun
    ? []
    : await recoverStaleMailboxClaims(config.exchangeRoot, "codex", { staleAfterMs: config.codex.staleAfterMs });
  if (recovered.length > 0) log(`requeued stale messages: ${recovered.join(", ")}`);

  if (options.dryRun) {
    const pending = await pendingMessageNames(config.exchangeRoot);
    process.stdout.write(`${JSON.stringify({ status: "dry-run", pending }, null, 2)}\n`);
  } else if (options.once) {
    await drainMailbox();
  } else {
    await drainMailbox();
    await runDaemon();
  }
} finally {
  if (lock) await releaseDispatcherLock(lock);
}

async function runDaemon() {
  const pendingDir = mailboxDirectory(config.exchangeRoot, "codex", "pending");
  let scheduled = null;
  const scheduleDrain = () => {
    if (scheduled || stopping) return;
    scheduled = setTimeout(async () => {
      scheduled = null;
      try {
        await drainMailbox();
      } catch (error) {
        log(`drain failed: ${formatError(error)}`);
      }
    }, 100);
  };
  const watcher = watch(pendingDir, { persistent: true }, scheduleDrain);
  const reconciliation = setInterval(scheduleDrain, config.codex.reconcileIntervalMs);
  const heartbeat = setInterval(() => log("heartbeat"), config.codex.daemonHeartbeatMs);

  await new Promise((resolve) => {
    const stop = (signal) => {
      if (stopping) return;
      stopping = true;
      log(`received ${signal}; stopping`);
      watcher.close();
      clearInterval(reconciliation);
      clearInterval(heartbeat);
      if (scheduled) clearTimeout(scheduled);
      if (activeChild && !activeChild.killed) activeChild.kill("SIGTERM");
      resolve();
    };
    process.once("SIGINT", () => stop("SIGINT"));
    process.once("SIGTERM", () => stop("SIGTERM"));
  });
  await drainMailbox().catch((error) => log(`active drain stopped with error: ${formatError(error)}`));
}

async function drainMailboxUnsafe() {
  while (!stopping) {
    const claim = await claimNextMailboxMessage(config.exchangeRoot, "codex");
    if (!claim) return;
    try {
      await processClaim(claim);
    } catch (error) {
      log(`message ${claim.message.messageId} failed before completion: ${formatError(error)}`);
      await finalizeMailboxClaim(claim, "failed").catch((finalizeError) => {
        log(`could not move ${claim.message.messageId} to failed: ${formatError(finalizeError)}`);
      });
    }
    if (options.once && stopping) return;
  }
}

async function processClaim(claim) {
  const stamp = new Date().toISOString().replaceAll(/[-:.]/g, "");
  const runDir = path.join(config.exchangeRoot, "runs", claim.message.requestId, `attempt-${claim.message.attempt}-codex-${stamp}`);
  await mkdir(runDir, { recursive: true });
  const invocation = buildCodexInvocation({
    codexPath: config.codex.binary,
    config,
    message: claim.message,
    messagePath: claim.messagePath,
    outputSchemaPath: path.join(config.exchangeRoot, "schemas", "codex-run-result.schema.json"),
    runDir,
  });
  const startedAt = new Date().toISOString();
  log(`starting ${claim.message.messageId} in ${claim.message.worktree}`);
  const heartbeat = setInterval(() => heartbeatMailboxClaim(claim).catch((error) => log(`lease heartbeat failed: ${formatError(error)}`)), config.codex.claimHeartbeatMs);
  let processResult = { exitCode: 1, timedOut: false, error: null };
  try {
    processResult = await runCodex(invocation, runDir, config.codex.timeoutMs);
  } catch (error) {
    processResult.error = formatError(error);
  } finally {
    clearInterval(heartbeat);
  }

  let result = null;
  try {
    result = JSON.parse(await readFile(path.join(runDir, "last-message.json"), "utf8"));
  } catch {
    // Classification below records the missing or malformed structured result.
  }
  const outputsVerified = await outputMessagesExist(config.exchangeRoot, result?.outputMessageIds);
  const classification = classifyCodexRun({ exitCode: processResult.exitCode, result, outputsVerified });
  const finishedAt = new Date().toISOString();
  await writeFile(path.join(runDir, "dispatcher-result.json"), `${JSON.stringify({
    schemaVersion: 1,
    messageId: claim.message.messageId,
    startedAt,
    finishedAt,
    exitCode: processResult.exitCode,
    timedOut: processResult.timedOut,
    error: processResult.error,
    classification,
    result,
  }, null, 2)}\n`, { mode: 0o600 });
  await finalizeMailboxClaim(claim, classification.mailboxState);
  log(`finished ${claim.message.messageId}: ${classification.status}`);
}

async function runCodex(invocation, runDir, timeoutMs) {
  const stdoutFile = createWriteStream(path.join(runDir, "codex-events.ndjson"), { flags: "wx", mode: 0o600 });
  const stderrFile = createWriteStream(path.join(runDir, "codex-stderr.log"), { flags: "wx", mode: 0o600 });
  const child = spawn(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
  });
  activeChild = child;
  const stdoutDone = redactLines(child.stdout, stdoutFile);
  const stderrDone = redactLines(child.stderr, stderrFile);
  child.stdin.end(invocation.stdin);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 10_000).unref();
  }, timeoutMs);
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  }).finally(() => {
    clearTimeout(timeout);
    activeChild = null;
  });
  await Promise.all([stdoutDone, stderrDone]);
  return { exitCode, timedOut };
}

async function redactLines(input, output) {
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let inPrivateKey = false;
  for await (const line of lines) {
    if (/-----BEGIN [^-]*PRIVATE KEY-----/.test(line)) {
      inPrivateKey = true;
      output.write("[REDACTED PRIVATE KEY]\n");
      if (/-----END [^-]*PRIVATE KEY-----/.test(line)) inPrivateKey = false;
      continue;
    }
    if (inPrivateKey) {
      if (/-----END [^-]*PRIVATE KEY-----/.test(line)) inPrivateKey = false;
      continue;
    }
    output.write(`${line.replace(
      /\b(APPLE_[A-Z0-9_]*(?:PASSWORD|BASE64|KEY)|WINDOWS_[A-Z0-9_]*(?:PASSWORD|BASE64|KEY)|VIBEGAL_UPDATER_SIGNING_KEY|GITHUB_TOKEN|GH_TOKEN)=([^\s"\\]*)/gi,
      "$1=[REDACTED]",
    )}\n`);
  }
  await new Promise((resolve, reject) => {
    output.once("error", reject);
    output.end(resolve);
  });
}

async function loadConfig(configPath) {
  const parsed = JSON.parse(await readFile(configPath, "utf8"));
  if (parsed.schemaVersion !== 1) throw new Error("Workspace config schemaVersion must be 1");
  if (!path.isAbsolute(parsed.exchangeRoot)) throw new Error("exchangeRoot must be absolute");
  for (const slot of ["main", "test", "dev"]) {
    if (!path.isAbsolute(parsed.worktrees?.[slot] ?? "")) throw new Error(`${slot} worktree path must be absolute`);
  }
  if (!path.isAbsolute(parsed.codex?.binary ?? "")) throw new Error("codex.binary must be absolute");
  return {
    ...parsed,
    codex: {
      timeoutMs: 3 * 60 * 60_000,
      staleAfterMs: 6 * 60 * 60_000,
      claimHeartbeatMs: 30_000,
      reconcileIntervalMs: 60_000,
      daemonHeartbeatMs: 10 * 60_000,
      ...parsed.codex,
    },
  };
}

async function acquireDispatcherLock(lockPath) {
  await mkdir(path.dirname(lockPath), { recursive: true });
  try {
    const handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
    await handle.sync();
    return { handle, lockPath };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    let active = false;
    try {
      const previous = JSON.parse(await readFile(lockPath, "utf8"));
      process.kill(previous.pid, 0);
      active = true;
    } catch {
      // A missing process means the lock is stale.
    }
    if (active) throw new Error(`Codex dispatcher is already running (${lockPath})`);
    await rm(lockPath, { force: true });
    return acquireDispatcherLock(lockPath);
  }
}

async function releaseDispatcherLock(lock) {
  await lock.handle.close();
  await rm(lock.lockPath, { force: true });
}

async function pendingMessageNames(exchangeRoot) {
  const dir = mailboxDirectory(exchangeRoot, "codex", "pending");
  return (await readdir(dir)).filter((name) => name.endsWith(".json") && !name.startsWith(".")).sort();
}

async function outputMessagesExist(exchangeRoot, messageIds) {
  if (!Array.isArray(messageIds) || messageIds.length === 0) return false;
  for (const messageId of messageIds) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(messageId)) return false;
    let found = false;
    for (const agent of ["codex", "claude", "grok"]) {
      for (const state of ["pending", "processing", "archive", "failed"]) {
        try {
          await stat(path.join(mailboxDirectory(exchangeRoot, agent, state), `${messageId}.json`));
          found = true;
          break;
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
      if (found) break;
    }
    if (!found) return false;
  }
  return true;
}

function log(message) {
  process.stdout.write(`[${new Date().toISOString()}] [codex-mailbox] ${message}\n`);
}

function formatError(error) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}
