import path from "node:path";

export function desktopQaBuildMarkerPath(binary) {
  return `${binary}.agent-qa.json`;
}

export function desktopQaBinaryPath(root, { platform = process.platform } = {}) {
  return path.join(
    path.resolve(root),
    "packages/studio/src-tauri/target/debug",
    platform === "win32" ? "vibegal-studio.exe" : "vibegal-studio",
  );
}

export function resolveDesktopWebdriverPort(env = process.env) {
  const raw = env.VIBEGAL_AGENT_QA_WEBDRIVER_PORT ?? env.TAURI_WEBDRIVER_PORT;
  if (raw === undefined || raw === "") return 4445;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid desktop WebDriver port: ${raw}`);
  }
  return port;
}

export function validateDesktopQaBuildMetadata({ binary, metadata, actualSize, actualSha256 }) {
  if (metadata?.schemaVersion !== 1 || metadata?.flavor !== "agent-qa") {
    throw new Error(`Desktop Agent QA binary metadata is missing or invalid for ${binary}; rebuild the Agent QA binary`);
  }
  if (metadata.size !== actualSize || metadata.sha256 !== actualSha256) {
    throw new Error(`Desktop Agent QA binary is stale for ${binary}; rebuild the Agent QA binary before running desktop tests`);
  }
}

export function buildDesktopInvocation(projectRoot, { platform = process.platform } = {}) {
  const root = path.resolve(projectRoot);
  return {
    command: platform === "win32" ? "pnpm.cmd" : "pnpm",
    cwd: root,
    args: [
      "tauri",
      "build",
      "--debug",
      "--no-bundle",
      "--features",
      "agent-qa",
      "--config",
      path.join(root, "packages/studio/src-tauri/tauri.agent-qa.conf.json"),
      "--ci",
    ],
  };
}
