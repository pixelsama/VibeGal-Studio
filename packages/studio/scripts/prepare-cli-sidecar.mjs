import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(__dirname, "..");
const srcTauriRoot = path.join(studioRoot, "src-tauri");

function targetTriple() {
  const platform = process.env.TAURI_ENV_PLATFORM || process.platform;
  const arch = process.env.TAURI_ENV_ARCH || process.arch;

  if (platform === "darwin" && arch === "aarch64") return "aarch64-apple-darwin";
  if (platform === "darwin" && arch === "x86_64") return "x86_64-apple-darwin";
  if (platform === "darwin" && arch === "arm64") return "aarch64-apple-darwin";
  if (platform === "linux" && (arch === "x86_64" || arch === "x64")) return "x86_64-unknown-linux-gnu";
  if (platform === "windows" && (arch === "x86_64" || arch === "x64")) return "x86_64-pc-windows-msvc";

  throw new Error(`Unsupported Tauri sidecar target: platform=${platform} arch=${arch}`);
}

const isWindows = (process.env.TAURI_ENV_PLATFORM || process.platform) === "windows";
const executableName = isWindows ? "galstudio-cli.exe" : "galstudio-cli";
const source = path.join(srcTauriRoot, "target", "release", executableName);
const destinationDir = path.join(srcTauriRoot, "binaries");
const destination = path.join(
  destinationDir,
  `${isWindows ? "galstudio-cli" : executableName}-${targetTriple()}${isWindows ? ".exe" : ""}`,
);

if (!existsSync(source)) {
  throw new Error(`Cannot bundle galstudio-cli because the release binary is missing: ${source}`);
}

mkdirSync(destinationDir, { recursive: true });
copyFileSync(source, destination);
chmodSync(destination, 0o755);

console.log(`Prepared GalStudio CLI sidecar: ${destination}`);
