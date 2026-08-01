import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const projectPath = requiredEnv("VIBEGAL_AGENT_QA_PROJECT");
const projectName = requiredEnv("VIBEGAL_AGENT_QA_PROJECT_NAME");
const initialTitle = requiredEnv("VIBEGAL_AGENT_QA_INITIAL_TITLE");
const artifacts = requiredEnv("VIBEGAL_AGENT_QA_ARTIFACTS");
const phase = requiredEnv("VIBEGAL_AGENT_QA_PHASE");
const screenshots = path.join(artifacts, "desktop/screenshots");

const trustButtonLabels = [
  "信任并运行项目界面风格",
  "Trust and run project interface style",
];
const startButtonLabels = ["开始游戏", "Start game"];
const appearanceWorkspaceLabels = ["编辑外观", "Edit appearance"];
const previewWorkspaceLabels = ["预览", "Preview"];
const tokenColor = "#11aa66";

describe("Studio renderer and appearance journey", () => {
  it(`runs the ${phase} phase against a real Tauri project`, async () => {
    assert.ok(["edit", "reopen"].includes(phase), `unexpected phase: ${phase}`);

    await openProjectFromRecent();

    if (phase === "edit") {
      await verifyRendererInventory();
      await trustCurrentRenderer({ expectedPrompt: true });
      await assertPreviewUsesRendererAndTitleScreen("default");
      await browser.saveScreenshot(path.join(screenshots, "01-default-renderer-trusted.png"));

      await selectRenderer("classic");
      await waitForJsonValue(
        path.join(projectPath, "gal.project.json"),
        ["activeRendererId"],
        "classic",
      );
      await trustCurrentRenderer({ expectedPrompt: true });
      await assertRendererSelectValue("classic");
      await assertPreviewUsesRendererAndTitleScreen("classic");

      await clickButton(rendererWorkspaceLabels());
      await waitForAnyBodyText(appearanceWorkspaceLabels);
      await waitForBodyText("classic");
      await trustCurrentRenderer({ expectedPrompt: false });
      await editTitleScreenColorThroughPanel();
      await waitForManifestToken("titleScreen.titleColor", tokenColor);
      await assertTitleScreenColor(tokenColor);
      await browser.saveScreenshot(path.join(screenshots, "02-classic-appearance-token.png"));

      await clickButton(previewWorkspaceLabels);
      await waitForAnyBodyText(startButtonLabels);
      await assertRendererSelectValue("classic");
      await assertTitleScreenColor(tokenColor);
      await browser.saveScreenshot(path.join(screenshots, "03-classic-preview-after-save.png"));
      return;
    }

    await verifyRendererInventory();
    await assertRendererSelectValue("classic");
    await waitForJsonValue(
      path.join(projectPath, "gal.project.json"),
      ["activeRendererId"],
      "classic",
    );
    await trustCurrentRenderer({ expectedPrompt: false });
    await assertPreviewUsesRendererAndTitleScreen("classic");
    await assertTitleScreenColor(tokenColor);
    await browser.saveScreenshot(path.join(screenshots, "04-reopened-classic-preview.png"));

    await clickButton(rendererWorkspaceLabels());
    await waitForAnyBodyText(appearanceWorkspaceLabels);
    await waitForBodyText("classic");
    await trustCurrentRenderer({ expectedPrompt: false });
    await waitForManifestToken("titleScreen.titleColor", tokenColor);
    await assertTitleScreenColor(tokenColor);
    await browser.saveScreenshot(path.join(screenshots, "05-reopened-classic-appearance.png"));
  });
});

function rendererWorkspaceLabels() {
  return ["外观", "Appearance"];
}

async function openProjectFromRecent() {
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
  await waitForBodyText(initialTitle);
}

async function verifyRendererInventory() {
  const select = await rendererSelect();
  await select.waitForExist();
  const values = await browser.execute(() => {
    const selectElement = [...document.querySelectorAll("select")]
      .find((element) => ["界面风格", "Interface style"].includes(element.getAttribute("aria-label") ?? ""));
    return selectElement ? [...selectElement.options].map((option) => option.value) : [];
  });

  assert.ok(values.includes("default"), `renderer dropdown is missing default: ${values.join(", ")}`);
  assert.ok(values.includes("classic"), `renderer dropdown is missing classic: ${values.join(", ")}`);
}

async function selectRenderer(id) {
  const select = await rendererSelect();
  await select.waitForClickable();
  await select.selectByAttribute("value", id);
  await assertRendererSelectValue(id);
}

async function assertRendererSelectValue(expected) {
  const select = await rendererSelect();
  await browser.waitUntil(async () => (await select.getValue()) === expected, {
    timeout: 15_000,
    timeoutMsg: `renderer dropdown did not select ${JSON.stringify(expected)}`,
  });
}

async function trustCurrentRenderer({ expectedPrompt }) {
  const trust = await buttonByTexts(trustButtonLabels);
  if (expectedPrompt) {
    await browser.waitUntil(async () => trust.isExisting(), {
      timeout: 20_000,
      timeoutMsg: "new renderer did not expose its explicit trust action",
    });
  } else {
    await browser.waitUntil(async () => {
      const body = await browser.$("body").getText();
      return await trust.isExisting() || startButtonLabels.some((text) => body.includes(text));
    }, {
      timeout: 20_000,
      timeoutMsg: "renderer preview did not reach the trust prompt or title screen",
    });
  }

  const prompted = await trust.isExisting();
  if (expectedPrompt) assert.equal(prompted, true, "a new project renderer should require an explicit trust action");
  if (prompted) {
    await trust.waitForClickable();
    await trust.click();
  }
  await waitForAnyBodyText(startButtonLabels, 20_000);
}

async function assertPreviewUsesRendererAndTitleScreen(rendererId) {
  await assertRendererSelectValue(rendererId);
  await waitForAnyBodyText(startButtonLabels, 20_000);
  await browser.waitUntil(async () => browser.execute(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity) > 0;
    };
    const titleScreen = [...document.querySelectorAll("[data-ui-part='titleScreen']")]
      .find((element) => visible(element));
    return Boolean(titleScreen);
  }), {
    timeout: 20_000,
    timeoutMsg: `${rendererId} preview did not expose a visible title-screen part`,
  });
}

async function editTitleScreenColorThroughPanel() {
  const group = await browser.$(
    "//details[@aria-label='标题画面' or @aria-label='Title screen']",
  );
  await group.waitForExist();
  if ((await group.getAttribute("open")) === null) {
    await group.$("summary").click();
  }

  const input = await browser.$(
    "//span[@title='titleScreen.titleColor']/following-sibling::div//input[@aria-label='标题色' or @aria-label='Title color']",
  );
  await input.waitForExist();
  await input.scrollIntoView();
  await input.waitForClickable();
  await input.setValue(tokenColor);
  await browser.waitUntil(async () => (await input.getValue()) === tokenColor, {
    timeout: 5_000,
    timeoutMsg: "TokenEditorPanel did not retain the edited titleScreen.titleColor value",
  });
}

async function waitForManifestToken(key, expected) {
  const manifestFile = path.join(projectPath, "content/manifest.json");
  await browser.waitUntil(async () => {
    try {
      const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
      return manifest.uiSkins?.default?.tokens?.[key] === expected;
    } catch {
      return false;
    }
  }, {
    timeout: 20_000,
    timeoutMsg: `content/manifest.json did not persist ${key}=${expected}`,
  });
}

async function waitForJsonValue(file, keys, expected) {
  await browser.waitUntil(async () => {
    try {
      const value = JSON.parse(await readFile(file, "utf8"));
      const actual = keys.reduce((current, key) => current?.[key], value);
      return actual === expected;
    } catch {
      return false;
    }
  }, {
    timeout: 20_000,
    timeoutMsg: `${file} did not persist ${keys.join(".")}=${expected}`,
  });
}

async function assertTitleScreenColor(expectedHex) {
  const expectedRgb = hexToRgb(expectedHex);
  await browser.waitUntil(async () => {
    const result = await browser.execute(() => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0
          && rect.height > 0
          && style.display !== "none"
          && style.visibility !== "hidden"
          && Number(style.opacity) > 0;
      };
      const heading = [...document.querySelectorAll("[data-ui-part='titleScreen'] h1")]
        .find((element) => visible(element));
      if (!heading) return null;
      return {
        color: getComputedStyle(heading).color,
        text: heading.textContent,
      };
    });
    return result?.color?.includes(expectedRgb) && Boolean(result.text?.trim());
  }, {
    timeout: 20_000,
    timeoutMsg: `visible title-screen preview did not use ${expectedHex}`,
  });
}

async function rendererSelect() {
  return browser.$(
    "//select[@aria-label='界面风格' or @aria-label='Interface style']",
  );
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
  return browser.$(
    `//button[${texts.map((text) => `normalize-space(.)=${xpathLiteral(text)}`).join(" or ")}]`,
  );
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

function hexToRgb(hex) {
  const value = hex.replace(/^#/, "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `${red}, ${green}, ${blue}`;
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
