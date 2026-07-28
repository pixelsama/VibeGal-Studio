import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { LocaleTable, ProjectData } from "../../lib/types";
import { Button } from "../common/Button";
import { useStudioI18n } from "../../lib/i18n";
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
  const { t } = useStudioI18n();
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
  const sourceTable = tables[currentTarget] ?? {};
  const sourceIdentity = localeTableIdentity(sourceTable);
  const observedIdentityRef = useRef(sourceIdentity);
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (observedIdentityRef.current === sourceIdentity) return;
    observedIdentityRef.current = sourceIdentity;
    if (!dirtyRef.current) setDraft({ ...sourceTable });
  }, [sourceIdentity, sourceTable]);

  const targetTable = currentTarget === targetLocale ? draft : { ...sourceTable };
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
        <h3 style={titleStyle}>{t("script.translation.title")}</h3>
        <p>{t("script.translation.setupHint")}</p>
      </div>
    );
  }

  const chooseLocale = (locale: string) => {
    const nextTable = tables[locale] ?? {};
    setTargetLocale(locale);
    setDraft({ ...nextTable });
    observedIdentityRef.current = localeTableIdentity(nextTable);
    dirtyRef.current = false;
    setStatus("");
  };

  return (
    <section style={containerStyle} aria-label={t("script.translation.title")}>
      <header style={headerStyle}>
        <div>
          <h3 style={titleStyle}>{t("script.translation.title")}</h3>
          <p style={subtitleStyle}>{t("script.translation.description")}</p>
        </div>
        <label style={localeFieldStyle}>
          <span>{t("script.translation.targetLocale")}</span>
          <select value={currentTarget} onChange={(event) => chooseLocale(event.target.value)} style={selectStyle}>
            {targetLocales.map((locale) => <option key={locale} value={locale}>{locale}</option>)}
          </select>
        </label>
        <Button
          variant="primary"
          onClick={() => {
            setStatus(t("script.translation.saving"));
            void onSaveLocale(currentTarget, targetTable)
              .then(() => {
                observedIdentityRef.current = localeTableIdentity(targetTable);
                dirtyRef.current = false;
                setStatus(t("script.translation.saved"));
              })
              .catch((error) => setStatus(t("script.translation.saveFailed", {
                detail: error instanceof Error ? error.message : String(error),
              })));
          }}
        >
          {t("script.translation.saveLocale", { locale: currentTarget })}
        </Button>
      </header>
      <div style={summaryStyle}>
        <span>{t("script.translation.missingKeys", { count: report.missingKeys })}</span>
        <span>{t("script.translation.missingTranslations", { count: report.missingTranslations })}</span>
        <span>{t("script.translation.orphanTranslations", { count: report.orphanKeys.length })}</span>
        <span>{t("script.translation.defaultTextDrift", { count: report.defaultTextDrift })}</span>
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
                      setStatus(t("script.translation.writingKey"));
                      void onAssignKey(row, generated)
                        .then(() => setStatus(t("script.translation.keyGenerated", { key: generated })))
                        .catch((error) => setStatus(t("script.translation.keyFailed", {
                          detail: error instanceof Error ? error.message : String(error),
                        })));
                    }}
                  >
                    {t("script.translation.generateKey")}
                  </Button>
                )}
              </div>
              <div style={translationStyle}>
                {key ? (
                  <textarea
                    aria-label={t("script.translation.textareaLabel", {
                      title: row.nodeTitle,
                      locale: currentTarget,
                    })}
                    value={targetTable[key] ?? ""}
                    placeholder={t("script.translation.placeholder")}
                    onChange={(event) => {
                      dirtyRef.current = true;
                      setDraft((current) => ({ ...current, [key]: event.target.value }));
                    }}
                    style={textareaStyle}
                  />
                ) : (
                  <div style={disabledTranslationStyle}>{t("script.translation.generateFirst")}</div>
                )}
              </div>
            </article>
          );
        })}
        {rows.length === 0 && <div style={emptyStyle}>{t("script.translation.empty")}</div>}
      </div>
    </section>
  );
}

function localeTableIdentity(table: LocaleTable): string {
  return JSON.stringify(Object.entries(table).sort(([left], [right]) => left.localeCompare(right)));
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
