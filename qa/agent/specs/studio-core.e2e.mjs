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
    await disableMotion();
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
    await assertTitleBarGroupsDoNotOverlap();
    await browser.saveScreenshot(path.join(screenshots, "01-project-opened.png"));

    await clickButton(["剧情", "Story"]);
    await browser.$(".react-flow").waitForExist();
    await clickButton(["资产", "Assets"]);
    await browser.$("[role=grid]").waitForExist();
    await clickButton(["外观", "Appearance"]);
    await waitForAnyBodyText(["编辑外观", "Edit appearance"]);
    await clickButton(["导出", "Export"]);
    await waitForAnyBodyText(["导出游戏", "Export game"]);
    await clickButton(["项目", "Project"]);
    await waitForAnyBodyText(["项目设置", "Project settings"]);
    await waitForWorkspaceContentVisible();
    await browser.saveScreenshot(path.join(screenshots, "02-workspaces-navigated.png"));

    const titleInput = await browser.$(
      "//label[.//span[normalize-space()='作品标题' or normalize-space()='Work title']]//input",
    );
    await titleInput.waitForExist();
    await titleInput.setValue(savedTitle);
    // Spec 33 §6.1: settings auto-save after an 800ms debounce; the explicit
    // save button was removed. waitForJsonTitle polls content/meta.json.
    await waitForJsonTitle(savedTitle);
    await waitForBodyText(savedTitle);
    await waitForWorkspaceContentVisible();
    await browser.saveScreenshot(path.join(screenshots, "03-title-saved.png"));

    await browser.refresh();
    await disableMotion();
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
    await waitForWorkspaceContentVisible();
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

async function assertTitleBarGroupsDoNotOverlap() {
  const layout = await browser.execute(() => {
    const header = document.querySelector("header[data-tauri-drag-region]");
    const workspaceTab = header?.querySelector(".gs-tab");
    const history = header?.firstElementChild;
    const navigation = workspaceTab?.parentElement;
    const actions = header?.lastElementChild;
    if (!(header instanceof HTMLElement)
      || !(history instanceof HTMLElement)
      || !(navigation instanceof HTMLElement)
      || !(actions instanceof HTMLElement)) {
      return { error: "workspace title bar groups are missing" };
    }
    const headerRect = header.getBoundingClientRect();
    const childBounds = (element) => {
      const boxes = Array.from(element.children)
        .filter((child) => getComputedStyle(child).display !== "none")
        .map((child) => child.getBoundingClientRect());
      return {
        left: Math.min(...boxes.map((box) => box.left)),
        right: Math.max(...boxes.map((box) => box.right)),
      };
    };
    const historyBounds = childBounds(history);
    const navigationBounds = childBounds(navigation);
    const actionsBounds = childBounds(actions);
    const actionsOverflowPx = Array.from(actions.children).reduce((overflow, child) => {
      if (getComputedStyle(child).display === "none") return overflow;
      const childRect = child.getBoundingClientRect();
      return Math.max(
        overflow,
        headerRect.top - childRect.top,
        childRect.bottom - headerRect.bottom,
      );
    }, 0);
    return {
      historyRight: historyBounds.right,
      navigationLeft: navigationBounds.left,
      navigationRight: navigationBounds.right,
      actionsLeft: actionsBounds.left,
      overlapPx: Math.max(0, navigationBounds.right - actionsBounds.left),
      actionsOverflowPx,
    };
  });

  assert.equal(layout.error, undefined, layout.error);
  assert.ok(
    layout.historyRight <= layout.navigationLeft,
    "workspace history controls overlap the navigation",
  );
  assert.ok(
    layout.navigationRight <= layout.actionsLeft,
    `workspace navigation overlaps the project controls by ${layout.overlapPx}px`,
  );
  assert.ok(
    layout.actionsOverflowPx <= 0,
    `workspace project controls overflow the title bar by ${layout.actionsOverflowPx}px`,
  );
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
