import assert from "node:assert/strict";
import test from "node:test";
import {
  checkVocabularyRepository,
  checkVocabularySources,
  repoRoot,
} from "./check-vocabulary.mjs";

function check(text, file = "packages/studio/src/Fixture.tsx") {
  return checkVocabularySources([{ path: file, text }]);
}

test("rejects creator-facing technical terms with file and line", () => {
  const errors = check([
    "export function Fixture() {",
    "  return <button title=\"切换 Inspector 面板\">Cleanup dry-run</button>;",
    "}",
  ].join("\n"));

  assert.equal(errors.length, 2);
  assert.deepEqual(errors.map(({ path, line }) => ({ path, line })), [
    { path: "packages/studio/src/Fixture.tsx", line: 2 },
    { path: "packages/studio/src/Fixture.tsx", line: 2 },
  ]);
  assert.match(errors[0].message, /属性面板/);
  assert.match(errors[1].message, /清理预览/);
});

test("rejects CLI flags, renderer terms, WebView, and manifest in display copy", () => {
  const errors = check(`
    export const Fixture = () => (
      <section>
        <p>Renderer 使用 WebView。</p>
        <p>渲染层使用了 fade_in。</p>
        <label>严格模式（--strict）</label>
        <span>保存 manifest 失败</span>
      </section>
    );
  `);

  assert.deepEqual(
    errors.map((error) => error.message.match(/请使用「([^」]+)」/)?.[1]),
    ["系统网页引擎", "界面风格", "界面风格", "淡入", "将警告视为错误", "资源登记表"],
  );
});

test("allows internal identifiers, contracts, paths, flags, and Scenario DSL", () => {
  const errors = check(`
    interface NodeInspectorProps { manifest: unknown }
    const rendererId = "default";
    const strictFlag = "--strict";
    const manifestPath = "content/manifest.json";
    const scenario = "@transition fade_in 1200ms";
    export function ScenarioInspector() { return null; }
    export function PathHint() { return <code>content/manifest.json</code>; }
  `);

  assert.deepEqual(errors, []);
});

test("requires localized labels when transition enum values are displayed", () => {
  const missing = check(`
    export function Fixture() {
      return <EnumField options={["fade_in", "fade_out", "black"]} />;
    }
  `);
  assert.equal(missing.length, 3);
  assert.match(missing[0].message, /fade_in.*淡入/);

  const localized = check(`
    export function Fixture() {
      return <EnumField
        options={["fade_in", "fade_out", "black"]}
        optionLabels={{ fade_in: "淡入", fade_out: "淡出", black: "黑场" }}
      />;
    }
  `);
  assert.deepEqual(localized, []);

  const localizedWithKeys = check(`
    export function Fixture() {
      return <EnumField
        options={["fade_in", "fade_out", "white_in", "white_out", "black"]}
        optionLabels={{
          fade_in: t("script.scenario.transition.fadeIn"),
          fade_out: t("script.scenario.transition.fadeOut"),
          white_in: t("script.scenario.transition.whiteIn"),
          white_out: t("script.scenario.transition.whiteOut"),
          black: t("script.scenario.transition.black"),
        }}
      />;
    }
  `);
  assert.deepEqual(localizedWithKeys, []);

  const wrongKey = check(`
    export function Fixture() {
      return <EnumField
        options={["fade_in"]}
        optionLabels={{ fade_in: t("script.scenario.transition.fadeOut") }}
      />;
    }
  `);
  assert.equal(wrongKey.length, 1);
  assert.match(wrongKey[0].message, /fade_in.*淡入/);
});

test("requires Studio Chinese transition messages to keep the product vocabulary", () => {
  const catalog = `
    export const STUDIO_ZH_CN_MESSAGES = {
      "script.scenario.transition.fadeIn": "淡入",
      "script.scenario.transition.fadeOut": "淡出",
      "script.scenario.transition.whiteIn": "白场淡入",
      "script.scenario.transition.whiteOut": "白场淡出",
      "script.scenario.transition.black": "黑场",
    } as const;
  `;

  assert.deepEqual(checkVocabularySources([{
    path: "packages/studio/src/lib/i18n.tsx",
    text: catalog,
  }]), []);

  const drifted = checkVocabularySources([{
    path: "packages/studio/src/lib/i18n.tsx",
    text: catalog.replace(
      '"script.scenario.transition.fadeIn": "淡入"',
      '"script.scenario.transition.fadeIn": "渐入"',
    ),
  }]);

  assert.equal(drifted.length, 1);
  assert.match(drifted[0].message, /fadeIn.*淡入/);
});

test("does not scan tests or historical documentation as creator UI", () => {
  const errors = checkVocabularySources([
    {
      path: "packages/studio/src/Fixture.test.tsx",
      text: 'expect("--strict").toBe("--strict");',
    },
    {
      path: "docs/roadmap-specs/archive/old.md",
      text: "Inspector / CG Gallery / Cleanup dry-run / fade_in",
    },
  ]);

  assert.deepEqual(errors, []);
});

test("current repository follows the creator vocabulary", () => {
  assert.deepEqual(checkVocabularyRepository(repoRoot), []);
});
