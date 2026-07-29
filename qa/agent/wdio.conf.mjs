import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const artifacts = path.resolve(process.env.VIBEGAL_AGENT_QA_ARTIFACTS ?? path.join(root, "artifacts/agent-qa/standalone"));
const desktopArtifacts = path.join(artifacts, "desktop");
const screenshotDir = path.join(desktopArtifacts, "screenshots");
const junitDir = path.join(desktopArtifacts, "junit");
const logDir = path.join(desktopArtifacts, "webdriver-logs");
const binary = path.join(
  root,
  "packages/studio/src-tauri/target/debug",
  process.platform === "win32" ? "vibegal-studio.exe" : "vibegal-studio",
);

for (const directory of [desktopArtifacts, screenshotDir, junitDir, logDir]) mkdirSync(directory, { recursive: true });

export const config = {
  runner: "local",
  specs: [path.join(root, "qa/agent/specs/**/*.e2e.mjs")],
  maxInstances: 1,
  capabilities: [{
    browserName: "tauri",
    "tauri:options": { application: binary },
  }],
  services: [["@wdio/tauri-service", {
    appBinaryPath: binary,
    driverProvider: "embedded",
    embeddedPort: Number(process.env.VIBEGAL_AGENT_QA_WEBDRIVER_PORT ?? 4445),
    captureBackendLogs: true,
    captureFrontendLogs: true,
    backendLogLevel: "info",
    frontendLogLevel: "warn",
    logLevel: process.env.VIBEGAL_AGENT_QA_LOG_LEVEL ?? "warn",
    logDir,
    startTimeout: 60_000,
    commandTimeout: 30_000,
  }]],
  logLevel: process.env.VIBEGAL_AGENT_QA_LOG_LEVEL ?? "warn",
  bail: 0,
  waitforTimeout: 15_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 2,
  framework: "mocha",
  mochaOpts: { ui: "bdd", timeout: 180_000 },
  reporters: [
    "spec",
    ["junit", {
      outputDir: junitDir,
      outputFileFormat: () => "agent-qa.xml",
      addFileAttribute: true,
    }],
  ],
  before: async () => {
    await browser.setWindowSize(1440, 1000);
  },
  afterTest: async (test, _context, result) => {
    const scenario = {
      id: `${test.parent ?? "Agent QA"} / ${test.title}`,
      status: result.passed ? "passed" : "failed",
      durationMs: result.duration,
      retries: result.retries?.attempts ?? 0,
      ...(result.error ? { error: String(result.error.message ?? result.error) } : {}),
    };
    if (!result.passed) {
      const screenshot = path.join(screenshotDir, `${safeName(test.title)}-failed.png`);
      try {
        await browser.saveScreenshot(screenshot);
        scenario.screenshot = path.relative(artifacts, screenshot);
      } catch (error) {
        scenario.screenshotError = String(error);
      }
    }
    appendFileSync(path.join(desktopArtifacts, "scenarios.ndjson"), `${JSON.stringify(scenario)}\n`, "utf8");
  },
};

function safeName(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "scenario";
}
