import assert from "node:assert/strict";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const projectPath = requiredEnv("VIBEGAL_AGENT_QA_PROJECT");
const projectName = requiredEnv("VIBEGAL_AGENT_QA_PROJECT_NAME");
const initialTitle = requiredEnv("VIBEGAL_AGENT_QA_INITIAL_TITLE");
const artifacts = requiredEnv("VIBEGAL_AGENT_QA_ARTIFACTS");
const screenshots = path.join(artifacts, "desktop/screenshots");
const savedTitle = "Agent QA Saved Through UI";
const externalTitle = "Agent QA External Hot Reload";

describe("Studio real desktop authoring loop", () => {
  it("opens, navigates, saves, persists, and hot reloads through the real backend", async () => {
    await waitForBodyText("VibeGal-Studio");
    await browser.execute((recent) => {
      localStorage.clear();
      localStorage.setItem("vibegal.recentProjects.v1", JSON.stringify([recent]));
    }, {
      path: projectPath,
      name: projectName,
      lastOpenedAt: "2026-07-29T00:00:00.000Z",
    });
    await browser.refresh();
    await waitForBodyText(projectName);
    await clickContaining(projectName);
    await waitForBodyText(initialTitle);

    const trust = await buttonByTexts([
      "信任并运行项目界面风格",
      "Trust and run project interface style",
    ]);
    if (await trust.isExisting()) {
      await trust.click();
    }
    await waitForAnyBodyText(["开始游戏", "Start game"]);
    await browser.saveScreenshot(path.join(screenshots, "01-project-opened.png"));

    await clickButton(["脚本", "Script"]);
    await browser.$(".react-flow").waitForExist();
    await clickButton(["资产", "Assets"]);
    await browser.$("[role=grid]").waitForExist();
    await clickButton(["外观", "Appearance"]);
    await waitForAnyBodyText(["编辑外观", "Edit appearance"]);
    await clickButton(["导出", "Export"]);
    await waitForAnyBodyText(["导出游戏", "Export game"]);
    await clickButton(["项目", "Project"]);
    await waitForAnyBodyText(["项目设置", "Project settings"]);
    await browser.saveScreenshot(path.join(screenshots, "02-workspaces-navigated.png"));

    const titleInput = await browser.$(
      "//label[.//span[normalize-space()='作品标题' or normalize-space()='Work title']]//input",
    );
    await titleInput.waitForExist();
    await titleInput.setValue(savedTitle);
    await clickButton(["保存", "Save"]);
    await waitForJsonTitle(savedTitle);
    await waitForBodyText(savedTitle);
    await browser.saveScreenshot(path.join(screenshots, "03-title-saved.png"));

    await browser.refresh();
    await waitForBodyText(projectName);
    await clickContaining(projectName);
    await waitForBodyText(savedTitle);

    const metaFile = path.join(projectPath, "content/meta.json");
    const meta = JSON.parse(await readFile(metaFile, "utf8"));
    meta.title = externalTitle;
    const staged = `${metaFile}.agent-qa.tmp`;
    await writeFile(staged, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
    await rename(staged, metaFile);
    await waitForBodyText(externalTitle, 20_000);
    await waitForAnyBodyText(["开始游戏", "Start game"], 20_000);
    await browser.saveScreenshot(path.join(screenshots, "04-external-hot-reload.png"));

    const finalMeta = JSON.parse(await readFile(metaFile, "utf8"));
    assert.equal(finalMeta.title, externalTitle);
    assert.doesNotMatch(await browser.$("body").getText(), /工作区发生错误|Workspace failed/);
  });
});

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
      return JSON.parse(await readFile(metaFile, "utf8")).title === title;
    } catch {
      return false;
    }
  }, { timeout: 15_000, timeoutMsg: `content/meta.json did not persist ${title}` });
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
