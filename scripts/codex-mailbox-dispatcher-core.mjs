import path from "node:path";

export function parseCodexDispatcherArgs(argv) {
  const parsed = { configPath: null, once: false, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--config") parsed.configPath = requiredValue(argv, ++index, argument);
    else if (argument === "--once") parsed.once = true;
    else if (argument === "--dry-run") parsed.dryRun = true;
    else if (argument === "--help" || argument === "-h") parsed.help = true;
    else throw new Error(`Unknown Codex dispatcher argument: ${argument}`);
  }
  if (!parsed.help && !parsed.configPath) throw new Error("--config is required");
  if (parsed.configPath && !path.isAbsolute(parsed.configPath)) throw new Error("--config must be an absolute path");
  if (parsed.configPath) parsed.configPath = path.resolve(parsed.configPath);
  return parsed;
}

export function classifyCodexRun({ exitCode, result, outputsVerified = true }) {
  if (exitCode !== 0) return { mailboxState: "failed", status: "process_failed" };
  if (
    !result
    || typeof result !== "object"
    || !["completed", "blocked", "failed"].includes(result.status)
    || typeof result.summary !== "string"
    || !Array.isArray(result.outputMessageIds)
    || result.outputMessageIds.some((id) => typeof id !== "string" || id.length === 0)
    || (result.status === "completed" && result.outputMessageIds.length === 0)
  ) {
    return { mailboxState: "failed", status: "invalid_result" };
  }
  if (result.status !== "completed") return { mailboxState: "failed", status: result.status };
  if (!outputsVerified) return { mailboxState: "failed", status: "missing_output_message" };
  return { mailboxState: "archive", status: "completed" };
}

export function createSerialRunner(task) {
  let active = null;
  return function runSerially() {
    if (active) return active;
    active = Promise.resolve()
      .then(task)
      .finally(() => {
        active = null;
      });
    return active;
  };
}

export function codexDispatcherHelp() {
  return `VibeGal Codex mailbox dispatcher\n\nUsage:\n  node codex-mailbox-dispatcher.mjs --config <absolute-workspace.json> [--once] [--dry-run]\n`;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}
