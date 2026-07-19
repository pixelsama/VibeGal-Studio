/**
 * 导出工作台 —— 把当前项目打包成可发布的桌面游戏。
 *
 * 后端契约：build_desktop_game 等命令（game_build.rs / desktop_system.rs），
 * 内部调用随应用分发的 vibegal-cli，成功/失败都是结构化 JSON（见 lib/tauri.ts）。
 * 构建/冒烟状态保存在模块级 buildStore，切换工作台不丢失。
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  desktopBuildPreflight,
  pickDirectory,
  revealPath,
  runDesktopGame,
  type DesktopBuildDiagnostic,
  type DesktopBuildFailure,
  type DesktopBuildPreflight,
  type DesktopBuildResult,
  type DesktopRuntime,
} from "../../lib/tauri";
import type { ProjectData, ProjectIssue } from "../../lib/types";
import { loadExportPrefs, saveExportPrefs } from "../../lib/exportPrefs";
import {
  cancelDesktopBuild,
  startDesktopBuild,
  startDesktopSmoke,
  useDesktopBuildState,
  type DesktopBuildState,
} from "./buildStore";

// ──────────────────────────────────────────────
// 纯逻辑（可单测）
// ──────────────────────────────────────────────

/** 默认输出目录：<项目>/dist/desktop-<runtime>。dist 首级目录已被 watcher 忽略 */
export function defaultDesktopOutDir(projectPath: string, runtime: DesktopRuntime): string {
  return `${projectPath}/dist/desktop-${runtime}`;
}

function normalizePathForCheck(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isAbsolutePath(normalized: string): boolean {
  return normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized);
}

function isFilesystemRoot(normalized: string): boolean {
  return normalized === "" || /^[A-Za-z]:$/.test(normalized);
}

/**
 * 输出目录前端预校验，镜像 CLI ensure_export_out_dir_safe 的规则
 * （后端仍会兜底；这里只为尽早给出中文提示）。
 */
export function validateDesktopOutDir(projectPath: string, outDir: string): string | null {
  const trimmed = outDir.trim();
  if (!trimmed) return "请选择输出目录";
  const out = normalizePathForCheck(trimmed);
  if (isFilesystemRoot(out)) return "输出目录不能是文件系统根目录";
  if (!isAbsolutePath(out)) return "输出目录需要是绝对路径";

  const root = normalizePathForCheck(projectPath);
  if (out === root || root.startsWith(`${out}/`)) {
    return "输出目录不能是项目根目录或其上级目录";
  }
  for (const protectedDir of ["content", "renderers", ".galstudio"]) {
    const prefix = `${root}/${protectedDir}`;
    if (out === prefix || out.startsWith(`${prefix}/`)) {
      return `输出目录不能位于项目源目录 ${protectedDir}/ 内`;
    }
  }
  return null;
}

/** 预检报告里会真正阻止构建的硬性问题；Electron 未缓存只提示（会自动下载） */
export function preflightBlockReason(
  report: DesktopBuildPreflight | null,
  runtime: DesktopRuntime,
): string | null {
  if (!report) return null; // 检查中不阻塞
  if (!report.cliAvailable) return "找不到随应用分发的 vibegal-cli，无法构建";
  if (report.error) return "环境检查失败，无法构建";
  if (report.node && !report.node.available) return "未找到 Node.js，无法构建";
  if (report.exporter && (!report.exporter.webWorker || !report.exporter.desktopWorker)) {
    return "桌面打包组件缺失，无法构建";
  }
  if (runtime === "tauri" && report.tauriPlayer && !report.tauriPlayer.available) {
    return "找不到 Tauri 轻量 Player，无法以轻量模式构建";
  }
  return null;
}

export const DESKTOP_BUILD_STEPS = ["validate", "web-build", "desktop-package"] as const;

export function buildStepLabel(step: string): string {
  if (step === "validate") return "校验项目";
  if (step === "web-build") return "构建 Web 产物";
  if (step === "desktop-package") return "打包桌面运行时";
  return step;
}

export type BuildStepStatus = "done" | "active" | "pending";

export function buildStepStatus(step: string, state: DesktopBuildState): BuildStepStatus {
  if (state.completedSteps.includes(step)) return "done";
  if (state.progress?.step === step) return "active";
  return "pending";
}

export function smokeCheckLabel(check: string): string {
  const labels: Record<string, string> = {
    desktopManifest: "桌面清单",
    desktopExecutable: "可执行文件",
    webPayload: "Web 产物",
    desktopBehavior: "桌面行为",
    advance: "播放推进",
    saveRoundTrip: "存档读写",
    mediaLoad: "媒体加载",
  };
  return labels[check] ?? check;
}

export interface BuildFailurePresentation {
  title: string;
  hint: string | null;
}

/** 把结构化失败映射为对用户友好的中文标题与引导 */
export function buildFailurePresentation(failure: DesktopBuildFailure): BuildFailurePresentation {
  switch (failure.code) {
    case "desktop_cli_unavailable":
      return { title: "找不到随应用分发的 vibegal-cli", hint: "请通过正式安装的 VibeGal-Studio 运行，或检查安装是否完整。" };
    case "desktop_build_spawn_failed":
      return { title: "无法启动构建进程", hint: null };
    case "desktop_build_invalid_output":
      return { title: "构建工具返回了无法解析的结果", hint: "应用与 CLI 版本可能不匹配，请更新 VibeGal-Studio。" };
    case "desktop_build_task_failed":
      return { title: "构建任务异常结束", hint: null };
    case "desktop_build_in_progress":
      return { title: "已有构建正在进行中", hint: null };
    case "desktop_build_cancelled":
      return { title: "构建已取消", hint: null };
    case "desktop_build_failed":
      return cliFailurePresentation(failure);
    default:
      return { title: "构建失败", hint: null };
  }
}

function cliFailurePresentation(failure: DesktopBuildFailure): BuildFailurePresentation {
  switch (failure.cliError?.code) {
    case "validation_failed":
    case "build_validation_failed":
      return { title: "项目校验未通过", hint: "请根据下方问题列表修复后重试；仅警告时可在高级选项中允许警告。" };
    case "build_path_error":
      return { title: "输出目录不合法", hint: "输出目录不能是项目根目录或其上级，也不能位于 content/、renderers/、.galstudio/ 内。" };
    case "desktop_worker_unavailable":
      return { title: "找不到桌面打包组件", hint: "应用安装不完整，请重新安装 VibeGal-Studio。" };
    case "desktop_tauri_player_unavailable":
      return { title: "找不到 Tauri 轻量 Player", hint: "应用安装不完整，或检查 VIBEGAL_TAURI_PLAYER 配置。" };
    case "desktop_worker_failed":
      return { title: "桌面打包失败", hint: "桌面构建需要系统安装 Node.js（或配置 VIBEGAL_NODE 环境变量）。" };
    case "desktop_worker_invalid_output":
      return { title: "桌面打包组件返回了无法解析的结果", hint: "应用与打包组件版本可能不匹配。" };
    case "desktop_base_path_unsupported":
      return { title: "桌面构建不支持自定义 base path", hint: null };
    case "renderer_compile_failed":
      return { title: "渲染层编译失败", hint: "请根据下方诊断修复渲染层代码后重试。" };
    default:
      return { title: "构建失败", hint: null };
  }
}

/** 与 Workspace.tsx 的 projectIssueSourceLabel 保持一致（这里独立一份避免循环依赖） */
export function exportIssueSourceLabel(source: string): string {
  if (source === "graph") return "图结构";
  if (source === "node") return "节点内容";
  if (source === "asset") return "资产";
  if (source === "meta") return "项目设置";
  if (source === "manifest") return "manifest";
  return source;
}

/** 按 source 分组，保持首次出现顺序 */
export function groupIssuesBySource(issues: ProjectIssue[]): [string, ProjectIssue[]][] {
  const groups = new Map<string, ProjectIssue[]>();
  for (const issue of issues) {
    const list = groups.get(issue.source) ?? [];
    list.push(issue);
    groups.set(issue.source, list);
  }
  return [...groups.entries()];
}

export function formatElapsedSeconds(startedAt: number, now: number): number {
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

const RUNTIME_OPTIONS: { id: DesktopRuntime; name: string; badge: string; description: string }[] = [
  {
    id: "electron",
    name: "Electron 兼容模式",
    badge: "默认",
    description: "内置固定 Chromium，跨机器表现一致。首次构建需下载运行时（约 100MB），之后复用本地缓存。",
  },
  {
    id: "tauri",
    name: "Tauri 轻量模式",
    badge: "轻量",
    description: "使用系统 WebView，产物体积更小；WebView 版本随操作系统更新，不同机器表现可能有差异。",
  },
];

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
  const initialPrefs = useMemo(() => loadExportPrefs(project.path), [project.path]);
  const [runtime, setRuntime] = useState<DesktopRuntime>(initialPrefs.runtime);
  const [customOutDir, setCustomOutDir] = useState(initialPrefs.customOutDir);
  const [rendererId, setRendererId] = useState(initialPrefs.rendererId);
  const [strict, setStrict] = useState(initialPrefs.strict);
  const [allowWarnings, setAllowWarnings] = useState(initialPrefs.allowWarnings);
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const buildState = useDesktopBuildState(project.path);
  const building = buildState.phase === "building";

  // 环境预检：挂载时加载一次，可手动刷新
  const [preflight, setPreflight] = useState<DesktopBuildPreflight | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const refreshPreflight = useCallback(async () => {
    setPreflightLoading(true);
    try {
      setPreflight(await loadPreflight());
    } finally {
      setPreflightLoading(false);
    }
  }, [loadPreflight]);
  useEffect(() => {
    let disposed = false;
    setPreflightLoading(true);
    void loadPreflight()
      .then((report) => {
        if (!disposed) setPreflight(report);
      })
      .finally(() => {
        if (!disposed) setPreflightLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [loadPreflight]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!building) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [building]);

  const persistPrefs = (patch: Partial<{ runtime: DesktopRuntime; customOutDir: string; rendererId: string; strict: boolean; allowWarnings: boolean }>) => {
    const next = { runtime, customOutDir, rendererId, strict, allowWarnings, ...patch };
    saveExportPrefs(project.path, next);
  };

  const effectiveOutDir = customOutDir.trim() ? customOutDir : defaultDesktopOutDir(project.path, runtime);
  const effectiveRendererId = rendererId || project.meta.activeRendererId || project.rendererIds[0] || "";
  const outDirError = validateDesktopOutDir(project.path, effectiveOutDir);
  const blockReason = preflightBlockReason(preflight, runtime);

  const projectIssues = project.projectReport?.projectIssues ?? [];
  const errorCount = projectIssues.filter((issue) => issue.severity === "error").length;
  const warnCount = projectIssues.length - errorCount;

  const handleRuntimeChange = (next: DesktopRuntime) => {
    setRuntime(next);
    persistPrefs({ runtime: next });
  };
  const handleRendererChange = (next: string) => {
    setRendererId(next);
    persistPrefs({ rendererId: next });
  };
  const handleOutDirChange = (next: string) => {
    setCustomOutDir(next);
    persistPrefs({ customOutDir: next });
  };
  const handleBrowse = async () => {
    const selected = await pickDirectory();
    if (selected) handleOutDirChange(selected);
  };
  const handleStrictChange = (next: boolean) => {
    setStrict(next);
    persistPrefs({ strict: next });
  };
  const handleAllowWarningsChange = (next: boolean) => {
    setAllowWarnings(next);
    persistPrefs({ allowWarnings: next });
  };

  const handleBuild = () => {
    if (building || outDirError || blockReason) return;
    setActionError(null);
    void startDesktopBuild(project.path, {
      projectPath: project.path,
      outDir: effectiveOutDir,
      runtime,
      rendererId: effectiveRendererId || undefined,
      strict,
      allowWarnings,
    });
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
    void startDesktopSmoke(project.path, { distDir: result.outDir, runtime });
  };

  const buildDisabled = building || Boolean(outDirError) || Boolean(blockReason);
  const statusText = building
    ? `构建中…已用 ${formatElapsedSeconds(buildState.startedAt ?? now, now)} 秒`
    : buildState.phase === "success"
      ? "上一次构建成功"
      : buildState.phase === "failure"
        ? "上一次构建失败"
        : buildState.phase === "cancelled"
          ? "上一次构建已取消"
          : null;

  return (
    <div style={pageStyle}>
      <section style={sectionStyle}>
        <div style={headerRowStyle}>
          <h2 style={sectionTitleStyle}>导出桌面游戏</h2>
          {statusText && <span style={statusStyle}>{statusText}</span>}
        </div>

        <PreflightPanel report={preflight} loading={preflightLoading} onRefresh={() => void refreshPreflight()} />

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

        <div style={fieldGroupStyle}>
          <span style={fieldLabelStyle}>渲染层</span>
          <select
            value={effectiveRendererId}
            disabled={building || project.rendererIds.length === 0}
            onChange={(event) => handleRendererChange(event.target.value)}
            style={selectStyle}
            aria-label="渲染层"
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
            label="严格模式（--strict）"
            description="任何校验问题（含警告）都会让构建失败。"
            checked={strict}
            disabled={building}
            onChange={handleStrictChange}
          />
          <CheckboxField
            label="允许警告（--allow-warnings）"
            description="存在警告级问题时仍然产出构建结果。"
            checked={allowWarnings}
            disabled={building}
            onChange={handleAllowWarningsChange}
          />
        </div>

        {errorCount > 0 && (
          <div style={warnBannerStyle} role="status">
            当前项目有 {errorCount} 个错误{warnCount > 0 ? `、${warnCount} 个警告` : ""}。
            默认仍会尝试构建；开启严格模式后校验错误将阻止构建。
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
            {building ? "构建中…" : "构建桌面游戏"}
          </button>
          {building && (
            <button type="button" onClick={handleCancel} style={secondaryButtonStyle}>
              取消构建
            </button>
          )}
          {!building && blockReason && <span style={errorTextStyle}>{blockReason}</span>}
          {building && runtime === "electron" && (
            <span style={hintTextStyle}>首次 Electron 构建需要下载运行时，可能较慢。</span>
          )}
        </div>

        {building && <BuildProgressSteps state={buildState} />}

        {buildState.phase === "cancelled" && (
          <div style={infoBannerStyle} role="status" data-testid="build-cancelled-panel">
            构建已取消。调整选项后可重新发起构建。
          </div>
        )}

        {buildState.phase === "success" && buildState.result && (
          <BuildSuccessPanel
            result={buildState.result}
            state={buildState}
            runtimeName={RUNTIME_OPTIONS.find((o) => o.id === buildState.result?.runtime)?.name ?? buildState.result.runtime ?? "desktop"}
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
  onRefresh,
}: {
  report: DesktopBuildPreflight | null;
  loading: boolean;
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
                : "未找到——桌面构建需要安装 Node.js 或配置 VIBEGAL_NODE"
            }
          />
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
          <PreflightRow
            ok={report.tauriPlayer?.available ?? false}
            label="Tauri 轻量 Player"
            detail={report.tauriPlayer?.available ? "已随应用分发" : "未找到——轻量模式不可用"}
          />
          <PreflightRow
            ok={(report.exporter?.webWorker && report.exporter?.desktopWorker) ?? false}
            label="打包组件"
            detail={
              report.exporter?.webWorker && report.exporter?.desktopWorker
                ? "Web / 桌面打包组件就绪"
                : "打包组件缺失，请重新安装 VibeGal-Studio"
            }
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

export function BuildProgressSteps({ state }: { state: DesktopBuildState }) {
  return (
    <div style={stepsPanelStyle} data-testid="build-progress-steps">
      {DESKTOP_BUILD_STEPS.map((step) => {
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
          {smoke.phase === "running" ? "冒烟检查中…" : "冒烟检查"}
        </button>
        <button type="button" onClick={() => onCopyPath(result.outDir)} style={secondaryButtonStyle}>
          {copied ? "已复制" : "复制路径"}
        </button>
      </div>
      {actionError && <span style={errorTextStyle}>{actionError}</span>}

      {smoke.phase === "running" && (
        <span style={hintTextStyle}>正在真实启动游戏窗口做行为检查，最长约 30 秒…</span>
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
            <dt style={resultTermStyle}>产物清单</dt>
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
      <span style={hintTextStyle}>产物可直接运行；压缩该目录即可分发。签名、公证与安装器属于后续发布环节。</span>
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
