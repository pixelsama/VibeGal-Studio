/**
 * 导出工作台 —— 把当前项目打包成可发布的桌面游戏。
 *
 * 后端契约：build_desktop_game 等命令（game_build.rs / desktop_system.rs），
 * 内部调用随应用分发的 vibegal-cli，成功/失败都是结构化 JSON（见 lib/tauri.ts）。
 * 构建/冒烟状态保存在模块级 buildStore，切换工作台不丢失。
 */
import type { CSSProperties } from "react";
import { translateZhCN, useStudioI18n, type StudioTranslator } from "../../lib/i18n";
import {
  desktopBuildPreflight,
  pickDirectory,
  revealPath,
  runDesktopGame,
  type DesktopBuildDiagnostic,
  type DesktopBuildFailure,
  type DesktopBuildPreflight,
  type DesktopBuildResult,
} from "../../lib/tauri";
import type { ProjectData, ProjectIssue } from "../../lib/types";
import type { ExportTarget } from "../../lib/exportPrefs";
import {
  buildFailurePresentation,
  buildStepLabel,
  buildStepStatus,
  DESKTOP_BUILD_STEPS,
  exportIssueSourceLabel,
  groupIssuesBySource,
  RUNTIME_OPTIONS,
  smokeCheckLabel,
  WEB_BUILD_STEPS,
} from "./exportWorkspaceLogic";
export {
  buildFailurePresentation,
  buildStepLabel,
  buildStepStatus,
  defaultDesktopOutDir,
  defaultWebOutDir,
  DESKTOP_BUILD_STEPS,
  exportIssueSourceLabel,
  formatElapsedSeconds,
  groupIssuesBySource,
  preflightBlockReason,
  smokeCheckLabel,
  validateDesktopOutDir,
  WEB_BUILD_STEPS,
} from "./exportWorkspaceLogic";
export type { BuildFailurePresentation, BuildStepStatus } from "./exportWorkspaceLogic";
import {
  cancelDesktopBuild,
  startDesktopBuild,
  startDesktopSmoke,
  startWebBuild,
  startWebSmoke,
  type DesktopBuildState,
} from "./buildStore";
import { useExportWorkspaceState } from "./useExportWorkspaceState";

// ──────────────────────────────────────────────
// 组件
// ──────────────────────────────────────────────

export function ExportWorkspace({
  project,
  hasUnsavedChanges,
  loadPreflight = desktopBuildPreflight,
}: {
  project: ProjectData;
  hasUnsavedChanges: boolean;
  /** 可注入的预检加载器（测试用） */
  loadPreflight?: () => Promise<DesktopBuildPreflight>;
}) {
  const { t } = useStudioI18n();
  const {
    target,
    runtime,
    strict,
    allowWarnings,
    copied,
    actionError,
    buildState,
    building,
    preflight,
    preflightLoading,
    customOutDir,
    effectiveOutDir,
    effectiveRendererId,
    outDirError,
    blockReason,
    statusText,
    refreshPreflight,
    changeTarget: handleTargetChange,
    changeRuntime: handleRuntimeChange,
    changeRenderer: handleRendererChange,
    changeOutDir: handleOutDirChange,
    changeStrict: handleStrictChange,
    changeAllowWarnings: handleAllowWarningsChange,
    setCopied,
    setActionError,
  } = useExportWorkspaceState({ project, loadPreflight });

  const projectIssues = project.projectReport?.projectIssues ?? [];
  const errorCount = projectIssues.filter((issue) => issue.severity === "error").length;
  const warnCount = projectIssues.length - errorCount;

  const handleBrowse = async () => {
    const selected = await pickDirectory();
    if (selected) handleOutDirChange(selected);
  };

  const handleBuild = () => {
    if (building || outDirError || blockReason) return;
    setActionError(null);
    const request = {
      projectPath: project.path,
      outDir: effectiveOutDir,
      rendererId: effectiveRendererId || undefined,
      strict,
      allowWarnings,
    };
    if (target === "web") {
      void startWebBuild(project.path, request);
    } else {
      void startDesktopBuild(project.path, { ...request, runtime });
    }
  };

  const handleCancel = () => {
    void cancelDesktopBuild(project.path);
  };

  const handleCopyPath = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用时静默降级（路径文本本身可选中复制）
    }
  };

  const handleReveal = async (path: string) => {
    setActionError(null);
    try {
      await revealPath(path);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleRunGame = async (executable: string) => {
    setActionError(null);
    try {
      await runDesktopGame(executable);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleSmoke = () => {
    const result = buildState.result;
    if (!result || buildState.smoke.phase === "running") return;
    setActionError(null);
    if (result.target === "web") {
      void startWebSmoke(project.path, { distDir: result.outDir });
    } else {
      void startDesktopSmoke(project.path, { distDir: result.outDir, runtime: result.runtime });
    }
  };

  const buildDisabled = building || Boolean(outDirError) || Boolean(blockReason);

  return (
    <div style={pageStyle}>
      <section style={sectionStyle}>
        <div style={headerRowStyle}>
          <h2 style={sectionTitleStyle}>{t("export.title")}</h2>
          {statusText && <span style={statusStyle}>{statusText}</span>}
        </div>

        <PreflightPanel
          report={preflight}
          loading={preflightLoading}
          target={target}
          onRefresh={() => void refreshPreflight()}
          t={t}
        />

        <div style={fieldGroupStyle}>
          <span style={fieldLabelStyle}>{t("export.target")}</span>
          <div style={runtimeRowStyle}>
            <TargetCard
              active={target === "web"}
              disabled={building}
              name={t("export.target.web")}
              badge={t("export.target.webBadge")}
              description={t("export.target.webDescription")}
              onClick={() => handleTargetChange("web")}
            />
            <TargetCard
              active={target === "desktop"}
              disabled={building}
              name={t("export.target.desktop")}
              badge={t("export.target.desktopBadge")}
              description={t("export.target.desktopDescription")}
              onClick={() => handleTargetChange("desktop")}
            />
          </div>
        </div>

        {target === "desktop" && (
          <div style={fieldGroupStyle}>
            <span style={fieldLabelStyle}>{t("export.runtime")}</span>
            <div style={runtimeRowStyle}>
              {RUNTIME_OPTIONS.map((option) => {
                const active = runtime === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={active}
                    disabled={building}
                    onClick={() => handleRuntimeChange(option.id)}
                    style={{
                      ...runtimeCardStyle,
                      borderColor: active ? "var(--accent)" : "var(--border-strong)",
                    }}
                  >
                    <span style={runtimeCardHeaderStyle}>
                      <span style={{ ...runtimeCardNameStyle, color: active ? "var(--text-bright)" : "var(--text-primary)" }}>
                        {t(option.nameKey)}
                      </span>
                      <span style={runtimeBadgeStyle}>{t(option.badgeKey)}</span>
                    </span>
                    <span style={runtimeCardDescStyle}>{t(option.descriptionKey)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div style={fieldGroupStyle}>
          <span style={fieldLabelStyle}>{t("export.renderer")}</span>
          <select
            value={effectiveRendererId}
            disabled={building || project.rendererIds.length === 0}
            onChange={(event) => handleRendererChange(event.target.value)}
            style={selectStyle}
            aria-label={t("export.renderer")}
          >
            {project.rendererIds.map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
        </div>

        <div style={fieldGroupStyle}>
          <span style={fieldLabelStyle}>{t("export.outDir")}</span>
          <div style={outDirRowStyle}>
            <input
              type="text"
              value={effectiveOutDir}
              disabled={building}
              onChange={(event) => handleOutDirChange(event.target.value)}
              style={{ ...textInputStyle, flex: 1 }}
              aria-label={t("export.outDir")}
            />
            <button type="button" onClick={() => void handleBrowse()} disabled={building} style={secondaryButtonStyle}>
              {t("export.browse")}
            </button>
            {customOutDir.trim() && (
              <button type="button" onClick={() => handleOutDirChange("")} disabled={building} style={secondaryButtonStyle}>
                {t("export.resetDefault")}
              </button>
            )}
          </div>
          {outDirError ? (
            <span style={errorTextStyle}>{outDirError}</span>
          ) : (
            <span style={hintTextStyle}>{t("export.outDirHint")}</span>
          )}
        </div>

        <div style={fieldGroupStyle}>
          <span style={fieldLabelStyle}>{t("export.advanced")}</span>
          <CheckboxField
            label={t("export.strict")}
            description={t("export.strictDescription")}
            checked={strict}
            disabled={building}
            onChange={handleStrictChange}
          />
          <CheckboxField
            label={t("export.allowWarnings")}
            description={t("export.allowWarningsDescription")}
            checked={allowWarnings}
            disabled={building}
            onChange={handleAllowWarningsChange}
          />
        </div>

        {errorCount > 0 && (
          <div style={warnBannerStyle} role="status">
            {warnCount > 0
              ? t("export.projectErrorsWarnings", { errors: errorCount, warnings: warnCount })
              : t("export.projectErrors", { errors: errorCount })}
          </div>
        )}
        {hasUnsavedChanges && (
          <div style={infoBannerStyle} role="status">
            {t("export.unsaved")}
          </div>
        )}

        <div style={buildRowStyle}>
          <button
            type="button"
            onClick={handleBuild}
            disabled={buildDisabled}
            style={{
              ...buildButtonStyle,
              opacity: buildDisabled ? 0.55 : 1,
              cursor: buildDisabled ? "default" : "pointer",
            }}
          >
            {building
              ? t("export.building")
              : target === "web"
                ? t("export.buildWeb")
                : t("export.buildDesktop")}
          </button>
          {building && (
            <button type="button" onClick={handleCancel} style={secondaryButtonStyle}>
              {t("export.cancelBuild")}
            </button>
          )}
          {!building && blockReason && <span style={errorTextStyle}>{blockReason}</span>}
          {building && buildState.target === "desktop" && runtime === "electron" && (
            <span style={hintTextStyle}>{t("export.electronFirstBuild")}</span>
          )}
        </div>

        {building && <BuildProgressSteps state={buildState} target={buildState.target ?? target} t={t} />}

        {buildState.phase === "cancelled" && (
          <div style={infoBannerStyle} role="status" data-testid="build-cancelled-panel">
            {t("export.cancelled")}
          </div>
        )}

        {buildState.phase === "success" && buildState.result && (
          <BuildSuccessPanel
            result={buildState.result}
            state={buildState}
            runtimeName={buildState.result.target === "web"
              ? t("export.target.web")
              : RUNTIME_OPTIONS.find((o) => o.id === buildState.result?.runtime)
                ? t(RUNTIME_OPTIONS.find((o) => o.id === buildState.result?.runtime)!.nameKey)
                : buildState.result.runtime ?? t("export.target.desktop")}
            copied={copied}
            actionError={actionError}
            onCopyPath={(text) => void handleCopyPath(text)}
            onReveal={(path) => void handleReveal(path)}
            onRunGame={(executable) => void handleRunGame(executable)}
            onSmoke={handleSmoke}
            t={t}
          />
        )}
        {buildState.phase === "failure" && buildState.failure && (
          <BuildFailurePanel failure={buildState.failure} t={t} />
        )}
      </section>
    </div>
  );
}

// ──────────────────────────────────────────────
// 环境预检面板
// ──────────────────────────────────────────────

export function PreflightPanel({
  report,
  loading,
  target,
  onRefresh,
  t,
}: {
  report: DesktopBuildPreflight | null;
  loading: boolean;
  target: ExportTarget;
  onRefresh: () => void;
  t?: StudioTranslator;
}) {
  const translate = t ?? translateZhCN;
  return (
    <div style={preflightPanelStyle} data-testid="preflight-panel">
      <div style={preflightHeaderStyle}>
        <span style={fieldLabelStyle}>{translate("export.preflight.title")}</span>
        <button type="button" onClick={onRefresh} disabled={loading} style={secondaryButtonStyle}>
          {loading ? translate("export.preflight.checking") : translate("export.preflight.recheck")}
        </button>
      </div>
      {!report && (
        <span style={hintTextStyle}>
          {loading ? translate("export.preflight.checkingDetail") : translate("export.preflight.notChecked")}
        </span>
      )}
      {report && !report.cliAvailable && (
        <PreflightRow ok={false} label="vibegal-cli" detail={translate("export.preflight.cliMissing")} />
      )}
      {report?.error && <PreflightRow ok={false} label={translate("export.preflight.environment")} detail={report.error} />}
      {report?.cliAvailable && !report.error && (
        <>
          <PreflightRow
            ok={report.node?.available ?? false}
            label="Node.js"
            detail={
              report.node?.available
                ? report.node.source === "env"
                  ? translate("export.preflight.envNode", { version: report.node.version ?? translate("export.preflight.installed") })
                  : report.node.version ?? translate("export.preflight.installed")
                : target === "web"
                  ? translate("export.preflight.nodeRequiredWeb")
                  : translate("export.preflight.nodeRequiredDesktop")
            }
          />
          {target === "desktop" && (
            <PreflightRow
              ok={report.electron?.cached ?? false}
              okIsInfo
              label={translate("export.preflight.electron")}
              detail={
                report.electron?.overridePath
                  ? translate("export.preflight.electronOverride", { version: report.electron.version })
                  : report.electron?.cached
                    ? translate("export.preflight.electronCached", { version: report.electron.version })
                    : translate("export.preflight.electronDownload")
              }
            />
          )}
          {target === "desktop" && (
            <PreflightRow
              ok={report.tauriPlayer?.available ?? false}
              label={translate("export.preflight.tauriPlayer")}
              detail={report.tauriPlayer?.available
                ? translate("export.preflight.tauriAvailable")
                : translate("export.preflight.tauriMissing")}
            />
          )}
          <PreflightRow
            ok={target === "web"
              ? report.exporter?.webWorker ?? false
              : (report.exporter?.webWorker && report.exporter?.desktopWorker) ?? false}
            label={translate("export.preflight.packager")}
            detail={target === "web"
              ? report.exporter?.webWorker
                ? translate("export.preflight.webReady")
                : translate("export.preflight.webMissing")
              : report.exporter?.webWorker && report.exporter?.desktopWorker
                ? translate("export.preflight.desktopReady")
                : translate("export.preflight.desktopMissing")}
          />
        </>
      )}
    </div>
  );
}

function PreflightRow({ ok, label, detail, okIsInfo }: { ok: boolean; label: string; detail: string; okIsInfo?: boolean }) {
  return (
    <div style={preflightRowStyle}>
      <span style={ok ? successIconStyle : okIsInfo ? warnIconStyle : failureIconStyle}>
        {ok ? "✓" : okIsInfo ? "!" : "✗"}
      </span>
      <span style={preflightLabelStyle}>{label}</span>
      <span style={hintTextStyle}>{detail}</span>
    </div>
  );
}

// ──────────────────────────────────────────────
// 构建进度步骤
// ──────────────────────────────────────────────

export function BuildProgressSteps({
  state,
  target = state.target ?? "desktop",
  t = translateZhCN,
}: {
  state: DesktopBuildState;
  target?: ExportTarget;
  t?: StudioTranslator;
}) {
  const steps = target === "web" ? WEB_BUILD_STEPS : DESKTOP_BUILD_STEPS;
  return (
    <div style={stepsPanelStyle} data-testid="build-progress-steps">
      {steps.map((step) => {
        const status = buildStepStatus(step, state);
        return (
          <div key={step} style={stepRowStyle}>
            <span style={status === "done" ? successIconStyle : status === "active" ? warnIconStyle : pendingIconStyle}>
              {status === "done" ? "✓" : status === "active" ? "…" : "·"}
            </span>
            <span style={{ ...stepLabelStyle, color: status === "pending" ? "var(--text-muted)" : "var(--text-primary)" }}>
              {buildStepLabel(step, t)}
            </span>
            {status === "active" && state.progress && (
              <span style={hintTextStyle}>
                {state.progress.message}
                {state.progress.percent != null ? `（${state.progress.percent}%）` : ""}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ──────────────────────────────────────────────
// 结果面板
// ──────────────────────────────────────────────

function BuildSuccessPanel({
  result,
  state,
  runtimeName,
  copied,
  actionError,
  onCopyPath,
  onReveal,
  onRunGame,
  onSmoke,
  t,
}: {
  result: DesktopBuildResult;
  state: DesktopBuildState;
  runtimeName: string;
  copied: boolean;
  actionError: string | null;
  onCopyPath: (text: string) => void;
  onReveal: (path: string) => void;
  onRunGame: (executable: string) => void;
  onSmoke: () => void;
  t: StudioTranslator;
}) {
  const smoke = state.smoke;
  return (
    <div style={successPanelStyle} data-testid="build-success-panel">
      <div style={resultHeaderStyle}>
        <span style={successIconStyle}>✓</span>
        <span style={resultTitleStyle}>{t("export.success", { runtime: runtimeName })}</span>
      </div>

      <div style={buildRowStyle}>
        <button type="button" onClick={() => onReveal(result.outDir)} style={secondaryButtonStyle}>
          {t("export.openOutDir")}
        </button>
        {result.executable && (
          <button type="button" onClick={() => onRunGame(result.executable!)} style={secondaryButtonStyle}>
            {t("export.runGame")}
          </button>
        )}
        <button
          type="button"
          onClick={onSmoke}
          disabled={smoke.phase === "running"}
          style={secondaryButtonStyle}
        >
          {smoke.phase === "running"
            ? t("export.checking")
            : result.target === "web"
              ? t("export.prepublishCheck")
              : t("export.smokeCheck")}
        </button>
        <button type="button" onClick={() => onCopyPath(result.outDir)} style={secondaryButtonStyle}>
          {copied ? t("export.copied") : t("export.copyPath")}
        </button>
      </div>
      {actionError && <span style={errorTextStyle}>{actionError}</span>}

      {smoke.phase === "running" && (
        <span style={hintTextStyle}>
          {result.target === "web"
            ? t("export.smokeRunningWeb")
            : t("export.smokeRunningDesktop")}
        </span>
      )}
      {smoke.phase === "passed" && (
        <div style={smokePassStyle} data-testid="smoke-passed">
          <span style={successIconStyle}>✓ {t("export.smokePassed")}</span>
          <div style={smokeChecksStyle}>
            {smoke.checks.map((check) => (
              <span key={check} style={smokeCheckItemStyle}>
                <span style={successIconStyle}>✓</span> {smokeCheckLabel(check, t)}
              </span>
            ))}
          </div>
        </div>
      )}
      {smoke.phase === "failed" && (
        <span style={errorTextStyle} data-testid="smoke-failed">
          {t("export.smokeFailed", { detail: smoke.message ?? "" })}
        </span>
      )}

      <dl style={resultListStyle}>
        <dt style={resultTermStyle}>{t("export.result.outDir")}</dt>
        <dd style={resultDescStyle}>
          <code style={codeStyle}>{result.outDir}</code>
        </dd>
        {result.executable && (
          <>
            <dt style={resultTermStyle}>{t("export.result.executable")}</dt>
            <dd style={resultDescStyle}><code style={codeStyle}>{result.executable}</code></dd>
          </>
        )}
        {result.artifacts.length > 0 && (
          <>
            <dt style={resultTermStyle}>
              {result.target === "web" ? t("export.result.deployList") : t("export.result.artifactList")}
            </dt>
            <dd style={resultDescStyle}>
              <ul style={artifactListStyle}>
                {result.artifacts.map((artifact) => (
                  <li key={artifact}><code style={codeStyle}>{artifact}</code></li>
                ))}
              </ul>
            </dd>
          </>
        )}
      </dl>
      <span style={hintTextStyle}>
        {result.target === "web"
          ? t("export.result.webHint")
          : t("export.result.desktopHint")}
      </span>
      {result.warnings.length > 0 && (
        <IssueGroups issues={result.warnings} title={t("export.warnings", { count: result.warnings.length })} t={t} />
      )}
    </div>
  );
}

function BuildFailurePanel({ failure, t }: { failure: DesktopBuildFailure; t: StudioTranslator }) {
  const presentation = buildFailurePresentation(failure, t);
  const cliError = failure.cliError;
  const location = cliError?.file
    ? `${cliError.file}${cliError.line != null ? `:${cliError.line}` : ""}${cliError.column != null ? `:${cliError.column}` : ""}`
    : null;
  return (
    <div style={failurePanelStyle} data-testid="build-failure-panel">
      <div style={resultHeaderStyle}>
        <span style={failureIconStyle}>✗</span>
        <span style={resultTitleStyle}>{presentation.title}</span>
      </div>
      {failure.message && <p style={failureMessageStyle}>{failure.message}</p>}
      {presentation.hint && <p style={hintTextStyle}>{presentation.hint}</p>}
      {(cliError?.step || location) && (
        <p style={hintTextStyle}>
          {cliError?.step ? t("export.failure.stage", { stage: cliError.step }) : ""}
          {cliError?.step && location ? " · " : ""}
          {location ? t("export.failure.location", { location }) : ""}
        </p>
      )}
      {cliError?.issues && cliError.issues.length > 0 && (
        <IssueGroups issues={cliError.issues} title={t("export.issues", { count: cliError.issues.length })} t={t} />
      )}
      {cliError?.diagnostics && cliError.diagnostics.length > 0 && (
        <DiagnosticList diagnostics={cliError.diagnostics} t={t} />
      )}
    </div>
  );
}

function IssueGroups({ issues, title, t }: { issues: ProjectIssue[]; title: string; t: StudioTranslator }) {
  return (
    <div style={issueGroupsStyle}>
      <span style={fieldLabelStyle}>{title}</span>
      {groupIssuesBySource(issues).map(([source, group]) => (
        <div key={source} style={issueGroupStyle}>
          <span style={issueGroupTitleStyle}>
            {exportIssueSourceLabel(source, t)}（{group.length}）
          </span>
          <ul style={issueListStyle}>
            {group.map((issue, index) => (
              <li key={`${issue.code}-${index}`} style={issueItemStyle}>
                <span style={issue.severity === "error" ? failureIconStyle : warnIconStyle}>
                  {issue.severity === "error" ? "✗" : "!"}
                </span>
                <span>
                  {issue.message}
                  {issue.file ? <code style={codeStyle}>（{issue.file}）</code> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function DiagnosticList({ diagnostics, t }: { diagnostics: DesktopBuildDiagnostic[]; t: StudioTranslator }) {
  return (
    <div style={issueGroupsStyle}>
      <span style={fieldLabelStyle}>{t("export.diagnostics", { count: diagnostics.length })}</span>
      <ul style={issueListStyle}>
        {diagnostics.map((diagnostic, index) => (
          <li key={`${diagnostic.code ?? "diag"}-${index}`} style={issueItemStyle}>
            <span style={diagnostic.severity === "warn" ? warnIconStyle : failureIconStyle}>
              {diagnostic.severity === "warn" ? "!" : "✗"}
            </span>
            <span>
              {diagnostic.message}
              {diagnostic.file ? (
                <code style={codeStyle}>
                  （{diagnostic.file}
                  {diagnostic.line != null ? `:${diagnostic.line}` : ""}
                  {diagnostic.column != null ? `:${diagnostic.column}` : ""}）
                </code>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TargetCard({
  active,
  disabled,
  name,
  badge,
  description,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  name: string;
  badge: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      style={{
        ...runtimeCardStyle,
        borderColor: active ? "var(--accent)" : "var(--border-strong)",
      }}
    >
      <span style={runtimeCardHeaderStyle}>
        <span style={{ ...runtimeCardNameStyle, color: active ? "var(--text-bright)" : "var(--text-primary)" }}>
          {name}
        </span>
        <span style={runtimeBadgeStyle}>{badge}</span>
      </span>
      <span style={runtimeCardDescStyle}>{description}</span>
    </button>
  );
}

function CheckboxField({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label style={checkboxRowStyle}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <span style={checkboxLabelStyle}>{label}</span>
        <span style={hintTextStyle}>{description}</span>
      </span>
    </label>
  );
}

// ──────────────────────────────────────────────
// 样式（沿用 ProjectSettings 的设计变量）
// ──────────────────────────────────────────────

const pageStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  overflowY: "auto",
  background: "var(--bg-app)",
  padding: "var(--space-8) var(--space-12)",
};

const sectionStyle: CSSProperties = {
  maxWidth: 720,
  display: "flex",
  flexDirection: "column",
  gap: 20,
};

const headerRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-3)",
};

const sectionTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "var(--text-lg)",
  fontWeight: 650,
  color: "var(--text-bright)",
};

const statusStyle: CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--text-muted)",
};

const fieldGroupStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-3)",
};

const fieldLabelStyle: CSSProperties = {
  fontSize: "var(--text-base)",
  fontWeight: 600,
  color: "var(--text-primary)",
};

const runtimeRowStyle: CSSProperties = {
  display: "flex",
  gap: "var(--space-3)",
  flexWrap: "wrap",
};

const runtimeCardStyle: CSSProperties = {
  flex: 1,
  minWidth: 260,
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
  padding: "var(--space-3)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid",
  background: "var(--bg-panel)",
  textAlign: "left",
};

const runtimeCardHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
};

const runtimeCardNameStyle: CSSProperties = {
  fontSize: "var(--text-base)",
  fontWeight: 600,
};

const runtimeBadgeStyle: CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--text-muted)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-pill)",
  padding: "0 var(--space-2)",
};

const runtimeCardDescStyle: CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--text-secondary)",
  lineHeight: 1.5,
};

const selectStyle: CSSProperties = {
  width: 240,
  height: "var(--control-lg)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-input)",
  background: "var(--bg-inset)",
  color: "var(--text-primary)",
  padding: "0 var(--space-2)",
};

const outDirRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
};

const textInputStyle: CSSProperties = {
  height: "var(--control-lg)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-input)",
  background: "var(--bg-inset)",
  color: "var(--text-primary)",
  padding: "0 var(--space-2)",
};

const secondaryButtonStyle: CSSProperties = {
  height: "var(--control-lg)",
  padding: "0 var(--space-3)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-strong)",
  background: "var(--bg-panel)",
  color: "var(--text-primary)",
  fontSize: "var(--text-sm)",
  whiteSpace: "nowrap",
};

const errorTextStyle: CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--status-error-text)",
};

const hintTextStyle: CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--text-muted)",
  lineHeight: 1.5,
};

const warnBannerStyle: CSSProperties = {
  padding: "var(--space-2) var(--space-3)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--status-warn)",
  background: "var(--bg-panel)",
  color: "var(--text-primary)",
  fontSize: "var(--text-sm)",
  lineHeight: 1.5,
};

const infoBannerStyle: CSSProperties = {
  ...warnBannerStyle,
  border: "1px solid var(--border-strong)",
};

const buildRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-3)",
  flexWrap: "wrap",
};

const buildButtonStyle: CSSProperties = {
  height: "var(--control-lg)",
  padding: "0 var(--space-4)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--accent)",
  background: "var(--accent)",
  color: "var(--text-on-accent)",
  fontSize: "var(--text-base)",
};

const successPanelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-3)",
  padding: "var(--space-4)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--status-ok)",
  background: "var(--bg-panel)",
};

const failurePanelStyle: CSSProperties = {
  ...successPanelStyle,
  border: "1px solid var(--status-error)",
};

const resultHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
};

const resultTitleStyle: CSSProperties = {
  fontSize: "var(--text-base)",
  fontWeight: 650,
  color: "var(--text-bright)",
};

const successIconStyle: CSSProperties = {
  color: "var(--status-ok)",
  fontWeight: 700,
};

const failureIconStyle: CSSProperties = {
  color: "var(--status-error-text)",
  fontWeight: 700,
};

const warnIconStyle: CSSProperties = {
  color: "var(--status-warn)",
  fontWeight: 700,
};

const pendingIconStyle: CSSProperties = {
  color: "var(--text-muted)",
  fontWeight: 700,
};

const resultListStyle: CSSProperties = {
  margin: 0,
  display: "grid",
  gridTemplateColumns: "auto 1fr",
  gap: "var(--space-2) var(--space-3)",
  alignItems: "start",
};

const resultTermStyle: CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--text-muted)",
  whiteSpace: "nowrap",
};

const resultDescStyle: CSSProperties = {
  margin: 0,
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  flexWrap: "wrap",
  minWidth: 0,
};

const codeStyle: CSSProperties = {
  fontSize: "var(--text-sm)",
  wordBreak: "break-all",
};

const artifactListStyle: CSSProperties = {
  margin: 0,
  paddingLeft: "var(--space-4)",
};

const failureMessageStyle: CSSProperties = {
  margin: 0,
  fontSize: "var(--text-sm)",
  color: "var(--text-primary)",
  lineHeight: 1.5,
};

const issueGroupsStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
};

const issueGroupStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1)",
};

const issueGroupTitleStyle: CSSProperties = {
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  color: "var(--text-secondary)",
};

const issueListStyle: CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: "none",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1)",
};

const issueItemStyle: CSSProperties = {
  display: "flex",
  gap: "var(--space-2)",
  fontSize: "var(--text-sm)",
  color: "var(--text-primary)",
  lineHeight: 1.5,
};

const checkboxRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: "var(--space-2)",
};

const checkboxLabelStyle: CSSProperties = {
  display: "block",
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  color: "var(--text-primary)",
};

const preflightPanelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
  padding: "var(--space-3)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-strong)",
  background: "var(--bg-panel)",
};

const preflightHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-2)",
};

const preflightRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "var(--space-2)",
  fontSize: "var(--text-sm)",
};

const preflightLabelStyle: CSSProperties = {
  color: "var(--text-primary)",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const stepsPanelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
  padding: "var(--space-3)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-strong)",
  background: "var(--bg-panel)",
};

const stepRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "var(--space-2)",
  fontSize: "var(--text-sm)",
};

const stepLabelStyle: CSSProperties = {
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const smokePassStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
  fontSize: "var(--text-sm)",
};

const smokeChecksStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-2) var(--space-3)",
};

const smokeCheckItemStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-1)",
  color: "var(--text-primary)",
};
