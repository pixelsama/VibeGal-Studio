import path from "node:path";

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
