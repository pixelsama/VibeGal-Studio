import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import path from "node:path";

import {
  CLI_TIMEOUT_MS,
  SMOKE_TIMEOUT_MS,
  inspectDesktopExport,
  inspectWebExport,
  parseJsonDocument,
  parseJsonLines,
  readJson,
  runVibegalCli,
  snapshotProject,
  snapshotProjectContractFiles,
  validationExportPaths,
  waitForFiles,
  writeArtifact,
} from "../scenarios/validation-export.helpers.mjs";

const projectPath = requiredEnv("VIBEGAL_AGENT_QA_PROJECT");
const projectName = requiredEnv("VIBEGAL_AGENT_QA_PROJECT_NAME");
const initialTitle = requiredEnv("VIBEGAL_AGENT_QA_INITIAL_TITLE");
const artifacts = requiredEnv("VIBEGAL_AGENT_QA_ARTIFACTS");
const phase = requiredEnv("VIBEGAL_AGENT_QA_PHASE");
const root = path.resolve(import.meta.dirname, "../../..");
const paths = validationExportPaths({ root, artifacts });
const screenshots = path.join(artifacts, "desktop/screenshots");
const editedTitle = "Agent QA Validation Export Edited";

describe("Studio validation and export long chain", () => {
  it("edits through Studio, validates the same project, and exports runnable payloads", async () => {
    if (phase === "edit-and-validate") {
      await editAndValidate();
      return;
    }
    if (phase === "export") {
      await exportEditedProject();
      return;
    }
    throw new Error(`validation-export does not define phase ${JSON.stringify(phase)}`);
  });
});

async function editAndValidate() {
  await openProjectInStudio();
  await clickButton(["项目", "Project"]);
  await waitForAnyBodyText(["项目设置", "Project settings"]);

  const titleInput = await browser.$(
    "//label[.//span[normalize-space()='作品标题' or normalize-space()='Work title']]//input",
  );
  await titleInput.waitForExist();
  await titleInput.setValue(editedTitle);
  await waitForJsonTitle(editedTitle);
  await waitForBodyText(editedTitle);
  await waitForWorkspaceContentVisible();
  await browser.saveScreenshot(path.join(screenshots, "01-ui-edited-title.png"));

  const savedMeta = await readJson(path.join(projectPath, "content/meta.json"));
  assert.equal(savedMeta.title, editedTitle, "Studio UI edit must persist to content/meta.json");
  assert.notEqual(savedMeta.title, initialTitle, "the validation chain must use an edited project");

  const beforeValidation = await snapshotProject(projectPath);
  const validation = await runVibegalCli({
    root,
    args: ["validate", projectPath, "--format", "json"],
    timeoutMs: CLI_TIMEOUT_MS,
  });
  assert.equal(validation.code, 0, formatProcessFailure("validate", validation));
  const output = parseJsonDocument(validation, "vibegal-cli validate");
  assertValidateOutput(output);
  assert.equal(await realpath(output.projectPath), await realpath(projectPath));
  assert.deepEqual(await snapshotProject(projectPath), beforeValidation);

  await writeArtifact(paths.cliReport, {
    schemaVersion: 1,
    scenario: "validation-export",
    phase,
    projectPath,
    editedTitle,
    validation: summarizeProcess(validation, output),
    projectContractFiles: await snapshotProjectContractFiles(projectPath),
    projectFileCount: beforeValidation.fileCount,
  });
}

async function exportEditedProject() {
  await openProjectInStudio(editedTitle);
  const meta = await readJson(path.join(projectPath, "content/meta.json"));
  assert.equal(meta.title, editedTitle, "export phase must reuse the persisted UI edit");
  assert.notEqual(meta.title, initialTitle, "export must not use the unedited sample project");

  assert.notEqual(path.resolve(paths.webOut), path.resolve(projectPath));
  assert.notEqual(path.resolve(paths.desktopOut), path.resolve(projectPath));
  const beforeBuild = await snapshotProject(projectPath);

  const webBuild = await runVibegalCli({
    root,
    args: [
      "build",
      projectPath,
      "--target",
      "web",
      "--out",
      paths.webOut,
      "--format",
      "json",
      "--progress",
      "jsonl",
    ],
    timeoutMs: CLI_TIMEOUT_MS,
  });
  assert.equal(webBuild.code, 0, formatProcessFailure("Web build", webBuild));
  const webProgress = parseJsonLines(webBuild, "vibegal-cli Web build");
  assertProgressContract(webProgress, "web");
  const webInspection = await inspectWebExport(paths.webOut);
  assert.equal(webInspection.gameManifest.buildTarget, "web");
  assert.equal(webInspection.gameManifest.title, editedTitle);
  assert.equal(webInspection.gameManifest.rendererId, "default");
  assert.equal(webInspection.payload.indexReferencesRuntime, true);
  assert.ok(webInspection.payload.runtimeBytes > 0);

  const webSmoke = await runVibegalCli({
    root,
    args: ["smoke", paths.webOut, "--target", "web", "--format", "json"],
    timeoutMs: SMOKE_TIMEOUT_MS,
  });
  assert.equal(webSmoke.code, 0, formatProcessFailure("Web smoke", webSmoke));
  const webSmokeOutput = parseJsonDocument(webSmoke, "vibegal-cli Web smoke");
  assert.equal(webSmokeOutput.ok, true);
  assert.equal(webSmokeOutput.target, "web");
  assertIncludes(webSmokeOutput.checks, ["index", "gameManifest", "runtime", "content", "assets", "browserBehavior"]);

  const desktopBuild = await runVibegalCli({
    root,
    args: [
      "build",
      projectPath,
      "--target",
      "desktop",
      "--runtime",
      "tauri",
      "--out",
      paths.desktopOut,
      "--format",
      "json",
      "--progress",
      "jsonl",
    ],
    timeoutMs: CLI_TIMEOUT_MS,
  });
  assert.equal(desktopBuild.code, 0, formatProcessFailure("Tauri desktop build", desktopBuild));
  const desktopProgress = parseJsonLines(desktopBuild, "vibegal-cli Tauri desktop build");
  assertProgressContract(desktopProgress, "desktop");
  const desktopInspection = await inspectDesktopExport(paths.desktopOut);
  assert.equal(desktopInspection.desktopManifest.runtime, "tauri");
  assert.equal(desktopInspection.desktopManifest.mode, "lightweight");
  assert.equal(desktopInspection.desktopManifest.title, editedTitle);
  assert.ok(desktopInspection.payload.executableBytes > 0);

  const desktopSmoke = await runVibegalCli({
    root,
    args: [
      "smoke",
      paths.desktopOut,
      "--target",
      "desktop",
      "--runtime",
      "tauri",
      "--format",
      "json",
    ],
    timeoutMs: SMOKE_TIMEOUT_MS,
  });
  assert.equal(desktopSmoke.code, 0, formatProcessFailure("Tauri desktop smoke", desktopSmoke));
  const desktopSmokeOutput = parseJsonDocument(desktopSmoke, "vibegal-cli Tauri desktop smoke");
  assert.equal(desktopSmokeOutput.ok, true);
  assert.equal(desktopSmokeOutput.runtime, "tauri");
  assertIncludes(desktopSmokeOutput.checks, ["desktopManifest", "desktopExecutable", "webPayload", "desktopBehavior"]);

  const afterBuild = await snapshotProject(projectPath);
  assert.deepEqual(afterBuild, beforeBuild, "exports must not mutate the input project");

  await waitForFiles([
    path.join(paths.webOut, "game.manifest.json"),
    path.join(paths.webOut, "runtime/bundle.js"),
    path.join(paths.desktopOut, "desktop.manifest.json"),
  ]);
  await writeArtifact(paths.exportReport, {
    schemaVersion: 1,
    scenario: "validation-export",
    phase,
    projectPath,
    editedTitle,
    inputProjectUnchanged: true,
    outputs: {
      web: {
        outDir: paths.webOut,
        build: summarizeProcess(webBuild, webProgress.final),
        inspection: webInspection,
        smoke: summarizeProcess(webSmoke, webSmokeOutput),
      },
      desktop: {
        outDir: paths.desktopOut,
        build: summarizeProcess(desktopBuild, desktopProgress.final),
        inspection: desktopInspection,
        smoke: summarizeProcess(desktopSmoke, desktopSmokeOutput),
      },
    },
  });
}

async function openProjectInStudio(expectedTitle = initialTitle) {
  await waitForBodyText("VibeGal-Studio");
  await browser.execute((recent) => {
    localStorage.clear();
    localStorage.setItem("vibegal.recentProjects.v1", JSON.stringify([recent]));
  }, {
    path: projectPath,
    name: projectName,
    lastOpenedAt: "2026-08-01T00:00:00.000Z",
  });
  await browser.refresh();
  await disableMotion();
  await waitForBodyText(projectName);
  await clickContaining(projectName);
  await waitForBodyText(expectedTitle);

  const trust = await buttonByTexts([
    "信任并运行项目界面风格",
    "Trust and run project interface style",
  ]);
  await browser.waitUntil(async () => {
    const body = await browser.$("body").getText();
    return await trust.isExisting() || ["开始游戏", "Start game"].some((text) => body.includes(text));
  }, {
    timeout: 20_000,
    timeoutMsg: "project preview did not reach the trust prompt or title screen",
  });
  if (await trust.isExisting()) {
    await trust.waitForClickable();
    await trust.click();
  }
  await waitForAnyBodyText(["开始游戏", "Start game"]);
}

function assertValidateOutput(output) {
  assert.deepEqual(
    Object.keys(output).sort(),
    ["assetIssues", "graphIssues", "ok", "projectIssues", "projectPath"].sort(),
    "validate --format json must keep the structured CLI contract",
  );
  assert.equal(output.ok, true);
  assert.ok(Array.isArray(output.projectIssues));
  assert.ok(Array.isArray(output.graphIssues));
  assert.ok(Array.isArray(output.assetIssues));
  assert.equal(output.projectIssues.length, 0);
  assert.equal(output.graphIssues.length, 0);
  assert.equal(output.assetIssues.length, 0);
}

function assertProgressContract(progress, target) {
  assert.ok(progress.values.length >= 2, `${target} build must emit progress and a final result`);
  assert.equal(progress.values[0].type, "progress");
  assert.equal(progress.values[0].step, "validate");
  assert.equal(progress.final.ok, true);
  assert.equal(progress.final.target, target);
  assert.equal(progress.final.type, undefined, "final build result must be a JSON document, not a progress event");
}

function assertIncludes(actual, expected) {
  for (const item of expected) assert.ok(actual.includes(item), `missing smoke check ${item}: ${actual.join(", ")}`);
}

function summarizeProcess(processResult, parsedOutput) {
  return {
    command: [processResult.command, ...processResult.args],
    kind: processResult.kind,
    exitCode: processResult.code,
    signal: processResult.signal,
    timedOut: processResult.timedOut,
    durationMs: processResult.durationMs,
    stderr: processResult.stderr,
    output: parsedOutput,
  };
}

function formatProcessFailure(label, result) {
  return `${label} failed: exit=${result.code}, timedOut=${result.timedOut}, stderr=${result.stderr}`;
}

async function clickButton(texts) {
  const button = await buttonByTexts(texts);
  await button.waitForClickable();
  await button.click();
}

async function clickContaining(text) {
  const button = await browser.$(`//button[contains(normalize-space(.), ${xpathLiteral(text)})]`);
  await button.waitForClickable();
  await button.click();
}

async function buttonByTexts(texts) {
  return browser.$(`//button[${texts.map((text) => `normalize-space(.)=${xpathLiteral(text)}`).join(" or ")}]`);
}

async function waitForBodyText(text, timeout = 15_000) {
  await browser.waitUntil(async () => (await browser.$("body").getText()).includes(text), {
    timeout,
    timeoutMsg: `body did not contain ${JSON.stringify(text)}`,
  });
}

async function waitForAnyBodyText(texts, timeout = 15_000) {
  await browser.waitUntil(async () => {
    const body = await browser.$("body").getText();
    return texts.some((text) => body.includes(text));
  }, { timeout, timeoutMsg: `body did not contain any of ${JSON.stringify(texts)}` });
}

async function waitForJsonTitle(title) {
  const metaFile = path.join(projectPath, "content/meta.json");
  await browser.waitUntil(async () => {
    try {
      return (await readJson(metaFile)).title === title;
    } catch {
      return false;
    }
  }, { timeout: 15_000, timeoutMsg: `content/meta.json did not persist ${title}` });
}

async function disableMotion() {
  await browser.execute(() => {
    const id = "vibegal-agent-qa-disable-motion";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = "*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important}";
    document.head.append(style);
  });
}

async function waitForWorkspaceContentVisible() {
  await browser.waitUntil(() => browser.execute(() => {
    const header = document.querySelector("header[data-tauri-drag-region]");
    const content = header?.nextElementSibling;
    if (!(content instanceof HTMLElement)) return false;
    const style = getComputedStyle(content);
    return style.visibility !== "hidden"
      && style.display !== "none"
      && Number(style.opacity) >= 0.99
      && content.getBoundingClientRect().height > 0;
  }), {
    timeout: 5_000,
    timeoutMsg: "workspace content did not finish becoming visible",
  });
}

function xpathLiteral(value) {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat(${value.split("'").map((part) => `'${part}'`).join(", \"'\", ")})`;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
