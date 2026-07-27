import { useMemo, useState, type CSSProperties } from "react";
import type { LocaleTable, ProjectData } from "../../lib/types";
import { Button } from "../common/Button";
import {
  buildTranslationReport,
  collectTranslationRows,
  generateTranslationKey,
  type TranslationSourceRow,
} from "./translationModel";

interface TranslationComparisonProps {
  project: ProjectData;
  onAssignKey: (row: TranslationSourceRow, textKey: string) => Promise<void>;
  onSaveLocale: (locale: string, value: LocaleTable) => Promise<void>;
}

export function TranslationComparison({ project, onAssignKey, onSaveLocale }: TranslationComparisonProps) {
  const localeConfig = readLocaleConfig(project.content.meta);
  const rows = useMemo(
    () => collectTranslationRows(project.graph ?? { version: 1, entryNodeId: "", chapters: [], nodes: [], edges: [] }, project.nodes),
    [project.graph, project.nodes],
  );
  const tables = useMemo(
    () => Object.fromEntries((project.locales ?? []).map((entry) => [entry.locale, entry.value])),
    [project.locales],
  );
  const targetLocales = localeConfig?.available.filter((locale) => locale !== localeConfig.default) ?? [];
  const [targetLocale, setTargetLocale] = useState(targetLocales[0] ?? localeConfig?.default ?? "");
  const [draft, setDraft] = useState<LocaleTable>(() => ({ ...(tables[targetLocale] ?? {}) }));
  const [status, setStatus] = useState("");
  const currentTarget = targetLocales.includes(targetLocale) ? targetLocale : targetLocales[0] ?? targetLocale;
  const targetTable = currentTarget === targetLocale ? draft : { ...(tables[currentTarget] ?? {}) };
  const defaultTable = localeConfig ? tables[localeConfig.default] ?? {} : {};
  const report = buildTranslationReport(rows, targetTable, defaultTable);
  const usedKeys = new Set([
    ...rows.flatMap((row) => row.textKey ? [row.textKey] : []),
    ...Object.keys(defaultTable),
    ...Object.keys(targetTable),
  ]);

  if (!localeConfig || targetLocales.length === 0) {
    return (
      <div style={emptyStyle}>
        <h3 style={titleStyle}>翻译对照</h3>
        <p>先在项目设置中登记默认语言和至少一种目标语言，再回到这里开始翻译。</p>
      </div>
    );
  }

  const chooseLocale = (locale: string) => {
    setTargetLocale(locale);
    setDraft({ ...(tables[locale] ?? {}) });
    setStatus("");
  };

  return (
    <section style={containerStyle} aria-label="翻译对照">
      <header style={headerStyle}>
        <div>
          <h3 style={titleStyle}>翻译对照</h3>
          <p style={subtitleStyle}>左侧保持默认原文；右侧只保存目标语言译文。翻译 key 必须由你显式生成。</p>
        </div>
        <label style={localeFieldStyle}>
          <span>目标语言</span>
          <select value={currentTarget} onChange={(event) => chooseLocale(event.target.value)} style={selectStyle}>
            {targetLocales.map((locale) => <option key={locale} value={locale}>{locale}</option>)}
          </select>
        </label>
        <Button
          variant="primary"
          onClick={() => {
            setStatus("保存中…");
            void onSaveLocale(currentTarget, targetTable)
              .then(() => setStatus("译文已保存"))
              .catch((error) => setStatus(`保存失败：${error instanceof Error ? error.message : String(error)}`));
          }}
        >
          保存 {currentTarget}
        </Button>
      </header>
      <div style={summaryStyle}>
        <span>未分配 key：{report.missingKeys}</span>
        <span>缺少译文：{report.missingTranslations}</span>
        <span>孤立译文：{report.orphanKeys.length}</span>
        <span>默认文本漂移：{report.defaultTextDrift}</span>
        {status && <strong>{status}</strong>}
      </div>
      <div style={listStyle}>
        {rows.map((row) => {
          const key = row.textKey;
          return (
            <article key={`${row.nodeId}:${row.instructionIndex}`} style={rowStyle}>
              <div style={sourceStyle}>
                <div style={locationStyle}>{row.chapterTitle} / {row.nodeTitle} / {row.instructionId}</div>
                <div style={sourceTextStyle}>{row.speaker ? `${row.speaker}：` : ""}{row.text}</div>
                {key ? (
                  <code style={keyStyle}>{key}</code>
                ) : (
                  <Button
                    onClick={() => {
                      const generated = generateTranslationKey(row, usedKeys);
                      setStatus("正在写入翻译 key…");
                      void onAssignKey(row, generated)
                        .then(() => setStatus(`已生成 ${generated}`))
                        .catch((error) => setStatus(`生成失败：${error instanceof Error ? error.message : String(error)}`));
                    }}
                  >
                    生成稳定 key
                  </Button>
                )}
              </div>
              <div style={translationStyle}>
                {key ? (
                  <textarea
                    aria-label={`${row.nodeTitle} 的 ${currentTarget} 译文`}
                    value={targetTable[key] ?? ""}
                    placeholder="输入译文；留空时运行时回退到默认语言或原文"
                    onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
                    style={textareaStyle}
                  />
                ) : (
                  <div style={disabledTranslationStyle}>生成 key 后即可填写译文</div>
                )}
              </div>
            </article>
          );
        })}
        {rows.length === 0 && <div style={emptyStyle}>当前脚本还没有台词或旁白。</div>}
      </div>
    </section>
  );
}

function readLocaleConfig(meta: unknown): { default: string; available: string[] } | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const locale = (meta as { locale?: unknown }).locale;
  if (!locale || typeof locale !== "object" || Array.isArray(locale)) return null;
  const value = locale as { default?: unknown; available?: unknown };
  return typeof value.default === "string" && Array.isArray(value.available)
    && value.available.every((tag) => typeof tag === "string")
    ? { default: value.default, available: value.available }
    : null;
}

const containerStyle: CSSProperties = { height: "100%", overflow: "auto", background: "var(--bg-inset)" };
const headerStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-4)", borderBottom: "1px solid var(--border)", background: "var(--bg-app)" };
const titleStyle: CSSProperties = { margin: 0, fontSize: "var(--text-lg)" };
const subtitleStyle: CSSProperties = { margin: "var(--space-1) 0 0", color: "var(--text-muted)" };
const localeFieldStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: "var(--space-1)", marginLeft: "auto", color: "var(--text-secondary)" };
const selectStyle: CSSProperties = { padding: "7px var(--space-2)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)", background: "var(--bg-panel)", color: "var(--text-primary)" };
const summaryStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: "var(--space-3)", padding: "var(--space-2) var(--space-4)", borderBottom: "1px solid var(--border)", color: "var(--text-secondary)" };
const listStyle: CSSProperties = { display: "flex", flexDirection: "column" };
const rowStyle: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "var(--space-4)", padding: "var(--space-4)", borderBottom: "1px solid var(--border)" };
const sourceStyle: CSSProperties = { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "var(--space-2)", minWidth: 0 };
const translationStyle: CSSProperties = { minWidth: 0 };
const locationStyle: CSSProperties = { color: "var(--text-muted)", fontSize: "var(--text-sm)" };
const sourceTextStyle: CSSProperties = { whiteSpace: "pre-wrap", lineHeight: 1.65 };
const keyStyle: CSSProperties = { color: "var(--status-ok-text)" };
const textareaStyle: CSSProperties = { boxSizing: "border-box", width: "100%", minHeight: 88, resize: "vertical", padding: "var(--space-3)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)", background: "var(--bg-panel)", color: "var(--text-primary)", font: "inherit", lineHeight: 1.6 };
const disabledTranslationStyle: CSSProperties = { minHeight: 88, display: "grid", placeItems: "center", border: "1px dashed var(--border)", color: "var(--text-muted)" };
const emptyStyle: CSSProperties = { padding: "var(--space-6)", color: "var(--text-muted)" };
