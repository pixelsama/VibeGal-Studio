import assert from "node:assert/strict";
import { readFile, rename, rm, writeFile } from "node:fs/promises";

export const GRAPH_PATH = "content/graph.json";
export const NODE_PATH = "content/nodes/awakening.json";
export const MANIFEST_PATH = "content/manifest.json";
export const RENDERER_PATH = "renderers/default/index.tsx";

export const EXTERNAL_GRAPH_TITLE = "外部协作热重载节点";
export const EXTERNAL_NODE_TEXT = "外部协作节点热重载";
export const EXTERNAL_CONFLICT_TEXT = "外部协作冲突版本";
export const LOCAL_DRAFT_TEXT = "本地未保存草稿";
export const MISSING_ASSET_PATH = "assets/backgrounds/external-collaboration-missing.svg";

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}
/**
 * Write a replacement beside the target and rename it over the target. This
 * deliberately exercises the same atomic-save shape used by external tools.
 */
export async function atomicReplace(filePath, content) {
  const stagedPath = `${filePath}.external-collaboration-${process.pid}-${Date.now()}.tmp`;
  await writeFile(stagedPath, content, "utf8");
  try {
    await rename(stagedPath, filePath);
  } finally {
    await rm(stagedPath, { force: true });
  }
}

export async function atomicReplaceJson(filePath, update) {
  const current = await readJson(filePath);
  const next = await update(structuredClone(current));
  await atomicReplace(filePath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export async function atomicReplaceRenderer(filePath) {
  const source = await readFile(filePath, "utf8");
  const oldDescription = "现代扁平二次元风：磨砂白对话框 + 樱粉点缀 + 全套玩家面板的默认实现";
  assert.ok(source.includes(oldDescription), "sample renderer description was not found");
  const next = source.replace(oldDescription, "外部协作热重载：磨砂白对话框 + 樱粉点缀 + 全套玩家面板的默认实现");
  await atomicReplace(filePath, next);
  return next;
}

export function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export function xpathLiteral(value) {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat(${value.split("'").map((part, index) => `${index ? `, "'", ` : ""}'${part}'`).join("")})`;
}

export function buttonByTexts(texts) {
  return browser.$(`//button[${texts.map((text) => `normalize-space(.)=${xpathLiteral(text)}`).join(" or ")}]`);
}

export async function clickButton(texts) {
  const button = await buttonByTexts(texts);
  await button.waitForClickable();
  await button.click();
  return button;
}

export async function clickContaining(text) {
  const button = await browser.$(`//button[contains(normalize-space(.), ${xpathLiteral(text)})]`);
  await button.waitForClickable();
  await button.click();
  return button;
}

export async function waitForBodyText(text, timeout = 20_000) {
  await browser.waitUntil(async () => (await browser.$("body").getText()).includes(text), {
    timeout,
    timeoutMsg: `body did not contain ${JSON.stringify(text)}`,
  });
}

export async function waitForAnyBodyText(texts, timeout = 20_000) {
  await browser.waitUntil(async () => {
    const body = await browser.$("body").getText();
    return texts.some((text) => body.includes(text));
  }, {
    timeout,
    timeoutMsg: `body did not contain any of ${JSON.stringify(texts)}`,
  });
}

export async function waitForFileContent(filePath, predicate, timeout = 20_000) {
  await browser.waitUntil(async () => {
    try {
      return Boolean(predicate(await readFile(filePath, "utf8")));
    } catch {
      return false;
    }
  }, {
    timeout,
    timeoutMsg: `file did not reach expected state: ${filePath}`,
  });
}

export async function waitForJson(filePath, predicate, timeout = 20_000) {
  await waitForFileContent(filePath, (content) => {
    try {
      return predicate(JSON.parse(content));
    } catch {
      return false;
    }
  }, timeout);
}

export async function waitForTextareaValue(_textarea, text, timeout = 20_000) {
  // A project_changed refresh remounts NodeEditor, so a captured WebDriver
  // element can become stale while the watcher applies the external write.
  // Re-resolve the live textarea on every poll.
  await browser.waitUntil(async () => {
    try {
      const textarea = await browser.$("textarea");
      return (await textarea.isExisting()) && (await textarea.getValue()).includes(text);
    } catch {
      return false;
    }
  }, {
    timeout,
    timeoutMsg: `textarea did not contain ${JSON.stringify(text)}`,
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
    timeout: 10_000,
    timeoutMsg: "workspace content did not finish becoming visible",
  });
}
