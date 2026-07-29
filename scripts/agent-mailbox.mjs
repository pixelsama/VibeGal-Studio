#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  MAILBOX_AGENTS,
  MAILBOX_STATES,
  claimNextMailboxMessage,
  enqueueMailboxMessage,
  finalizeMailboxClaim,
  heartbeatMailboxClaim,
  initializeExchange,
  mailboxDirectory,
  recoverStaleMailboxClaims,
  validateMailboxMessage,
} from "./agent-mailbox-core.mjs";

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(help());
    process.exit(0);
  }
  if (options.command === "init") {
    await initializeExchange(options.exchangeRoot);
    process.stdout.write(`${JSON.stringify({ status: "initialized", exchangeRoot: options.exchangeRoot })}\n`);
  } else if (options.command === "enqueue") {
    const message = validateMailboxMessage(JSON.parse(await readFile(options.file, "utf8")));
    const messagePath = await enqueueMailboxMessage(options.exchangeRoot, message);
    process.stdout.write(`${JSON.stringify({ status: "enqueued", messageId: message.messageId, messagePath })}\n`);
  } else if (options.command === "validate") {
    const message = validateMailboxMessage(JSON.parse(await readFile(options.file, "utf8")));
    process.stdout.write(`${JSON.stringify({ status: "valid", messageId: message.messageId })}\n`);
  } else if (options.command === "status") {
    await initializeExchange(options.exchangeRoot);
    const counts = {};
    for (const agent of MAILBOX_AGENTS) {
      counts[agent] = {};
      for (const state of MAILBOX_STATES) {
        const entries = await readdir(mailboxDirectory(options.exchangeRoot, agent, state), { withFileTypes: true });
        counts[agent][state] = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.endsWith(".lease.json") && !entry.name.endsWith(".error.json")).length;
      }
    }
    process.stdout.write(`${JSON.stringify({ status: "ok", exchangeRoot: options.exchangeRoot, mailboxes: counts }, null, 2)}\n`);
  } else if (options.command === "claim") {
    const claim = await claimNextMailboxMessage(options.exchangeRoot, options.agent);
    process.stdout.write(`${JSON.stringify(claim ? {
      status: "claimed",
      message: claim.message,
      messagePath: claim.messagePath,
      leasePath: claim.leasePath,
      worktreeLockPath: claim.worktreeLockPath,
    } : { status: "empty" }, null, 2)}\n`);
  } else if (options.command === "heartbeat") {
    const claim = reconstructClaim(options);
    await heartbeatMailboxClaim(claim);
    process.stdout.write(`${JSON.stringify({ status: "renewed", messageId: options.messageId })}\n`);
  } else if (options.command === "finish") {
    const claim = reconstructClaim(options);
    const destination = await finalizeMailboxClaim(claim, options.state);
    process.stdout.write(`${JSON.stringify({ status: options.state, messageId: options.messageId, destination })}\n`);
  } else if (options.command === "recover") {
    const recovered = await recoverStaleMailboxClaims(options.exchangeRoot, options.agent, {
      staleAfterMs: options.staleAfterMs,
    });
    process.stdout.write(`${JSON.stringify({ status: "recovered", messageIds: recovered }, null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`[agent-mailbox] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const command = argv.shift();
  if (["--help", "-h", undefined].includes(command)) return { help: true };
  if (!["init", "enqueue", "validate", "status", "claim", "heartbeat", "finish", "recover"].includes(command)) {
    throw new Error(`Unknown mailbox command: ${command}`);
  }
  const parsed = { command, exchangeRoot: null, file: null, agent: null, messageId: null, state: null, staleAfterMs: 6 * 60 * 60_000 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--exchange") parsed.exchangeRoot = path.resolve(requiredValue(argv, ++index, argument));
    else if (argument === "--file") parsed.file = path.resolve(requiredValue(argv, ++index, argument));
    else if (argument === "--agent") parsed.agent = requiredValue(argv, ++index, argument);
    else if (argument === "--message-id") parsed.messageId = requiredValue(argv, ++index, argument);
    else if (argument === "--state") parsed.state = requiredValue(argv, ++index, argument);
    else if (argument === "--stale-after-ms") parsed.staleAfterMs = Number(requiredValue(argv, ++index, argument));
    else throw new Error(`Unknown mailbox argument: ${argument}`);
  }
  if (!parsed.exchangeRoot) throw new Error("--exchange is required");
  if (["enqueue", "validate"].includes(command) && !parsed.file) throw new Error("--file is required");
  if (["claim", "heartbeat", "finish", "recover"].includes(command) && !MAILBOX_AGENTS.includes(parsed.agent)) {
    throw new Error("--agent must be codex, claude, or grok");
  }
  if (["heartbeat", "finish"].includes(command) && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(parsed.messageId ?? "")) {
    throw new Error("--message-id must be a safe identifier");
  }
  if (command === "finish" && !["archive", "failed"].includes(parsed.state)) {
    throw new Error("--state must be archive or failed");
  }
  if (command === "recover" && (!Number.isFinite(parsed.staleAfterMs) || parsed.staleAfterMs < 60_000)) {
    throw new Error("--stale-after-ms must be at least 60000");
  }
  return parsed;
}

function reconstructClaim(options) {
  const messagePath = path.join(mailboxDirectory(options.exchangeRoot, options.agent, "processing"), `${options.messageId}.json`);
  return {
    exchangeRoot: options.exchangeRoot,
    recipient: options.agent,
    messagePath,
    leasePath: `${messagePath}.lease.json`,
  };
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function help() {
  return `VibeGal Agent mailbox\n\nUsage:\n  node scripts/agent-mailbox.mjs init --exchange <dir>\n  node scripts/agent-mailbox.mjs validate --exchange <dir> --file <message.json>\n  node scripts/agent-mailbox.mjs enqueue --exchange <dir> --file <message.json>\n  node scripts/agent-mailbox.mjs status --exchange <dir>\n  node scripts/agent-mailbox.mjs claim --exchange <dir> --agent <codex|claude|grok>\n  node scripts/agent-mailbox.mjs heartbeat --exchange <dir> --agent <agent> --message-id <id>\n  node scripts/agent-mailbox.mjs finish --exchange <dir> --agent <agent> --message-id <id> --state <archive|failed>\n  node scripts/agent-mailbox.mjs recover --exchange <dir> --agent <agent> [--stale-after-ms <ms>]\n`;
}
