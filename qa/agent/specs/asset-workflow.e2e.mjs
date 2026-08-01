import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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

const execFileAsync = promisify(execFile);
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
      await clickButton(["导入背景", "Import background"]);
      await selectNativeAssetFile(sourcePath);

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
      await clickButton(["脚本", "Script"]);
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
      await clickButton(["导入背景", "Import background"]);
      await selectNativeAssetFile(sourcePath);
      await waitForPathState(assetPaths(projectPath).projectAssetPath, "present");
      await waitForBodyText(ASSET_ID);
      await waitForManifestWithAsset();
      await waitForNoProjectIssues();

      const repairedManifest = await readProjectManifest(projectPath);
      assertAssetRegistered(repairedManifest);
      assertAssetReference(await readProjectNode(projectPath));
      await clickButton(["脚本", "Script"]);
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
      await clickButton(["脚本", "Script"]);
      await openPrologueNode();
      await waitForScriptEditor();
      await waitForNoProjectIssues();
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

async function waitForAssetWorkspace() {
  await browser.$("[role=grid]").waitForExist();
  await waitForAnyBodyText(["资产", "Assets"]);
}

async function referenceAssetInScript() {
  await clickButton(["脚本", "Script"]);
  await openPrologueNode();
  await waitForScriptEditor();

  const textArea = await scenarioTextArea();
  const current = await textArea.getValue();
  assert.match(current, /@bg\s+ocean_night\b/, "sample prologue should contain a background instruction to replace");
  const next = current.replace(/@bg\s+ocean_night\b/, `@bg ${ASSET_ID}`);
  await textArea.setValue(next);
  await waitForAnyBodyText(["未保存", "Unsaved"]);
  await clickButton(["保存", "Save"]);
  await waitForAnyBodyText(["已保存", "Saved"]);
  await waitForNodeToPersistReference();
}

async function openPrologueNode() {
  const node = await browser.$(
    "//div[@role='listbox']//button[@role='option'][.//*[normalize-space()='序章'] or .//*[normalize-space()='Prologue']]",
  );
  await node.waitForClickable();
  await node.click();
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
  const nextButton = await browser.$(
    "button[aria-label='下一条指令'], button[aria-label='Next instruction'], "
    + "button[title='下一条指令'], button[title='Next instruction']",
  );
  await nextButton.waitForClickable();
  // The prologue begins with transition, then the imported background.
  await nextButton.click();
  await nextButton.click();
  const background = await browser.$("img[data-runtime-background='true']");
  await background.waitForExist();
  await browser.waitUntil(async () => {
    const src = await background.getAttribute("src");
    return typeof src === "string" && src.includes(ASSET_FILE_NAME);
  }, {
    timeout: 15_000,
    timeoutMsg: `preview background did not resolve to ${ASSET_FILE_NAME}`,
  });
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

async function waitForNoProjectIssues() {
  const status = await browser.$("button.gs-status-indicator");
  await status.waitForClickable();
  await status.click();
  const dialog = await browser.$("[role=dialog]");
  await dialog.waitForExist();
  await browser.waitUntil(async () => {
    const text = await dialog.getText();
    return /项目正常|Project is healthy/.test(text) && !/missing_asset/.test(text);
  }, {
    timeout: 20_000,
    timeoutMsg: "project issue dialog did not settle to a clean report",
  });
  await closeDialog(dialog);
}

async function closeDialog(dialog) {
  const close = await dialog.$("button[aria-label^='关闭'], button[aria-label^='Close']");
  await close.waitForClickable();
  await close.click();
  await dialog.waitForExist({ reverse: true });
}

async function selectNativeAssetFile(sourcePath) {
  const fileInput = await browser.$("input[type='file']");
  if (await fileInput.isExisting()) {
    await fileInput.setValue(sourcePath);
    return;
  }
  if (process.platform !== "darwin") {
    throw new Error(
      "asset-workflow gap: Studio exposes a native Tauri file dialog, not input[type=file]; "
      + `WebDriver cannot select ${sourcePath} on ${process.platform}. Add a platform QA dialog adapter or a QA-only file input before enabling this scenario.`,
    );
  }
  await automateMacOpenPanel(sourcePath);
}

async function automateMacOpenPanel(sourcePath) {
  const script = `
tell application "System Events"
  set frontApp to first application process whose frontmost is true
  tell frontApp
    delay 0.45
    keystroke "g" using {command down, shift down}
    delay 0.25
    keystroke ${appleScriptString(sourcePath)}
    key code 36
    delay 0.35
    key code 36
  end tell
end tell
`;
  try {
    await execFileAsync("osascript", ["-e", script], { timeout: 10_000 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      "asset-workflow gap: native macOS file dialog automation failed; "
      + "the test did not copy a file or bypass Studio import. Grant Accessibility permission to osascript "
      + `or add a WebDriver-operable file input. Detail: ${detail}`,
    );
  }
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

function appleScriptString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
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
