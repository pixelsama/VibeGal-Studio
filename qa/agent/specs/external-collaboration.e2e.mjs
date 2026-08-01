import assert from "node:assert/strict";
import path from "node:path";

import {
  EXTERNAL_CONFLICT_TEXT,
  EXTERNAL_GRAPH_TITLE,
  EXTERNAL_NODE_TEXT,
  GRAPH_PATH,
  LOCAL_DRAFT_TEXT,
  MANIFEST_PATH,
  MISSING_ASSET_PATH,
  NODE_PATH,
  RENDERER_PATH,
  atomicReplaceJson,
  atomicReplaceRenderer,
  buttonByTexts,
  clickButton,
  clickContaining,
  disableMotion,
  readJson,
  requiredEnv,
  waitForAnyBodyText,
  waitForBodyText,
  waitForFileContent,
  waitForJson,
  waitForTextareaValue,
  waitForWorkspaceContentVisible,
} from "../scenarios/external-collaboration.helper.mjs";

const projectPath = requiredEnv("VIBEGAL_AGENT_QA_PROJECT");
const projectName = requiredEnv("VIBEGAL_AGENT_QA_PROJECT_NAME");
const initialTitle = requiredEnv("VIBEGAL_AGENT_QA_INITIAL_TITLE");
const artifacts = requiredEnv("VIBEGAL_AGENT_QA_ARTIFACTS");
const phase = requiredEnv("VIBEGAL_AGENT_QA_PHASE");
const screenshots = path.join(artifacts, "desktop/screenshots");

describe("Studio external collaboration", () => {
  it(`${phase} keeps external edits and local drafts safe`, async () => {
    await openProjectInStudio();

    if (phase === "open") {
      await openScriptGraph();
      await browser.saveScreenshot(path.join(screenshots, "01-open-watcher-ready.png"));
      return;
    }

    if (phase === "external-edit") {
      await exerciseExternalEdits();
      await browser.saveScreenshot(path.join(screenshots, "02-external-edits-reloaded.png"));
      return;
    }

    if (phase === "conflict") {
      await exerciseUnsavedConflictProtection();
      await browser.saveScreenshot(path.join(screenshots, "03-unsaved-external-conflict.png"));
      return;
    }

    throw new Error(`Unexpected external-collaboration phase: ${phase}`);
  });
});

async function openProjectInStudio() {
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
  await waitForAnyBodyText([
    "信任并运行项目界面风格",
    "Trust and run project interface style",
    "剧情播放",
    "Story playback",
  ], 30_000);
  await trustCurrentRendererIfNeeded();
  await waitForAnyBodyText(["剧情播放", "Story playback"], 30_000);
  await waitForWorkspaceContentVisible();
}

async function trustCurrentRendererIfNeeded() {
  const trust = await buttonByTexts([
    "信任并运行项目界面风格",
    "Trust and run project interface style",
  ]);
  if (await trust.isExisting()) {
    await trust.waitForClickable();
    await trust.click();
  }
}

async function openScriptGraph() {
  await clickButton(["脚本", "Script"]);
  await browser.$(".react-flow").waitForExist();
  await browser.$("[role=listbox]").waitForExist();
}

async function openNodeEditor(nodeTitle) {
  await clickContaining(nodeTitle);
  await waitForAnyBodyText(["节点检查", "Node inspection", "进入编辑", "Edit node"]);
  await clickButton(["进入编辑", "Edit node"]);
  await browser.$("textarea").waitForExist();
}

async function exerciseExternalEdits() {
  await openScriptGraph();

  const graphFile = path.join(projectPath, GRAPH_PATH);
  await atomicReplaceJson(graphFile, (graph) => {
    const target = graph.nodes.find((node) => node.id === "approach");
    assert.ok(target, "sample graph must contain approach node");
    target.title = EXTERNAL_GRAPH_TITLE;
    return graph;
  });
  await waitForBodyText(EXTERNAL_GRAPH_TITLE);
  await waitForJson(graphFile, (graph) => graph.nodes.some((node) => node.title === EXTERNAL_GRAPH_TITLE));

  await openNodeEditor("苏醒");
  const nodeFile = path.join(projectPath, NODE_PATH);
  await atomicReplaceJson(nodeFile, (instructions) => {
    const target = instructions.find((instruction) => instruction.id === "awakening_001");
    assert.ok(target, "sample awakening node must contain awakening_001");
    target.text = EXTERNAL_NODE_TEXT;
    return instructions;
  });
  const textarea = await browser.$("textarea");
  await waitForTextareaValue(textarea, EXTERNAL_NODE_TEXT);
  await waitForFileContent(nodeFile, (content) => content.includes(EXTERNAL_NODE_TEXT));
  await waitForAnyBodyText(["外部已更新，查看差异", "Updated externally · View diff"], 30_000);

  await clickButton(["预览", "Preview"]);
  await waitForAnyBodyText(["剧情播放", "Story playback"], 30_000);

  const manifestFile = path.join(projectPath, MANIFEST_PATH);
  await atomicReplaceJson(manifestFile, (manifest) => {
    manifest.backgrounds.external_collaboration_missing = MISSING_ASSET_PATH;
    return manifest;
  });
  await waitForJson(manifestFile, (manifest) => manifest.backgrounds?.external_collaboration_missing === MISSING_ASSET_PATH);
  await openProjectIssuesAndWaitFor(
    ["missing_asset", MISSING_ASSET_PATH],
    30_000,
  );
  await closeProjectIssues();

  const rendererFile = path.join(projectPath, RENDERER_PATH);
  await atomicReplaceRenderer(rendererFile);
  await waitForFileContent(rendererFile, (content) => content.includes("外部协作热重载"), 30_000);
  // A changed renderer fingerprint is deliberately untrusted again. Seeing
  // this prompt proves project_changed(rendererChanged) cleared the cache and
  // forced the runtime loader to inspect the new source.
  await waitForAnyBodyText([
    "信任并运行项目界面风格",
    "Trust and run project interface style",
  ], 30_000);
  await trustCurrentRendererIfNeeded();
  await waitForAnyBodyText(["剧情播放", "Story playback"], 30_000);
}

async function exerciseUnsavedConflictProtection() {
  await openScriptGraph();
  await openNodeEditor("苏醒");

  const nodeFile = path.join(projectPath, NODE_PATH);
  const textarea = await browser.$("textarea");
  const currentDraft = await textarea.getValue();
  assert.notEqual(currentDraft, "", "node editor should load a non-empty draft");
  const localDraft = currentDraft.includes(EXTERNAL_NODE_TEXT)
    ? currentDraft.replace(EXTERNAL_NODE_TEXT, LOCAL_DRAFT_TEXT)
    : currentDraft.replace(/\S+/, LOCAL_DRAFT_TEXT);
  await textarea.setValue(localDraft);
  await waitForTextareaValue(textarea, LOCAL_DRAFT_TEXT);
  await waitForBodyText("未保存");

  await atomicReplaceJson(nodeFile, (instructions) => {
    const target = instructions.find((instruction) => instruction.id === "awakening_001");
    assert.ok(target, "sample awakening node must contain awakening_001");
    target.text = EXTERNAL_CONFLICT_TEXT;
    return instructions;
  });
  await waitForFileContent(nodeFile, (content) => content.includes(EXTERNAL_CONFLICT_TEXT));
  await waitForAnyBodyText([
    "外部已更新，查看差异",
    "Updated externally · View diff",
    "冲突：查看差异",
    "Conflict · View diff",
  ], 30_000);

  const externalButton = await buttonByTexts([
    "外部已更新，查看差异",
    "Updated externally · View diff",
    "冲突：查看差异",
    "Conflict · View diff",
  ]);
  await externalButton.waitForClickable();
  await externalButton.click();
  await browser.$('[data-region="external-diff-panel"]').waitForExist();
  await waitForAnyBodyText([EXTERNAL_CONFLICT_TEXT, "外部版本", "External version"], 20_000);

  const save = await buttonByTexts(["保存", "Save"]);
  assert.equal(await save.isEnabled(), false, "external update must disable save until a resolution is chosen");
  for (const alternatives of [
    ["载入磁盘版本", "Load disk version"],
    ["保留我的修改", "Keep my changes"],
    ["复制差异", "Copy differences for manual resolution"],
  ]) {
    await waitForAnyBodyText(alternatives);
  }

  const diskNode = await readJson(nodeFile);
  assert.equal(
    diskNode.find((instruction) => instruction.id === "awakening_001")?.text,
    EXTERNAL_CONFLICT_TEXT,
    "external disk version must remain intact while the local draft is unresolved",
  );
}

async function openProjectIssuesAndWaitFor(expectedTexts, timeout) {
  const indicator = await browser.$("button.gs-status-indicator");
  await indicator.waitForExist();
  await indicator.click();
  await waitForAnyBodyText(["项目问题", "Project issues"], timeout);
  for (const expectedText of expectedTexts) {
    await waitForBodyText(expectedText, timeout);
  }
}

async function closeProjectIssues() {
  const close = await browser.$("button[aria-label*='关闭']");
  if (await close.isExisting()) {
    await close.click();
    return;
  }
  const englishClose = await browser.$("button[aria-label*='Close']");
  if (await englishClose.isExisting()) await englishClose.click();
}
