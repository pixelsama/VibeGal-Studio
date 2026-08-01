import assert from "node:assert/strict";
import path from "node:path";
import { realpath } from "node:fs/promises";

import {
  assertRequiredProjectFiles,
  assertSentinelUnchanged,
  prepareLifecycleDirectory,
  readSentinelSnapshot,
  readJson,
} from "../scenarios/project-lifecycle.helpers.mjs";

const projectPath = requiredEnv("VIBEGAL_AGENT_QA_PROJECT");
const projectParentPath = requiredEnv("VIBEGAL_AGENT_QA_PROJECT_PARENT");
const fixtureProfile = requiredEnv("VIBEGAL_AGENT_QA_FIXTURE_PROFILE");
const fixtureProjectName = requiredEnv("VIBEGAL_AGENT_QA_PROJECT_NAME");
const fixtureInitialTitle = requiredEnv("VIBEGAL_AGENT_QA_INITIAL_TITLE");
const phase = requiredEnv("VIBEGAL_AGENT_QA_PHASE");
const artifacts = requiredEnv("VIBEGAL_AGENT_QA_ARTIFACTS");
const projectName = fixtureProfile === "empty-parent" ? path.basename(projectPath) : fixtureProjectName;
const projectTitle = fixtureProfile === "empty-parent" ? path.basename(projectPath) : fixtureInitialTitle;
const screenshots = path.join(artifacts, "desktop/screenshots");

describe("Project lifecycle", () => {
  if (phase === "create") it("creates or prepares an isolated project, opens it, and returns to the project list", async () => {
    await waitForBodyText("VibeGal-Studio");
    await disableMotion();

    const parentSentinel = await readSentinelSnapshot({
      path: path.join(projectParentPath, "existing-user-file.txt"),
      content: "must remain unchanged\n",
      sha256: "",
    }).catch(() => null);

    let projectSentinel;
    if (fixtureProfile === "empty-parent") {
      // The native Tauri directory picker is not controllable through the
      // embedded WebDriver provider. Prepare the selected directory through
      // the real backend command, then exercise the user-visible open/close
      // journey below. This keeps the scenario runnable without GUI scripts.
      projectSentinel = await prepareLifecycleDirectory(projectPath);
      await initializeProjectThroughBackend(projectPath);
    } else {
      projectSentinel = await prepareLifecycleDirectory(projectPath);
    }

    await assertRequiredProjectFiles(projectPath, {
      initialized: fixtureProfile === "empty-parent",
      expectedProjectName: projectName,
      expectedTitle: projectTitle,
    });
    if (projectSentinel) {
      assertSentinelUnchanged(projectSentinel, await readSentinelSnapshot(projectSentinel), "project sentinel");
    }
    if (parentSentinel) {
      assertSentinelUnchanged(parentSentinel, await readSentinelSnapshot(parentSentinel), "parent sentinel");
    }

    await openRecentProject(projectPath, projectName);
    await trustRendererIfPrompted();
    await waitForAnyBodyText(["开始游戏", "Start game"]);
    await skipBlankProjectGuideIfPresent();
    await waitForAnyBodyText(["开始游戏", "Start game"]);
    assert.match(await browser.$("body").getText(), new RegExp(escapeRegExp(projectTitle)));
    await browser.saveScreenshot(path.join(screenshots, "01-project-created-and-opened.png"));

    await closeProjectToList();
    await browser.saveScreenshot(path.join(screenshots, "02-project-closed-to-list.png"));
    await waitForBodyText("VibeGal-Studio");
    await waitForBodyText(projectName);
  });

  if (phase === "reopen") it("reopens the same project after a runner-managed application restart", async () => {
    await waitForBodyText("VibeGal-Studio");
    await disableMotion();
    await assertRequiredProjectFiles(projectPath, {
      initialized: fixtureProfile === "empty-parent",
      expectedProjectName: projectName,
      expectedTitle: projectTitle,
    });

    const projectSentinel = await readSentinelSnapshot({
      path: path.join(projectPath, "user-sentinel.txt"),
      content: "",
      sha256: "",
    }).catch(() => null);
    const parentSentinel = await readSentinelSnapshot({
      path: path.join(projectParentPath, "existing-user-file.txt"),
      content: "must remain unchanged\n",
      sha256: "",
    }).catch(() => null);

    await openRecentProject(projectPath, projectName);
    await trustRendererIfPrompted();
    await waitForAnyBodyText(["开始游戏", "Start game"]);
    await skipBlankProjectGuideIfPresent();
    await waitForAnyBodyText(["开始游戏", "Start game"]);

    const persistedProject = await readJson(projectPath, "gal.project.json");
    const persistedMeta = await readJson(projectPath, "content/meta.json");
    assert.equal(persistedProject.name, projectName);
    assert.equal(persistedMeta.title, projectTitle);
    if (projectSentinel) {
      assertSentinelUnchanged(projectSentinel, await readSentinelSnapshot(projectSentinel), "project sentinel");
    }
    if (parentSentinel) {
      assertSentinelUnchanged(parentSentinel, await readSentinelSnapshot(parentSentinel), "parent sentinel");
    }
    assert.doesNotMatch(await browser.$("body").getText(), /工作区发生错误|Workspace failed/);
    await browser.saveScreenshot(path.join(screenshots, "03-project-reopened.png"));
  });
});

async function initializeProjectThroughBackend(selectedPath) {
  const response = await browser.executeAsync((pathValue, done) => {
    const tauri = window.__TAURI__;
    if (!tauri?.core?.invoke) {
      done({ error: "window.__TAURI__.core.invoke is unavailable" });
      return;
    }
    tauri.core.invoke("initialize_project", { path: pathValue })
      .then((result) => done({ result }))
      .catch((error) => done({ error: String(error) }));
  }, selectedPath);
  assert.equal(response?.error, undefined, response?.error);
  const result = response?.result;
  assert.equal(
    result?.path,
    await realpath(selectedPath),
    "initialize_project should return the canonical selected project path",
  );
}

async function openRecentProject(selectedPath, name) {
  await browser.execute((recent) => {
    localStorage.clear();
    localStorage.setItem("vibegal.recentProjects.v1", JSON.stringify([recent]));
  }, {
    path: selectedPath,
    name,
    lastOpenedAt: "2026-08-01T00:00:00.000Z",
  });
  await browser.refresh();
  await waitForBodyText(name);
  await clickContaining(name);
}

async function skipBlankProjectGuideIfPresent() {
  const skip = await buttonByTexts(["暂时跳过", "Skip for now"]);
  if (await skip.isExisting()) {
    await skip.click();
  }
}

async function trustRendererIfPrompted() {
  await waitForAnyBodyText([
    "信任并运行项目界面风格",
    "Trust and run project interface style",
    "开始游戏",
    "Start game",
  ]);
  const trust = await buttonByTexts([
    "信任并运行项目界面风格",
    "Trust and run project interface style",
  ]);
  if (await trust.isExisting()) {
    await trust.click();
  }
}

async function closeProjectToList() {
  const back = await browser.$(
    "button[aria-label='后退'], button[aria-label='返回'], button[aria-label='Back']",
  );
  await back.waitForClickable();
  await back.click();
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

async function waitForAnyBodyText(texts, timeout = 20_000) {
  await browser.waitUntil(async () => {
    const body = await browser.$("body").getText();
    return texts.some((text) => body.includes(text));
  }, {
    timeout,
    timeoutMsg: `body did not contain any of ${JSON.stringify(texts)}`,
  });
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

function xpathLiteral(value) {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat(${value.split("'").map((part) => `'${part}'`).join(", \"'\", ")})`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
