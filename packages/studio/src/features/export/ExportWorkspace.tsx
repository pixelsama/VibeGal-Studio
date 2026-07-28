/**
 * 导出工作台 —— 把当前项目打包成可发布的桌面游戏。
 *
 * 后端契约：build_desktop_game 等命令（game_build.rs / desktop_system.rs），
 * 内部调用随应用分发的 vibegal-cli，成功/失败都是结构化 JSON（见 lib/tauri.ts）。
 * 构建/冒烟状态保存在模块级 buildStore，切换工作台不丢失。
 */
import type { CSSProperties } from "react";
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
          <h2 style={sectionTitleStyle}>导出游戏</h2>
          {statusText && <span style={statusStyle}>{statusText}</span>}
        </div>

        <PreflightPanel report={preflight} loading={preflightLoading} target={target} onRefresh={() => void refreshPreflight()} />

        <div style={fieldGroupStyle}>
          <span style={fieldLabelStyle}>导出目标</span>
          <div style={runtimeRowStyle}>
            <TargetCard
              active={target === "web"}
              disabled={building}
              name="Web 网页版"
              badge="可部署"
              description="生成静态网站，可上传到任意静态托管服务或自己的服务器。"
              onClick={() => handleTargetChange("web")}
            />
            <TargetCard
              active={target === "desktop"}
              disabled={building}
              name="桌面版"
              badge="可运行"
              description="生成 Windows、macOS 或 Linux 可直接运行的桌面游戏目录。"
              onClick={() => handleTargetChange("desktop")}
            />
          </div>
        </div>

        {target === "desktop" && (
          <div style={fieldGroupStyle}>
            <span style={fieldLabelStyle}>运行时</span>
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
                        {option.name}
                      </span>
                      <span style={runtimeBadgeStyle}>{option.badge}</span>
                    </span>
                    <span style={runtimeCardDescStyle}>{option.description}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div style={fieldGroupStyle}>
          <span style={fieldLabelStyle}>界面风格</span>
          <select
            value={effectiveRendererId}
            disabled={building || project.rendererIds.length === 0}
            onChange={(event) => handleRendererChange(event.target.value)}
            style={selectStyle}
            aria-label="界面风格"
          >
            {project.rendererIds.map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
        </div>

        <div style={fieldGroupStyle}>
          <span style={fieldLabelStyle}>输出目录</span>
          <div style={outDirRowStyle}>
            <input
              type="text"
              value={effectiveOutDir}
              disabled={building}
              onChange={(event) => handleOutDirChange(event.target.value)}
              style={{ ...textInputStyle, flex: 1 }}
              aria-label="输出目录"
            />
            <button type="button" onClick={() => void handleBrowse()} disabled={building} style={secondaryButtonStyle}>
              浏览…
            </button>
            {customOutDir.trim() && (
              <button type="button" onClick={() => handleOutDirChange("")} disabled={building} style={secondaryButtonStyle}>
                重置为默认
              </button>
            )}
          </div>
          {outDirError ? (
            <span style={errorTextStyle}>{outDirError}</span>
          ) : (
            <span style={hintTextStyle}>产物是可直接运行的 portable 目录，默认输出到项目 dist/ 下（不会触发热重载）。</span>
          )}
        </div>

        <div style={fieldGroupStyle}>
          <span style={fieldLabelStyle}>高级选项</span>
          <CheckboxField
            label="将警告视为错误"
            description="存在警告级问题时阻止构建；项目错误始终会阻止构建。"
            checked={strict}
            disabled={building}
            onChange={handleStrictChange}
          />
          <CheckboxField
            label="仍然允许警告"
            description="即使启用了上一项，存在警告时也继续产出构建结果。"
            checked={allowWarnings}
            disabled={building}
            onChange={handleAllowWarningsChange}
          />
        </div>

        {errorCount > 0 && (
          <div style={warnBannerStyle} role="status">
            当前项目有 {errorCount} 个错误{warnCount > 0 ? `、${warnCount} 个警告` : ""}。
            项目错误会阻止构建；警告是否阻止构建由上方选项决定。
          </div>
        )}
        {hasUnsavedChanges && (
          <div style={infoBannerStyle} role="status">
            其他工作台有未保存的草稿。构建只读取磁盘文件，草稿内容不会包含在产物中。
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
            {building ? "构建中…" : target === "web" ? "构建 Web 游戏" : "构建桌面游戏"}
          </button>
          {building && (
            <button type="button" onClick={handleCancel} style={secondaryButtonStyle}>
              取消构建
            </button>
          )}
          {!building && blockReason && <span style={errorTextStyle}>{blockReason}</span>}
          {building && buildState.target === "desktop" && runtime === "electron" && (
            <span style={hintTextStyle}>首次 Electron 构建需要下载运行时，可能较慢。</span>
          )}
        </div>

        {building && <BuildProgressSteps state={buildState} target={buildState.target ?? target} />}

        {buildState.phase === "cancelled" && (
          <div style={infoBannerStyle} role="status" data-testid="build-cancelled-panel">
            构建已取消。调整选项后可重新发起构建。
          </div>
        )}

        {buildState.phase === "success" && buildState.result && (
          <BuildSuccessPanel
            result={buildState.result}
            state={buildState}
            runtimeName={buildState.result.target === "web"
              ? "Web 网页版"
              : RUNTIME_OPTIONS.find((o) => o.id === buildState.result?.runtime)?.name ?? buildState.result.runtime ?? "桌面版"}
            copied={copied}
            actionError={actionError}
            onCopyPath={(text) => void handleCopyPath(text)}
            onReveal={(path) => void handleReveal(path)}
            onRunGame={(executable) => void handleRunGame(executable)}
            onSmoke={handleSmoke}
          />
        )}
        {buildState.phase === "failure" && buildState.failure && (
          <BuildFailurePanel failure={buildState.failure} />
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
}: {
  report: DesktopBuildPreflight | null;
  loading: boolean;
  target: ExportTarget;
  onRefresh: () => void;
}) {
  return (
    <div style={preflightPanelStyle} data-testid="preflight-panel">
      <div style={preflightHeaderStyle}>
        <span style={fieldLabelStyle}>构建环境</span>
        <button type="button" onClick={onRefresh} disabled={loading} style={secondaryButtonStyle}>
          {loading ? "检查中…" : "重新检查"}
        </button>
      </div>
      {!report && <span style={hintTextStyle}>{loading ? "正在检查构建环境…" : "尚未检查"}</span>}
      {report && !report.cliAvailable && (
        <PreflightRow ok={false} label="vibegal-cli" detail="找不到随应用分发的 vibegal-cli" />
      )}
      {report?.error && <PreflightRow ok={false} label="环境检查" detail={report.error} />}
      {report?.cliAvailable && !report.error && (
        <>
          <PreflightRow
            ok={report.node?.available ?? false}
            label="Node.js"
            detail={
              report.node?.available
                ? `${report.node.version ?? "已安装"}${report.node.source === "env" ? "（VIBEGAL_NODE）" : ""}`
                : target === "web"
                  ? "未找到——Web 构建需要安装 Node.js 或配置 VIBEGAL_NODE"
                  : "未找到——桌面构建需要安装 Node.js 或配置 VIBEGAL_NODE"
            }
          />
          {target === "desktop" && (
            <PreflightRow
              ok={report.electron?.cached ?? false}
              okIsInfo
              label="Electron 运行时"
              detail={
                report.electron?.overridePath
                  ? `使用 VIBEGAL_ELECTRON_DIST 指定的运行时（${report.electron.version}）`
                  : report.electron?.cached
                    ? `已缓存（${report.electron.version}）`
                    : "未缓存，首次 Electron 构建将自动下载（约 100MB）"
              }
            />
          )}
          {target === "desktop" && (
            <PreflightRow
              ok={report.tauriPlayer?.available ?? false}
              label="Tauri 轻量 Player"
              detail={report.tauriPlayer?.available ? "已随应用分发" : "未找到——轻量模式不可用"}
            />
          )}
          <PreflightRow
            ok={target === "web"
              ? report.exporter?.webWorker ?? false
              : (report.exporter?.webWorker && report.exporter?.desktopWorker) ?? false}
            label="打包组件"
            detail={target === "web"
              ? report.exporter?.webWorker ? "Web 打包组件就绪" : "Web 打包组件缺失，请重新安装 VibeGal-Studio"
              : report.exporter?.webWorker && report.exporter?.desktopWorker
                ? "Web / 桌面打包组件就绪"
                : "打包组件缺失，请重新安装 VibeGal-Studio"}
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

export function BuildProgressSteps({ state, target = state.target ?? "desktop" }: { state: DesktopBuildState; target?: ExportTarget }) {
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
              {buildStepLabel(step)}
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
}) {
  const smoke = state.smoke;
  return (
    <div style={successPanelStyle} data-testid="build-success-panel">
      <div style={resultHeaderStyle}>
        <span style={successIconStyle}>✓</span>
        <span style={resultTitleStyle}>构建成功（{runtimeName}）</span>
      </div>

      <div style={buildRowStyle}>
        <button type="button" onClick={() => onReveal(result.outDir)} style={secondaryButtonStyle}>
          打开输出目录
        </button>
        {result.executable && (
          <button type="button" onClick={() => onRunGame(result.executable!)} style={secondaryButtonStyle}>
            运行游戏
          </button>
        )}
        <button
          type="button"
          onClick={onSmoke}
          disabled={smoke.phase === "running"}
          style={secondaryButtonStyle}
        >
          {smoke.phase === "running" ? "检查中…" : result.target === "web" ? "上线前检查" : "冒烟检查"}
        </button>
        <button type="button" onClick={() => onCopyPath(result.outDir)} style={secondaryButtonStyle}>
          {copied ? "已复制" : "复制路径"}
        </button>
      </div>
      {actionError && <span style={errorTextStyle}>{actionError}</span>}

      {smoke.phase === "running" && (
        <span style={hintTextStyle}>
          {result.target === "web"
            ? "正在启动无头浏览器检查加载、推进、存档与媒体资源，最长约 30 秒…"
            : "正在真实启动游戏窗口做行为检查，最长约 30 秒…"}
        </span>
      )}
      {smoke.phase === "passed" && (
        <div style={smokePassStyle} data-testid="smoke-passed">
          <span style={successIconStyle}>✓ 冒烟通过</span>
          <div style={smokeChecksStyle}>
            {smoke.checks.map((check) => (
              <span key={check} style={smokeCheckItemStyle}>
                <span style={successIconStyle}>✓</span> {smokeCheckLabel(check)}
              </span>
            ))}
          </div>
        </div>
      )}
      {smoke.phase === "failed" && (
        <span style={errorTextStyle} data-testid="smoke-failed">冒烟未通过：{smoke.message}</span>
      )}

      <dl style={resultListStyle}>
        <dt style={resultTermStyle}>产物目录</dt>
        <dd style={resultDescStyle}>
          <code style={codeStyle}>{result.outDir}</code>
        </dd>
        {result.executable && (
          <>
            <dt style={resultTermStyle}>可执行文件</dt>
            <dd style={resultDescStyle}><code style={codeStyle}>{result.executable}</code></dd>
          </>
        )}
        {result.artifacts.length > 0 && (
          <>
            <dt style={resultTermStyle}>{result.target === "web" ? "部署清单" : "产物清单"}</dt>
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
          ? "产物可上传到静态托管服务；上线前建议完成冒烟检查。"
          : "产物可直接运行；压缩该目录即可分发。签名、公证与安装器属于后续发布环节。"}
      </span>
      {result.warnings.length > 0 && <IssueGroups issues={result.warnings} title={`警告（${result.warnings.length}）`} />}
    </div>
  );
}

function BuildFailurePanel({ failure }: { failure: DesktopBuildFailure }) {
  const presentation = buildFailurePresentation(failure);
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
          {cliError?.step ? `阶段：${cliError.step}` : ""}
          {cliError?.step && location ? " · " : ""}
          {location ? `位置：${location}` : ""}
        </p>
      )}
      {cliError?.issues && cliError.issues.length > 0 && (
        <IssueGroups issues={cliError.issues} title={`问题（${cliError.issues.length}）`} />
      )}
      {cliError?.diagnostics && cliError.diagnostics.length > 0 && (
        <DiagnosticList diagnostics={cliError.diagnostics} />
      )}
    </div>
  );
}

function IssueGroups({ issues, title }: { issues: ProjectIssue[]; title: string }) {
  return (
    <div style={issueGroupsStyle}>
      <span style={fieldLabelStyle}>{title}</span>
      {groupIssuesBySource(issues).map(([source, group]) => (
        <div key={source} style={issueGroupStyle}>
          <span style={issueGroupTitleStyle}>
            {exportIssueSourceLabel(source)}（{group.length}）
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

function DiagnosticList({ diagnostics }: { diagnostics: DesktopBuildDiagnostic[] }) {
  return (
    <div style={issueGroupsStyle}>
      <span style={fieldLabelStyle}>诊断（{diagnostics.length}）</span>
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
