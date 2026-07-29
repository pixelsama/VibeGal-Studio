import path from "node:path";

export function parseAgentWorkspaceArgs(argv, cwd = process.cwd()) {
  const parsed = {
    command: "setup",
    repositoryRoot: path.resolve(cwd),
    workspaceRoot: null,
    featureBranch: null,
    featureStart: "main",
    installService: false,
    dryRun: false,
  };
  const args = [...argv];
  if (args[0] === "setup") args.shift();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--repo") parsed.repositoryRoot = path.resolve(cwd, requiredValue(args, ++index, argument));
    else if (argument === "--workspace") parsed.workspaceRoot = path.resolve(cwd, requiredValue(args, ++index, argument));
    else if (argument === "--feature-branch") parsed.featureBranch = requiredValue(args, ++index, argument);
    else if (argument === "--feature-start") parsed.featureStart = requiredValue(args, ++index, argument);
    else if (argument === "--install-service") parsed.installService = true;
    else if (argument === "--dry-run") parsed.dryRun = true;
    else if (argument === "--help" || argument === "-h") parsed.help = true;
    else throw new Error(`Unknown Agent workspace argument: ${argument}`);
  }
  if (!parsed.workspaceRoot) {
    parsed.workspaceRoot = path.join(path.dirname(parsed.repositoryRoot), `${path.basename(parsed.repositoryRoot)}-workspace`);
  }
  if (!parsed.help && !parsed.featureBranch) throw new Error("--feature-branch is required");
  return parsed;
}

export function buildAgentWorkspacePlan({
  repositoryRoot,
  workspaceRoot,
  featureBranch,
  featureStart = "main",
}) {
  const source = path.resolve(repositoryRoot);
  const workspace = path.resolve(workspaceRoot);
  const relative = path.relative(source, workspace);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    throw new Error("Agent workspace root must not be nested inside the source worktree");
  }
  requireBranch(featureBranch, "featureBranch");
  requireBranch(featureStart, "featureStart");
  return {
    schemaVersion: 1,
    repositoryRoot: source,
    workspaceRoot: workspace,
    gitDir: path.join(workspace, ".git-store"),
    exchangeRoot: path.join(workspace, "exchange"),
    worktrees: [
      { slot: "main", path: path.join(workspace, "main"), branch: "main", startPoint: "main", persistent: true },
      { slot: "test", path: path.join(workspace, "test"), branch: "test", startPoint: "main", persistent: true },
      { slot: "dev", path: path.join(workspace, "dev"), branch: featureBranch, startPoint: featureStart, persistent: false },
    ],
  };
}

export function agentWorkspaceHelp() {
  return `VibeGal Agent workspace\n\nUsage:\n  pnpm agent:workspace:setup -- --feature-branch <branch> [options]\n\nOptions:\n  --workspace <dir>      Container for main/test/dev/exchange\n  --repo <dir>           Source repository used to seed the shared bare Git store\n  --feature-branch <ref> Named branch checked out in the dev slot (required)\n  --feature-start <ref>  Start point when the feature branch does not exist (default: main)\n  --install-service      Install and start the macOS Codex mailbox LaunchAgent\n  --dry-run              Print the plan without changing disk\n`;
}

export function renderLaunchAgentPlist({
  label,
  nodePath,
  dispatcherPath,
  configPath,
  stdoutPath,
  stderrPath,
  environmentPath,
}) {
  const values = { label, nodePath, dispatcherPath, configPath, stdoutPath, stderrPath };
  for (const [field, value] of Object.entries(values)) {
    if (typeof value !== "string" || value.length === 0) throw new Error(`${field} is required for LaunchAgent`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(nodePath)}</string>
    <string>${escapeXml(dispatcherPath)}</string>
    <string>--config</string>
    <string>${escapeXml(configPath)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${escapeXml(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(stderrPath)}</string>
  ${environmentPath ? `<key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${escapeXml(environmentPath)}</string>
  </dict>` : ""}
</dict>
</plist>
`;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function requireBranch(value, field) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.startsWith("-")
    || value.startsWith("/")
    || value.endsWith("/")
    || value.endsWith(".")
    || value.includes("..")
    || value.includes("@{")
    || /[\s~^:?*[\\\]]/.test(value)
  ) {
    throw new Error(`${field} must be a safe Git branch name`);
  }
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
