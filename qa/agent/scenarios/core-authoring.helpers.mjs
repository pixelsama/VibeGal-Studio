import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const CORE_AUTHORING_SOURCE_NODE_ID = "awakening";
export const CORE_AUTHORING_NEW_NODE_ID = "awakening_2";
export const CORE_AUTHORING_NODE_TITLE = "Agent QA Core Authoring Branch";
export const CORE_AUTHORING_TEXT = "Agent QA core authoring branch reached.";

export function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function projectPaths(projectPath) {
  return {
    graph: path.join(projectPath, "content/graph.json"),
    node: path.join(projectPath, `content/nodes/${CORE_AUTHORING_NEW_NODE_ID}.json`),
  };
}

export async function readProjectGraph(projectPath) {
  return JSON.parse(await readFile(projectPaths(projectPath).graph, "utf8"));
}

export async function readCoreAuthoringNode(projectPath) {
  return JSON.parse(await readFile(projectPaths(projectPath).node, "utf8"));
}

export function assertCoreAuthoringGraph(graph) {
  const node = graph.nodes.find((candidate) => candidate.id === CORE_AUTHORING_NEW_NODE_ID);
  assert.ok(node, `graph.json should contain ${CORE_AUTHORING_NEW_NODE_ID}`);
  assert.equal(node.title, CORE_AUTHORING_NODE_TITLE);
  assert.equal(node.file, `nodes/${CORE_AUTHORING_NEW_NODE_ID}.json`);

  const edge = graph.edges.find(
    (candidate) => candidate.from === CORE_AUTHORING_SOURCE_NODE_ID
      && candidate.to === CORE_AUTHORING_NEW_NODE_ID,
  );
  assert.ok(edge, `graph.json should connect ${CORE_AUTHORING_SOURCE_NODE_ID} to ${CORE_AUTHORING_NEW_NODE_ID}`);
  assert.equal(edge.mode, "choice");
  return { node, edge };
}

export function assertCoreAuthoringNode(instructions) {
  assert.ok(Array.isArray(instructions), "created node JSON should be an Instruction[]");
  assert.ok(
    instructions.some((instruction) => instruction.text === CORE_AUTHORING_TEXT),
    `node JSON should contain the authored text ${JSON.stringify(CORE_AUTHORING_TEXT)}`,
  );
}

export async function waitForProjectFiles(projectPath, predicate, timeout = 20_000) {
  await browser.waitUntil(async () => {
    try {
      return await predicate({
        graph: await readProjectGraph(projectPath),
        node: await readCoreAuthoringNode(projectPath),
      });
    } catch {
      return false;
    }
  }, {
    timeout,
    interval: 250,
    timeoutMsg: `project files did not satisfy the expected condition within ${timeout}ms`,
  });
}

export async function openProjectFromRecent({ projectPath, projectName, initialTitle }) {
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
  if (await trust.isExisting()) await trust.click();
  await waitForAnyBodyText(["开始游戏", "Start game"]);
}

export async function openScriptWorkspace() {
  await clickButton(["剧情", "Story"]);
  await browser.$(".react-flow").waitForExist();
  await waitForWorkspaceContentVisible();
}

export async function openPreviewWorkspace() {
  await clickButton(["预览", "Preview"]);
  await browser.$("[data-player-stage]").waitForExist();
  await waitForWorkspaceContentVisible();
}

export async function createSuccessorFromGraphNode(nodeId = CORE_AUTHORING_SOURCE_NODE_ID) {
  // GraphCanvas delegates the context menu from the React Flow node wrapper.
  // data-id is React Flow's stable node identity; the title fallback keeps the
  // diagnostic useful if the library changes that attribute in a future QA build.
  let node = await browser.$(`.react-flow__node[data-id="${nodeId}"]`);
  if (!(await node.isExisting())) {
    node = await browser.$(
      `//*[contains(concat(" ", normalize-space(@class), " "), " react-flow__node ")][.//span[normalize-space()=${xpathLiteral(nodeId === CORE_AUTHORING_SOURCE_NODE_ID ? "苏醒" : nodeId)}]]`,
    );
  }
  await node.waitForExist();
  // WebKit and Edge do not consistently forward WebDriver's synthetic
  // right-click to React Flow's node context-menu handler. Dispatch the same
  // bubbling DOM event so the QA path exercises the real menu implementation
  // without depending on the host OS context-menu gesture.
  await browser.execute((targetId) => {
    const target = [...document.querySelectorAll(".react-flow__node")]
      .find((candidate) => candidate.getAttribute("data-id") === targetId);
    if (!(target instanceof HTMLElement)) {
      throw new Error(`React Flow node ${targetId} was not found for context menu`);
    }
    const rect = target.getBoundingClientRect();
    target.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 2,
      buttons: 2,
      clientX: rect.left + Math.min(rect.width / 2, 24),
      clientY: rect.top + Math.min(rect.height / 2, 24),
    }));
  }, nodeId);
  const menu = await browser.$('[role="menu"]');
  await menu.waitForExist();
  const successor = await browser.$(
    `//div[@role="menu"]//button[@role="menuitem" and (normalize-space(.)=${xpathLiteral("创建后续节点")} or normalize-space(.)=${xpathLiteral("Create successor node")})]`,
  );
  try {
    await successor.waitForClickable();
    await successor.click();
  } catch {
    // The embedded WebDriver can report a visible React menu item as
    // non-clickable on macOS/Edge. Dispatch the same button click from the
    // live menu after matching the localized label.
    const clicked = await browser.execute(() => {
      const labels = ["创建后续节点", "Create successor node"];
      const candidate = [...document.querySelectorAll('[role="menu"] button[role="menuitem"]')]
        .find((element) => labels.includes(element.textContent?.trim() ?? ""));
      if (!(candidate instanceof HTMLButtonElement)) return false;
      candidate.click();
      return true;
    });
    if (!clicked) throw new Error("successor menu item was not found in the live DOM");
  }
  await browser.waitUntil(async () => (await browser.$(
    `.react-flow__node[data-id="${CORE_AUTHORING_NEW_NODE_ID}"]`,
  ).isExisting()) || (await browser.$(
    `//button[@role="option"][.//span[normalize-space()=${xpathLiteral(CORE_AUTHORING_NEW_NODE_ID)}]]`,
  ).isExisting()), {
    timeout: 15_000,
    timeoutMsg: "created successor node did not appear in the Graph UI",
  });
}

export async function renameSelectedNode() {
  const titleInput = await browser.$(
    `//label[.//span[normalize-space()=${xpathLiteral("标题")} or normalize-space()=${xpathLiteral("Title")}]]//input`,
  );
  await titleInput.waitForExist();
  await titleInput.setValue(CORE_AUTHORING_NODE_TITLE);
  await browser.keys("Enter");
  await waitForBodyText(CORE_AUTHORING_NODE_TITLE);
}

export async function openNodeEditor(nodeTitle = CORE_AUTHORING_NEW_NODE_ID) {
  const option = await browser.$(
    `//button[@role="option"][.//span[normalize-space()=${xpathLiteral(nodeTitle)}]]`,
  );
  await option.waitForClickable();
  await option.click();
  const enter = await buttonByTexts(["进入编辑", "Open editor"]);
  await enter.waitForClickable();
  await enter.click();
  const textarea = await browser.$(
    `//textarea[@aria-label=${xpathLiteral("剧本文本")} or @aria-label=${xpathLiteral("Script text")}]`,
  );
  await textarea.waitForExist();
  return textarea;
}

export async function authorNodeInstructions(textarea) {
  await textarea.setValue(CORE_AUTHORING_TEXT);
  await waitForBodyText("未保存");
  const save = await buttonByTexts(["保存", "Save"]);
  await save.waitForClickable();
  await save.click();
}

export async function verifyPreviewBranch() {
  await browser.$(
    `//select[@aria-label=${xpathLiteral("调试起点")} or @aria-label=${xpathLiteral("Debug start")}]//option[@value="${CORE_AUTHORING_NEW_NODE_ID}"]`,
  ).waitForExist({ timeout: 20_000 });
  const debugStart = await browser.$(
    `//select[@aria-label=${xpathLiteral("调试起点")} or @aria-label=${xpathLiteral("Debug start")}]`,
  );
  await debugStart.waitForExist();
  try {
    await debugStart.selectByAttribute("value", CORE_AUTHORING_SOURCE_NODE_ID);
    await browser.waitUntil(async () => (await debugStart.getValue()) === CORE_AUTHORING_SOURCE_NODE_ID, {
      timeout: 2_000,
      interval: 100,
    });
  } catch {
    await browser.execute((nodeId) => {
      const target = [...document.querySelectorAll("select")]
        .find((candidate) => ["调试起点", "Debug start"].includes(candidate.getAttribute("aria-label") ?? ""));
      if (!(target instanceof HTMLSelectElement)) throw new Error("debug-start select was not found");
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      setter?.call(target, nodeId);
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
    }, CORE_AUTHORING_SOURCE_NODE_ID);
  }

  const rehearse = await buttonByTexts(["从这里试演", "Rehearse from here"]);
  await rehearse.waitForClickable();
  await rehearse.click();

  const start = await browser.$('[data-title-action="start"]');
  await start.waitForClickable({ timeout: 20_000 });
  await browser.execute(() => {
    const button = document.querySelector('[data-title-action="start"]');
    if (!(button instanceof HTMLButtonElement)) throw new Error("title start button was not found");
    if (button.disabled) throw new Error("title start button is disabled");
    button.click();
  });
  await browser.$('[data-player-stage][data-player-screen="story"]').waitForExist({ timeout: 20_000 });

  await advanceUntilChoice(CORE_AUTHORING_NEW_NODE_ID);
  const choice = await browser.$(`[data-choice-to="${CORE_AUTHORING_NEW_NODE_ID}"]`);
  await choice.waitForClickable();
  await choice.click();
  await waitForBodyText(CORE_AUTHORING_TEXT, 30_000);
}

export async function advanceUntilChoice(targetNodeId) {
  await browser.waitUntil(async () => {
    const target = await browser.$(`[data-choice-to="${targetNodeId}"]`);
    if (await target.isExisting()) return true;

    const storyStage = await browser.$('[data-player-stage][data-player-screen="story"]');
    if (await storyStage.isExisting()) {
      const status = await browser.$("[data-player-status]");
      if (!(await status.isExisting())) await storyStage.click();
    }
    return false;
  }, {
    timeout: 90_000,
    interval: 350,
    timeoutMsg: `preview did not reach the ${targetNodeId} branch choice`,
  });
}

export async function waitForBodyText(text, timeout = 15_000) {
  await browser.waitUntil(async () => (await browser.$("body").getText()).includes(text), {
    timeout,
    timeoutMsg: `body did not contain ${JSON.stringify(text)}`,
  });
}

export async function waitForAnyBodyText(texts, timeout = 15_000) {
  await browser.waitUntil(async () => {
    const body = await browser.$("body").getText();
    return texts.some((text) => body.includes(text));
  }, {
    timeout,
    timeoutMsg: `body did not contain any of ${JSON.stringify(texts)}`,
  });
}

export async function waitForWorkspaceContentVisible() {
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

export async function disableMotion() {
  await browser.execute(() => {
    const id = "vibegal-agent-qa-disable-motion";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = "*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important}";
    document.head.append(style);
  });
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

function xpathLiteral(value) {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat(${value.split("'").map((part) => `'${part}'`).join(', "\'", ')})`;
}
