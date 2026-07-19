/**
 * 桌面构建状态 store（模块级，按项目路径隔离）。
 *
 * 为什么挂在模块上而不是组件 state：Workspace 切换工作台时用 key 整体重挂载，
 * 组件内 state 会丢失；构建可能耗时数分钟（Electron 首次下载运行时），
 * 期间用户切走再切回必须还能看到「构建中」与上一次的结果。
 * 同时这里保证同一项目同一时刻只有一个构建、一个 smoke。
 */
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import {
  buildDesktopGame,
  cancelDesktopGameBuild,
  DESKTOP_BUILD_PROGRESS_EVENT,
  smokeDesktopGame,
  type DesktopBuildFailure,
  type DesktopBuildOutcome,
  type DesktopBuildProgressPayload,
  type DesktopBuildRequest,
  type DesktopBuildResult,
  type DesktopSmokeOutcome,
  type DesktopSmokeRequest,
} from "../../lib/tauri";

export type DesktopBuildPhase = "idle" | "building" | "success" | "failure" | "cancelled";

/** 最新一条构建进度事件（对应后端转发的 desktop_build_progress） */
export interface DesktopBuildProgressState {
  step: string;
  phase: string;
  message: string;
  percent: number | null;
}

export type DesktopSmokePhase = "idle" | "running" | "passed" | "failed";

export interface DesktopSmokeState {
  phase: DesktopSmokePhase;
  checks: string[];
  /** phase 为 failed 时的错误说明 */
  message: string | null;
}

export const IDLE_DESKTOP_SMOKE_STATE: DesktopSmokeState = {
  phase: "idle",
  checks: [],
  message: null,
};

export interface DesktopBuildState {
  phase: DesktopBuildPhase;
  /** 当前/上一次构建的标识，用于进度事件关联与取消 */
  buildId: string | null;
  /** 构建开始时间戳（ms），用于已用时间展示；非构建中为 null */
  startedAt: number | null;
  /** 最新进度事件；非构建中为 null */
  progress: DesktopBuildProgressState | null;
  /** 已完成的阶段（validate / web-build / desktop-package） */
  completedSteps: string[];
  result: DesktopBuildResult | null;
  failure: DesktopBuildFailure | null;
  smoke: DesktopSmokeState;
}

export const IDLE_DESKTOP_BUILD_STATE: DesktopBuildState = {
  phase: "idle",
  buildId: null,
  startedAt: null,
  progress: null,
  completedSteps: [],
  result: null,
  failure: null,
  smoke: IDLE_DESKTOP_SMOKE_STATE,
};

/** 可注入的构建执行器，测试时替换为假实现 */
export type DesktopBuildRunner = (request: DesktopBuildRequest) => Promise<DesktopBuildOutcome>;
export type DesktopSmokeRunner = (request: DesktopSmokeRequest) => Promise<DesktopSmokeOutcome>;

interface BuildEntry {
  state: DesktopBuildState;
  listeners: Set<() => void>;
}

const entries = new Map<string, BuildEntry>();

function entryFor(projectPath: string): BuildEntry {
  let entry = entries.get(projectPath);
  if (!entry) {
    entry = { state: IDLE_DESKTOP_BUILD_STATE, listeners: new Set() };
    entries.set(projectPath, entry);
  }
  return entry;
}

function setState(projectPath: string, state: DesktopBuildState): void {
  const entry = entryFor(projectPath);
  entry.state = state;
  for (const listener of entry.listeners) listener();
}

export function getDesktopBuildState(projectPath: string): DesktopBuildState {
  return entryFor(projectPath).state;
}

export function subscribeDesktopBuild(projectPath: string, listener: () => void): () => void {
  const entry = entryFor(projectPath);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
  };
}

// ──────────────────────────────────────────────
// 进度事件
// ──────────────────────────────────────────────

/** 纯函数：把一条进度事件折算进构建状态（buildId 不匹配或非构建中则原样返回） */
export function reduceDesktopBuildProgress(
  state: DesktopBuildState,
  payload: DesktopBuildProgressPayload,
): DesktopBuildState {
  if (state.phase !== "building" || state.buildId !== payload.buildId) return state;
  const completedSteps =
    payload.phase === "done" && !state.completedSteps.includes(payload.step)
      ? [...state.completedSteps, payload.step]
      : state.completedSteps;
  return {
    ...state,
    progress: {
      step: payload.step,
      phase: payload.phase,
      message: payload.message,
      percent: payload.percent,
    },
    completedSteps,
  };
}

let progressListenerReady: Promise<unknown> | null = null;

function ensureProgressListener(): void {
  if (progressListenerReady) return;
  progressListenerReady = listen<DesktopBuildProgressPayload>(
    DESKTOP_BUILD_PROGRESS_EVENT,
    (event) => {
      const { projectPath } = event.payload;
      const entry = entries.get(projectPath);
      if (!entry) return;
      const next = reduceDesktopBuildProgress(entry.state, event.payload);
      if (next !== entry.state) setState(projectPath, next);
    },
  );
  // 非 Tauri 环境（纯浏览器/测试）中订阅会失败，静默降级为无进度展示
  progressListenerReady.catch(() => {
    progressListenerReady = null;
  });
}

// ──────────────────────────────────────────────
// 构建与取消
// ──────────────────────────────────────────────

export function generateDesktopBuildId(now = Date.now(), random = Math.random()): string {
  return `desktop-${now.toString(36)}-${random.toString(36).slice(2, 10)}`;
}

/**
 * 发起构建。同一项目已有构建在进行时立即返回
 * code = "desktop_build_in_progress" 的失败，不真正执行。
 */
export async function startDesktopBuild(
  projectPath: string,
  request: DesktopBuildRequest,
  run: DesktopBuildRunner = buildDesktopGame,
): Promise<DesktopBuildOutcome> {
  if (getDesktopBuildState(projectPath).phase === "building") {
    return {
      ok: false,
      code: "desktop_build_in_progress",
      message: "当前项目已有正在进行的构建，请等待完成",
      cliError: null,
    };
  }

  ensureProgressListener();
  const buildId = request.buildId ?? generateDesktopBuildId();
  setState(projectPath, {
    phase: "building",
    buildId,
    startedAt: Date.now(),
    progress: null,
    completedSteps: [],
    result: null,
    failure: null,
    smoke: IDLE_DESKTOP_SMOKE_STATE,
  });

  const outcome = await run({ ...request, buildId });

  if (outcome.ok) {
    setState(projectPath, {
      phase: "success",
      buildId,
      startedAt: null,
      progress: null,
      completedSteps: [],
      result: outcome,
      failure: null,
      smoke: IDLE_DESKTOP_SMOKE_STATE,
    });
  } else {
    const cancelled = outcome.code === "desktop_build_cancelled";
    setState(projectPath, {
      phase: cancelled ? "cancelled" : "failure",
      buildId,
      startedAt: null,
      progress: null,
      completedSteps: [],
      result: null,
      failure: outcome,
      smoke: IDLE_DESKTOP_SMOKE_STATE,
    });
  }
  return outcome;
}

/** 取消当前项目正在进行的构建；没有进行中的构建时为空操作 */
export async function cancelDesktopBuild(projectPath: string): Promise<void> {
  const state = getDesktopBuildState(projectPath);
  if (state.phase !== "building" || !state.buildId) return;
  try {
    await cancelDesktopGameBuild(state.buildId);
  } catch {
    // 构建恰好已结束时后端会报 not_found，忽略——结果态马上由 startDesktopBuild 落定
  }
}

// ──────────────────────────────────────────────
// 桌面 smoke
// ──────────────────────────────────────────────

/** 对构建产物运行 smoke。已有 smoke 在进行时立即返回失败，不真正执行 */
export async function startDesktopSmoke(
  projectPath: string,
  request: DesktopSmokeRequest,
  run: DesktopSmokeRunner = smokeDesktopGame,
): Promise<DesktopSmokeOutcome> {
  if (getDesktopBuildState(projectPath).smoke.phase === "running") {
    return {
      ok: false,
      code: "desktop_smoke_in_progress",
      message: "冒烟检查正在进行中，请等待完成",
      cliError: null,
    };
  }

  setState(projectPath, {
    ...getDesktopBuildState(projectPath),
    smoke: { phase: "running", checks: [], message: null },
  });

  const outcome = await run(request);
  const current = getDesktopBuildState(projectPath);
  if (outcome.ok) {
    setState(projectPath, {
      ...current,
      smoke: { phase: "passed", checks: outcome.checks, message: null },
    });
  } else {
    setState(projectPath, {
      ...current,
      smoke: { phase: "failed", checks: [], message: outcome.message },
    });
  }
  return outcome;
}

/** React 绑定：订阅指定项目的构建状态（SSR/静态渲染安全） */
export function useDesktopBuildState(projectPath: string): DesktopBuildState {
  const [state, setLocalState] = useState<DesktopBuildState>(() => getDesktopBuildState(projectPath));

  useEffect(() => {
    setLocalState(getDesktopBuildState(projectPath));
    return subscribeDesktopBuild(projectPath, () => {
      setLocalState(getDesktopBuildState(projectPath));
    });
  }, [projectPath]);

  return state;
}
