import assert from "node:assert/strict";
import path from "node:path";

import {
  ASSET_FILE_NAME,
  ASSET_ID,
  ASSET_RELATIVE_PATH,
  assertAssetMissingFromProject,
  assertAssetReference,
  assertAssetRegistered,
  assetPaths,
  ensureTemporaryAsset,
  moveImportedAssetAway,
  readProjectManifest,
  readProjectNode,
  waitForPathState,
} from "../scenarios/asset-workflow.helpers.mjs";

const projectPath = requiredEnv("VIBEGAL_AGENT_QA_PROJECT");
const projectName = requiredEnv("VIBEGAL_AGENT_QA_PROJECT_NAME");
const initialTitle = requiredEnv("VIBEGAL_AGENT_QA_INITIAL_TITLE");
const artifacts = requiredEnv("VIBEGAL_AGENT_QA_ARTIFACTS");
const phase = requiredEnv("VIBEGAL_AGENT_QA_PHASE");
const screenshots = path.join(artifacts, "desktop/screenshots");

if (phase === "import-and-reference") {
  describe("Asset workflow / import and reference", () => {
    it("imports through Studio, references the asset in a node, and previews it", async () => {
      await openProject();
      const sourcePath = await ensureTemporaryAsset(projectPath);

      await clickButton(["资产", "Assets"]);
      await waitForAssetWorkspace();
      await clickButton(["背景", "Background"]);
      await waitForAssetWorkspace();
      await importAssetThroughStudio(sourcePath);

      await waitForPathState(assetPaths(projectPath).projectAssetPath, "present");
      await waitForBodyText(ASSET_ID);
      const importedManifest = await readProjectManifest(projectPath);
      assertAssetRegistered(importedManifest);
      await assertAssetGridShowsRegisteredAsset();
      await browser.saveScreenshot(path.join(screenshots, "01-asset-imported.png"));

      await referenceAssetInScript();
      const node = await readProjectNode(projectPath);
      assertAssetReference(node);
      const referencedManifest = await readProjectManifest(projectPath);
      assertAssetRegistered(referencedManifest);
      await clickButton(["资产", "Assets"]);
      await clickButton(["背景", "Background"]);
      await waitForAssetWorkspace();
      await assertAssetGridShowsStoryReference();
      await clickButton(["剧情", "Story"]);
      await openPrologueNode();
      await waitForScriptEditor();
      await assertPreviewShowsImportedBackground();
      await browser.saveScreenshot(path.join(screenshots, "02-asset-referenced-and-previewed.png"));
    });
  });
} else if (phase === "repair-reference") {
  describe("Asset workflow / repair reference", () => {
    it("detects an externally renamed asset, repairs it through Studio, and persists after reopen", async () => {
      await openProject();
      const sourcePath = await ensureTemporaryAsset(projectPath);
      const before = await readProjectManifest(projectPath);
      assertAssetRegistered(before);
      assertAssetReference(await readProjectNode(projectPath));

      await moveImportedAssetAway(projectPath);
      await assertAssetMissingFromProject(projectPath);

      await clickButton(["资产", "Assets"]);
      await waitForAssetWorkspace();
      await clickButton(["背景", "Background"]);
      await waitForAssetWorkspace();
      await waitForMissingAssetCard();
      await assertProjectIssue("missing_asset");
      await browser.saveScreenshot(path.join(screenshots, "03-missing-asset-diagnosis.png"));

      // AssetsWorkspace's delete action intentionally prunes references. Use
      // the explicit dangling-card repair action, then re-import the same real
      // external source through the Studio picker so the story reference stays
      // intact and the manifest/file pair is repaired together.
      await clickButton(["移除引用", "Remove reference"]);
      await waitForManifestWithoutAsset();
      await importAssetThroughStudio(sourcePath);
      await waitForPathState(assetPaths(projectPath).projectAssetPath, "present");
      await waitForBodyText(ASSET_ID);
      await waitForManifestWithAsset();
      await waitForNoMissingAssetIssue();

      const repairedManifest = await readProjectManifest(projectPath);
      assertAssetRegistered(repairedManifest);
      assertAssetReference(await readProjectNode(projectPath));
      await clickButton(["剧情", "Story"]);
      await openPrologueNode();
      await waitForScriptEditor();
      await assertPreviewShowsImportedBackground();
      await browser.saveScreenshot(path.join(screenshots, "04-asset-repaired.png"));

      await browser.refresh();
      await openProjectFromRecentList();
      await waitForBodyText(initialTitle);
      const trust = await buttonByTexts([
        "信任并运行项目界面风格",
        "Trust and run project interface style",
      ]);
      if (await trust.isExisting()) await trust.click();
      await waitForAnyBodyText(["开始游戏", "Start game"]);
      await clickButton(["剧情", "Story"]);
      await openPrologueNode();
      await waitForScriptEditor();
      await waitForNoMissingAssetIssue();
      assertAssetReference(await readProjectNode(projectPath));
      assertAssetRegistered(await readProjectManifest(projectPath));
      await assertPreviewShowsImportedBackground();
      await browser.saveScreenshot(path.join(screenshots, "05-asset-repaired-after-reopen.png"));
    });
  });
} else {
  describe("Asset workflow", () => {
    it(`does not support unexpected phase ${JSON.stringify(phase)}`, () => {
      throw new Error(`asset-workflow expects import-and-reference or repair-reference, got ${phase}`);
    });
  });
}

async function openProject() {
  await waitForBodyText("VibeGal-Studio");
  await disableMotion();
  await openProjectFromRecentList();
  await waitForBodyText(initialTitle);
  const trust = await buttonByTexts([
    "信任并运行项目界面风格",
    "Trust and run project interface style",
  ]);
  if (await trust.isExisting()) await trust.click();
  await waitForAnyBodyText(["开始游戏", "Start game"]);
  assert.doesNotMatch(await browser.$("body").getText(), /工作区发生错误|Workspace failed/);
}

async function openProjectFromRecentList() {
  await browser.execute((recent) => {
    localStorage.clear();
    localStorage.setItem("vibegal.recentProjects.v1", JSON.stringify([recent]));
  }, {
    path: projectPath,
    name: projectName,
    lastOpenedAt: "2026-08-01T00:00:00.000Z",
  });
  await browser.refresh();
  await waitForBodyText(projectName);
  await clickContaining(projectName);
}

async function reopenProjectAfterExternalImport() {
  // import_asset is intentionally invoked through the QA Tauri bridge, so it
  // does not emit the editor's file-watcher event. Reopen through the normal
  // Studio path to obtain a fresh asset report before exercising registration.
  await openProjectFromRecentList();
  await waitForBodyText(initialTitle);
  const trust = await buttonByTexts([
    "信任并运行项目界面风格",
    "Trust and run project interface style",
  ]);
  if (await trust.isExisting()) await trust.click();
  await clickButton(["资产", "Assets"]);
  await waitForAssetWorkspace();
  await clickButton(["背景", "Background"]);
  await waitForAssetWorkspace();
}

async function waitForAssetWorkspace() {
  await browser.waitUntil(async () => await browser.execute(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const nav = [...document.querySelectorAll("nav")].find((element) =>
      ["资产分类", "Asset categories"].includes(element.getAttribute("aria-label") ?? ""),
    );
    const current = nav?.querySelector("button[aria-current='page']");
    return Boolean(nav && current && visible(nav) && visible(current));
  }), {
    timeout: 20_000,
    timeoutMsg: "asset workspace sidebar did not become visible",
  });
  await waitForAnyBodyText(["资产", "Assets"]);
}

async function referenceAssetInScript() {
  await clickButton(["剧情", "Story"]);
  await openPrologueNode();
  await waitForScriptEditor();

  const textArea = await scenarioTextArea();
  const current = await textArea.getValue();
  assert.match(current, /@bg\s+ocean_night\b/, "sample prologue should contain a background instruction to replace");
  const next = current.replace(/@bg\s+ocean_night\b/, `@bg ${ASSET_ID}`);
  await textArea.setValue(next);
  await waitForAnyBodyText(["未保存", "Unsaved"]);
  await clickButton(["保存", "Save"]);
  await waitForNodeToPersistReference();
}

async function openPrologueNode() {
  const node = await browser.$(
    "//div[@role='list']//button[.//*[normalize-space()='序章'] or .//*[normalize-space()='Prologue']]",
  );
  await node.waitForClickable();
  await node.click();
  const enter = await buttonByTexts(["进入编辑", "Open editor", "Edit node"]);
  await enter.waitForClickable();
  await enter.click();
}

async function waitForScriptEditor() {
  const textArea = await scenarioTextArea();
  await textArea.waitForExist();
  await waitForAnyBodyText(["剧本", "Script"]);
}

async function scenarioTextArea() {
  const textArea = await browser.$(
    "textarea[aria-label='剧本文本'], textarea[aria-label='Script text']",
  );
  await textArea.waitForExist();
  return textArea;
}

async function assertAssetGridShowsRegisteredAsset() {
  const grid = await browser.$("[role=grid]");
  await grid.waitForExist();
  await browser.waitUntil(async () => (await grid.getText()).includes(ASSET_ID), {
    timeout: 15_000,
    timeoutMsg: `asset grid did not show ${ASSET_ID}`,
  });
  const gridText = await grid.getText();
  assert.match(gridText, /登记|Registered/, "imported asset should be shown as registered");
}

async function assertAssetGridShowsStoryReference() {
  const grid = await browser.$("[role=grid]");
  await browser.waitUntil(async () => /剧本：?\s*[1-9]|Story\s*[1-9]/.test(await grid.getText()), {
    timeout: 15_000,
    timeoutMsg: "asset grid did not show a non-zero story reference count",
  });
}

async function assertPreviewShowsImportedBackground() {
  const start = await browser.$('[data-title-action="start"]');
  if (await start.isExisting()) {
    await browser.execute(() => {
      const button = document.querySelector('[data-title-action="start"]');
      if (!(button instanceof HTMLButtonElement)) throw new Error("title start button was not found");
      if (button.disabled) throw new Error("title start button is disabled");
      button.click();
    });
    await browser.$('[data-player-stage][data-player-screen="story"]').waitForExist({ timeout: 15_000 });
  }
  // The prologue begins with a transition, then the imported background. Keep
  // stepping until the semantic runtime output appears so WebKit/Edge do not
  // race the renderer remount after the node editor is reopened.
  try {
    await browser.waitUntil(async () => {
      const background = await browser.$("img[data-runtime-background='true']");
      if (await background.isExisting()) {
        const src = await background.getAttribute("src");
        if (typeof src === "string" && src.includes(ASSET_FILE_NAME)) return true;
      }
      const nextButton = await browser.$(
        "button[aria-label='下一条指令'], button[aria-label='Next instruction'], "
        + "button[title='下一条指令'], button[title='Next instruction']",
      );
      if (await nextButton.isClickable()) await nextButton.click();
      return false;
    }, {
      timeout: 15_000,
      interval: 250,
      timeoutMsg: `preview background did not resolve to ${ASSET_FILE_NAME}`,
    });
  } catch (error) {
    const diagnostic = await browser.execute(() => ({
      body: document.body.innerText,
      stages: [...document.querySelectorAll("[data-player-stage]")].map((element) => ({
        screen: element.getAttribute("data-player-screen"),
        blocking: element.getAttribute("data-player-blocking"),
      })),
      backgrounds: [...document.querySelectorAll("img[data-runtime-background='true']")]
        .map((element) => element.getAttribute("src")),
      selects: [...document.querySelectorAll("select")].map((element) => ({
        label: element.getAttribute("aria-label"),
        value: element.value,
      })),
    }));
    throw new Error(`${error instanceof Error ? error.message : String(error)}; DOM=${JSON.stringify(diagnostic)}`);
  }
}

async function waitForNodeToPersistReference() {
  await browser.waitUntil(async () => {
    try {
      return (await readProjectNode(projectPath)).some(
        (instruction) => instruction?.t === "bg" && instruction.id === ASSET_ID,
      );
    } catch {
      return false;
    }
  }, {
    timeout: 15_000,
    timeoutMsg: `node file did not persist background ${ASSET_ID}`,
  });
}

async function waitForMissingAssetCard() {
  await browser.waitUntil(async () => {
    const body = await browser.$("body").getText();
    return body.includes(ASSET_ID) && /文件缺失|File missing/.test(body);
  }, {
    timeout: 20_000,
    timeoutMsg: `Studio did not show dangling asset ${ASSET_ID}`,
  });
}

async function waitForManifestWithoutAsset() {
  await browser.waitUntil(async () => {
    const manifest = await readProjectManifest(projectPath);
    return manifest.backgrounds?.[ASSET_ID] === undefined;
  }, {
    timeout: 15_000,
    timeoutMsg: `manifest still contains removed dangling asset ${ASSET_ID}`,
  });
}

async function waitForManifestWithAsset() {
  await browser.waitUntil(async () => {
    try {
      return (await readProjectManifest(projectPath)).backgrounds?.[ASSET_ID] === ASSET_RELATIVE_PATH;
    } catch {
      return false;
    }
  }, {
    timeout: 15_000,
    timeoutMsg: `manifest did not restore ${ASSET_ID}`,
  });
}

async function assertProjectIssue(code) {
  const status = await browser.$("button.gs-status-indicator");
  await status.waitForClickable();
  await status.click();
  const dialog = await browser.$("[role=dialog]");
  await dialog.waitForExist();
  await browser.waitUntil(async () => (await dialog.getText()).includes(code), {
    timeout: 20_000,
    timeoutMsg: `project issue dialog did not contain ${code}`,
  });
  await closeDialog(dialog);
}

async function waitForNoMissingAssetIssue() {
  const status = await browser.$("button.gs-status-indicator");
  await status.waitForClickable();
  await status.click();
  const dialog = await browser.$("[role=dialog]");
  await dialog.waitForExist();
  await browser.waitUntil(async () => {
    const text = await dialog.getText();
    return !/missing_asset|文件缺失|File missing/.test(text);
  }, {
    timeout: 20_000,
    timeoutMsg: "project issue dialog still reports a missing asset",
  });
  await closeDialog(dialog);
}

async function closeDialog(dialog) {
  const close = await dialog.$("button[aria-label^='关闭'], button[aria-label^='Close']");
  await close.waitForClickable();
  await close.click();
  await dialog.waitForExist({ reverse: true });
}

async function importAssetThroughStudio(sourcePath) {
  const fileInput = await browser.$("input[type='file']");
  if (await fileInput.isExisting()) {
    await clickButton(["导入背景", "Import background"]);
    await fileInput.setValue(sourcePath);
    await waitForManifestWithAsset();
    return;
  }
  // Native Tauri dialogs are not WebDriver-operable on hosted macOS/Windows
  // runners. Invoke the same production import command through the QA build's
  // exposed Tauri bridge, then exercise the Studio orphan-registration flow.
  const response = await browser.executeAsync((payload, done) => {
    const invoke = window.__TAURI__?.core?.invoke;
    if (typeof invoke !== "function") {
      done({ error: "window.__TAURI__.core.invoke is unavailable" });
      return;
    }
    invoke("import_asset", payload)
      .then(() => done({}))
      .catch((error) => done({ error: String(error) }));
  }, {
    projectPath,
    sourceAbsPath: sourcePath,
    destRelPath: ASSET_RELATIVE_PATH,
  });
  assert.equal(response?.error, undefined, response?.error);
  await waitForPathState(assetPaths(projectPath).projectAssetPath, "present");
  await reopenProjectAfterExternalImport();
  await waitForBodyText(ASSET_ID);
  await clickButton(["登记", "Register"]);
  await waitForManifestWithAsset();
}

async function clickButton(texts) {
  const button = await buttonByTexts(texts);
  try {
    await button.waitForClickable({ timeout: 3_000 });
    await button.click();
  } catch {
    // A workspace refresh can leave a transparent transition layer over the
    // sidebar for one WebDriver turn. Dispatch the React button click from the
    // live DOM after confirming the semantic label instead of retrying a stale
    // native pointer hit-test.
    const clicked = await browser.execute((labels) => {
      const normalizedLabel = (value) => value.replace(/\s+/g, "").toLowerCase();
      const candidate = [...document.querySelectorAll("button")].find((element) => {
        const text = normalizedLabel(element.textContent ?? "");
        return labels.some((label) => {
          const target = normalizedLabel(label);
          return text === target || text.startsWith(target);
        });
      });
      if (!(candidate instanceof HTMLButtonElement)) return false;
      candidate.click();
      return true;
    }, texts);
    assert.equal(clicked, true, `asset button was not found: ${texts.join(" / ")}`);
  }
}

async function clickContaining(text) {
  const button = await browser.$(`//button[contains(normalize-space(.), ${xpathLiteral(text)})]`);
  await button.waitForClickable();
  await button.click();
}

async function buttonByTexts(texts) {
  const labels = texts.map((text) => `normalize-space(.)=${xpathLiteral(text)}`).join(" or ");
  // Asset sidebar buttons include a numeric count badge, so the button's
  // normalized text is e.g. "Background 2". Match the semantic label span as
  // well as a text-only button used by the rest of this spec.
  return browser.$(`//button[${labels} or .//span[${labels}]]`);
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

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
