/**
 * 游戏构建状态 store（模块级，按项目路径隔离）。
 *
 * Workspace 切换工作台时会整体重挂载，构建状态必须跨组件生命周期保留。
 * Web 与桌面构建共用同一项目槽位，保证同一项目同一时刻只写一个输出目标。
 */
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import {
  buildDesktopGame,
  buildWebGame,
  cancelDesktopGameBuild,
  DESKTOP_BUILD_PROGRESS_EVENT,
  smokeDesktopGame,
  smokeWebGame,
  type DesktopBuildFailure,
  type DesktopBuildOutcome,
  type DesktopBuildProgressPayload,
  type DesktopBuildRequest,
  type DesktopBuildResult,
  type DesktopSmokeOutcome,
  type DesktopSmokeRequest,
  type WebBuildOutcome,
  type WebBuildRequest,
  type WebSmokeOutcome,
  type WebSmokeRequest,
} from "../../lib/tauri";
import type { ExportTarget } from "../../lib/exportPrefs";

export type DesktopBuildPhase = "idle" | "building" | "success" | "failure" | "cancelled";

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
  message: string | null;
}

export const IDLE_DESKTOP_SMOKE_STATE: DesktopSmokeState = {
  phase: "idle",
  checks: [],
  message: null,
};

export interface DesktopBuildState {
  phase: DesktopBuildPhase;
  /** 当前/上一次构建目标；idle 时为 null。 */
  target: ExportTarget | null;
  buildId: string | null;
  startedAt: number | null;
  progress: DesktopBuildProgressState | null;
  completedSteps: string[];
  result: DesktopBuildResult | null;
  failure: DesktopBuildFailure | null;
  smoke: DesktopSmokeState;
}

export const IDLE_DESKTOP_BUILD_STATE: DesktopBuildState = {
  phase: "idle",
  target: null,
  buildId: null,
  startedAt: null,
  progress: null,
  completedSteps: [],
  result: null,
  failure: null,
  smoke: IDLE_DESKTOP_SMOKE_STATE,
};

export type DesktopBuildRunner = (request: DesktopBuildRequest) => Promise<DesktopBuildOutcome>;
export type WebBuildRunner = (request: WebBuildRequest) => Promise<WebBuildOutcome>;
export type DesktopSmokeRunner = (request: DesktopSmokeRequest) => Promise<DesktopSmokeOutcome>;
export type WebSmokeRunner = (request: WebSmokeRequest) => Promise<WebSmokeOutcome>;

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
  progressListenerReady.catch(() => {
    progressListenerReady = null;
  });
}

export function generateDesktopBuildId(now = Date.now(), random = Math.random()): string {
  return `desktop-${now.toString(36)}-${random.toString(36).slice(2, 10)}`;
}

async function startBuild<TRequest extends WebBuildRequest, TOutcome extends DesktopBuildOutcome>(
  projectPath: string,
  target: ExportTarget,
  request: TRequest,
  run: (request: TRequest) => Promise<TOutcome>,
): Promise<TOutcome | DesktopBuildFailure> {
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
    target,
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
      target,
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
      target,
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

export function startWebBuild(
  projectPath: string,
  request: WebBuildRequest,
  run: WebBuildRunner = buildWebGame,
): Promise<WebBuildOutcome> {
  return startBuild(projectPath, "web", request, run);
}

export function startDesktopBuild(
  projectPath: string,
  request: DesktopBuildRequest,
  run: DesktopBuildRunner = buildDesktopGame,
): Promise<DesktopBuildOutcome> {
  return startBuild(projectPath, "desktop", request, run);
}

export async function cancelDesktopBuild(projectPath: string): Promise<void> {
  const state = getDesktopBuildState(projectPath);
  if (state.phase !== "building" || !state.buildId) return;
  try {
    await cancelDesktopGameBuild(state.buildId);
  } catch {
    // 构建恰好已结束时后端会报 not_found，结果态马上由 startBuild 落定。
  }
}

async function startSmoke<TRequest extends WebSmokeRequest, TOutcome extends DesktopSmokeOutcome>(
  projectPath: string,
  request: TRequest,
  run: (request: TRequest) => Promise<TOutcome>,
): Promise<TOutcome | DesktopBuildFailure> {
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
  setState(projectPath, {
    ...current,
    smoke: outcome.ok
      ? { phase: "passed", checks: outcome.checks, message: null }
      : { phase: "failed", checks: [], message: outcome.message },
  });
  return outcome;
}

export function startWebSmoke(
  projectPath: string,
  request: WebSmokeRequest,
  run: WebSmokeRunner = smokeWebGame,
): Promise<WebSmokeOutcome> {
  return startSmoke(projectPath, request, run);
}

export function startDesktopSmoke(
  projectPath: string,
  request: DesktopSmokeRequest,
  run: DesktopSmokeRunner = smokeDesktopGame,
): Promise<DesktopSmokeOutcome> {
  return startSmoke(projectPath, request, run);
}

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
