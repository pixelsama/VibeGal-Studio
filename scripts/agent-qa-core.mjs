import path from "node:path";

export const AGENT_QA_SUITES = Object.freeze(["quick", "desktop", "package", "release"]);

const STEP_DEFINITIONS = Object.freeze({
  "repository-contracts": {
    command: ["node", "qa/agent/run-repository-contracts.mjs"],
    timeoutMs: 20 * 60_000,
  },
  "browser-behavior": {
    command: [
      "node",
      "scripts/run-scale-benchmark.mjs",
      "__ARTIFACTS__/browser/scale.json",
      "--browser",
      "--require-browser",
    ],
    timeoutMs: 10 * 60_000,
    evidence: ["browser/scale.json"],
  },
  "agent-qa-isolation": {
    command: ["node", "scripts/check-agent-qa-isolation.mjs"],
    timeoutMs: 5 * 60_000,
  },
  "desktop-agent-build": {
    command: ["node", "qa/agent/build-desktop.mjs"],
    timeoutMs: 20 * 60_000,
    dependencies: ["agent-qa-isolation"],
    evidence: ["desktop/build.json"],
  },
  "desktop-authoring-loop": {
    command: ["node", "qa/agent/run-desktop.mjs"],
    timeoutMs: 10 * 60_000,
    dependencies: ["desktop-agent-build"],
    evidence: [
      "desktop/scenarios.ndjson",
      "desktop/junit/agent-qa.xml",
      "desktop/project-before-after.json",
      "desktop/screenshots",
    ],
  },
  "release-smoke": {
    command: ["pnpm", "smoke:release"],
    timeoutMs: 15 * 60_000,
  },
  "platform-bundle": {
    command: ["pnpm", platformBundleScript()],
    timeoutMs: 45 * 60_000,
    dependencies: ["release-smoke"],
    evidence: platformBundleEvidence(),
  },
});

const SUITE_STEPS = Object.freeze({
  quick: ["repository-contracts", "browser-behavior"],
  desktop: ["agent-qa-isolation", "desktop-agent-build", "desktop-authoring-loop"],
  package: ["release-smoke", "platform-bundle"],
  release: [
    "repository-contracts",
    "browser-behavior",
    "agent-qa-isolation",
    "desktop-agent-build",
    "desktop-authoring-loop",
    "release-smoke",
    "platform-bundle",
  ],
});

export function parseAgentQaArgs(argv) {
  const parsed = {
    suite: "quick",
    artifactsDir: null,
    only: [],
    dryRun: false,
    list: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--suite") {
      parsed.suite = requiredValue(argv, ++index, "--suite");
    } else if (argument === "--artifacts") {
      parsed.artifactsDir = path.resolve(requiredValue(argv, ++index, "--artifacts"));
    } else if (argument === "--only") {
      parsed.only = requiredValue(argv, ++index, "--only").split(",").map((value) => value.trim()).filter(Boolean);
    } else if (argument === "--dry-run") {
      parsed.dryRun = true;
    } else if (argument === "--list") {
      parsed.list = true;
    } else if (argument === "--help" || argument === "-h") {
      parsed.help = true;
    } else if (argument === "--") {
      // pnpm 11 forwards the conventional option separator to package scripts.
      // Accept it so both `pnpm qa:agent:desktop -- --list` and the shorter
      // `pnpm qa:agent:desktop --list` are stable handoff commands.
      continue;
    } else {
      throw new Error(`Unknown Agent QA argument: ${argument}`);
    }
  }
  if (!AGENT_QA_SUITES.includes(parsed.suite)) {
    throw new Error(`Unknown Agent QA suite: ${parsed.suite}`);
  }
  const knownSteps = new Set(Object.keys(STEP_DEFINITIONS));
  for (const step of parsed.only) {
    if (!knownSteps.has(step)) throw new Error(`Unknown Agent QA step: ${step}`);
  }
  return parsed;
}

export function buildAgentQaPlan(suite, { artifactsDir } = {}) {
  if (!AGENT_QA_SUITES.includes(suite)) throw new Error(`Unknown Agent QA suite: ${suite}`);
  return SUITE_STEPS[suite].map((id) => {
    const definition = STEP_DEFINITIONS[id];
    return {
      id,
      command: definition.command.map((part) => part.replace("__ARTIFACTS__", artifactsDir ?? "__ARTIFACTS__")),
      timeoutMs: definition.timeoutMs,
      dependencies: [...(definition.dependencies ?? [])],
      evidence: [...(definition.evidence ?? [])],
    };
  });
}

export function selectAgentQaPlan(plan, only) {
  if (only.length === 0) return plan;
  const planIds = new Set(plan.map((step) => step.id));
  const invalid = only.filter((id) => !planIds.has(id));
  if (invalid.length > 0) {
    throw new Error(`Agent QA step is not part of the selected suite: ${invalid.join(", ")}`);
  }
  const selected = new Set(only);
  return plan.filter((step) => selected.has(step.id));
}

export function createAgentQaReport({
  suite,
  runId,
  startedAt,
  finishedAt,
  artifactsDir,
  steps,
  environment = {},
}) {
  const hasFailure = steps.some((step) => step.status === "failed" || step.status === "timed-out");
  const hasIncomplete = steps.some((step) => step.status === "skipped" || step.status === "not-run");
  const status = hasFailure ? "failed" : hasIncomplete ? "incomplete" : "passed";
  const requiredReviews = steps.some((step) => (step.evidence ?? []).includes("desktop/screenshots"))
    ? [{
        kind: "visual",
        path: "desktop/screenshots",
        status: "pending",
        instructions: "Inspect every screenshot for clipping, overlap, loading states, and visual regressions.",
      }]
    : [];
  return {
    schemaVersion: 1,
    kind: "vibegal-agent-qa",
    suite,
    runId,
    status,
    exitCode: status === "passed" ? 0 : status === "failed" ? 1 : 2,
    startedAt,
    finishedAt,
    artifactsDir,
    environment,
    requiredReviews,
    steps,
  };
}

export function redactAgentQaText(value) {
  return String(value)
    .replace(
      /\b(APPLE_[A-Z0-9_]*(?:PASSWORD|BASE64|KEY)|WINDOWS_[A-Z0-9_]*(?:PASSWORD|BASE64|KEY)|VIBEGAL_UPDATER_SIGNING_KEY|GITHUB_TOKEN|GH_TOKEN)=([^\s]*)/gi,
      "$1=[REDACTED]",
    )
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]");
}

export function renderAgentQaHtml(report) {
  const rows = report.steps.map((step) => `
    <tr>
      <td><code>${escapeHtml(step.id)}</code></td>
      <td class="${escapeHtml(step.status)}">${escapeHtml(step.status)}</td>
      <td>${escapeHtml(formatDuration(step.durationMs))}</td>
      <td>${escapeHtml(step.error ?? "")}</td>
      <td>${(step.evidence ?? []).map((item) => `<code>${escapeHtml(item)}</code>`).join("<br>")}</td>
    </tr>`).join("");
  const review = (report.requiredReviews ?? []).length > 0
    ? `<div class="review"><strong>Visual review required.</strong> ${escapeHtml(report.requiredReviews[0].instructions)} <code>${escapeHtml(report.requiredReviews[0].path)}</code></div>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>VibeGal Agent QA ${escapeHtml(report.runId)}</title>
  <style>
    body{font:14px/1.5 system-ui,sans-serif;margin:32px;color:#20242b}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d8dde6;padding:8px;text-align:left;vertical-align:top}.passed{color:#087a43}.failed,.timed-out{color:#b42318}.skipped,.incomplete{color:#8a5b00}code{font-size:12px}h1{margin-bottom:4px}.summary{color:#56606f;margin-bottom:24px}.review{padding:12px;margin:0 0 20px;border:1px solid #e6b800;background:#fff8d8}
  </style>
</head>
<body>
  <h1>VibeGal Agent QA</h1>
  <div class="summary">suite=${escapeHtml(report.suite)} · status=${escapeHtml(report.status)} · run=${escapeHtml(report.runId)}</div>
  ${review}
  <table><thead><tr><th>Step</th><th>Status</th><th>Duration</th><th>Error</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table>
</body>
</html>\n`;
}

export function agentQaHelp() {
  return `VibeGal Agent QA\n\nUsage:\n  pnpm qa:agent -- --suite <quick|desktop|package|release> [options]\n\nOptions:\n  --artifacts <dir>  Evidence output directory\n  --only <ids>       Run comma-separated step ids\n  --dry-run          Write the plan without running commands\n  --list             Print the selected plan as JSON\n`;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function platformBundleScript() {
  if (process.platform === "darwin") return "bundle:macos";
  if (process.platform === "win32") return "bundle:windows";
  return "bundle";
}

function platformBundleEvidence() {
  const base = "packages/studio/src-tauri/target/release/bundle";
  if (process.platform === "darwin") return [`${base}/macos`, `${base}/dmg`];
  if (process.platform === "win32") return [`${base}/nsis`];
  return [base];
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDuration(value) {
  if (!Number.isFinite(value)) return "";
  return `${(value / 1000).toFixed(2)}s`;
}
