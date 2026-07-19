import { describe, expect, it, vi } from "vitest";
import { listen } from "@tauri-apps/api/event";
import type {
  DesktopBuildFailure,
  DesktopBuildProgressPayload,
  DesktopBuildRequest,
  DesktopBuildResult,
  DesktopSmokeResult,
} from "../../lib/tauri";
import {
  cancelDesktopBuild,
  generateDesktopBuildId,
  getDesktopBuildState,
  IDLE_DESKTOP_BUILD_STATE,
  reduceDesktopBuildProgress,
  startDesktopBuild,
  startDesktopSmoke,
  subscribeDesktopBuild,
} from "./buildStore";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

const listenMock = vi.mocked(listen);

const request: DesktopBuildRequest = {
  projectPath: "/project-x",
  outDir: "/project-x/dist/desktop-electron",
  runtime: "electron",
};

const successResult: DesktopBuildResult = {
  ok: true,
  target: "desktop",
  outDir: "/project-x/dist/desktop-electron",
  rendererId: "default",
  runtime: "electron",
  mode: "compatible",
  executable: "/project-x/dist/desktop-electron/Game.exe",
  artifacts: ["Game.exe", "desktop.manifest.json"],
  warnings: [],
};

const smokeResult: DesktopSmokeResult = {
  ok: true,
  target: "desktop",
  distDir: "/project-x/dist/desktop-electron",
  basePath: "./",
  runtime: "electron",
  mode: "compatible",
  checks: ["desktopManifest", "desktopBehavior", "advance"],
};

const cliFailure: DesktopBuildFailure = {
  ok: false,
  code: "desktop_build_failed",
  message: "项目校验未通过",
  cliError: { code: "validation_failed", step: "validate", issues: [] },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("startDesktopBuild", () => {
  it("初始状态为 idle", () => {
    expect(getDesktopBuildState("/project-idle")).toEqual(IDLE_DESKTOP_BUILD_STATE);
  });

  it("开始后同步进入 building：生成 buildId、清空进度与 smoke", async () => {
    const gate = deferred<DesktopBuildResult>();
    const pending = startDesktopBuild("/project-building", request, () => gate.promise);

    const building = getDesktopBuildState("/project-building");
    expect(building.phase).toBe("building");
    expect(building.buildId).toMatch(/^desktop-/);
    expect(building.startedAt).not.toBeNull();
    expect(building.progress).toBeNull();
    expect(building.completedSteps).toEqual([]);
    expect(building.smoke.phase).toBe("idle");

    gate.resolve(successResult);
    await pending;
  });

  it("请求里带 buildId 时沿用并透传给 runner", async () => {
    const seen: DesktopBuildRequest[] = [];
    await startDesktopBuild("/project-ownid", { ...request, buildId: "build-fixed" }, async (req) => {
      seen.push(req);
      return successResult;
    });

    expect(seen[0].buildId).toBe("build-fixed");
    expect(getDesktopBuildState("/project-ownid").buildId).toBe("build-fixed");
  });

  it("开始后注册进度事件监听", async () => {
    await startDesktopBuild("/project-listen", request, async () => successResult);
    expect(listenMock).toHaveBeenCalledWith("desktop_build_progress", expect.any(Function));
  });

  it("成功后进入 success 并保存结果，进度字段复位", async () => {
    const outcome = await startDesktopBuild("/project-success", request, async () => successResult);

    expect(outcome).toEqual(successResult);
    expect(getDesktopBuildState("/project-success")).toMatchObject({
      phase: "success",
      startedAt: null,
      progress: null,
      result: successResult,
      failure: null,
    });
  });

  it("失败后进入 failure 并保存结构化失败", async () => {
    const outcome = await startDesktopBuild("/project-failure", request, async () => cliFailure);

    expect(outcome).toEqual(cliFailure);
    expect(getDesktopBuildState("/project-failure")).toMatchObject({
      phase: "failure",
      startedAt: null,
      result: null,
      failure: cliFailure,
    });
  });

  it("desktop_build_cancelled 进入 cancelled 而非 failure", async () => {
    const cancelled: DesktopBuildFailure = {
      ok: false,
      code: "desktop_build_cancelled",
      message: "桌面构建已取消",
      cliError: null,
    };
    await startDesktopBuild("/project-cancelled", request, async () => cancelled);

    expect(getDesktopBuildState("/project-cancelled").phase).toBe("cancelled");
  });

  it("同一项目构建中再次发起会被拒绝且不再调用 runner", async () => {
    const gate = deferred<DesktopBuildResult>();
    const second = vi.fn(async () => successResult);

    const pending = startDesktopBuild("/project-concurrency", request, () => gate.promise);
    const rejected = await startDesktopBuild("/project-concurrency", request, second);

    expect(rejected).toMatchObject({ ok: false, code: "desktop_build_in_progress" });
    expect(second).not.toHaveBeenCalled();

    gate.resolve(successResult);
    await pending;
  });

  it("新构建会把 smoke 状态重置为 idle", async () => {
    await startDesktopSmoke("/project-reset-smoke", { distDir: "/out" }, async () => smokeResult);
    expect(getDesktopBuildState("/project-reset-smoke").smoke.phase).toBe("passed");

    await startDesktopBuild("/project-reset-smoke", request, async () => successResult);
    expect(getDesktopBuildState("/project-reset-smoke").smoke).toEqual({
      phase: "idle",
      checks: [],
      message: null,
    });
  });
});

describe("reduceDesktopBuildProgress", () => {
  const buildingState = {
    ...IDLE_DESKTOP_BUILD_STATE,
    phase: "building" as const,
    buildId: "b1",
    startedAt: 1000,
  };

  it("记录最新事件并在 done 时累积完成阶段", () => {
    const started = reduceDesktopBuildProgress(buildingState, {
      buildId: "b1",
      projectPath: "/p",
      step: "validate",
      phase: "start",
      message: "校验项目",
      percent: null,
    });
    expect(started.progress).toEqual({ step: "validate", phase: "start", message: "校验项目", percent: null });
    expect(started.completedSteps).toEqual([]);

    const done = reduceDesktopBuildProgress(started, {
      buildId: "b1",
      projectPath: "/p",
      step: "validate",
      phase: "done",
      message: "校验完成",
      percent: 100,
    });
    expect(done.completedSteps).toEqual(["validate"]);

    const again = reduceDesktopBuildProgress(done, {
      buildId: "b1",
      projectPath: "/p",
      step: "validate",
      phase: "done",
      message: "校验完成",
      percent: 100,
    });
    expect(again.completedSteps).toEqual(["validate"]);
  });

  it("buildId 不匹配或非构建中时不改变状态", () => {
    const stale: DesktopBuildProgressPayload = {
      buildId: "other",
      projectPath: "/p",
      step: "validate",
      phase: "start",
      message: "x",
      percent: null,
    };
    expect(reduceDesktopBuildProgress(buildingState, stale)).toBe(buildingState);
    expect(reduceDesktopBuildProgress(IDLE_DESKTOP_BUILD_STATE, { ...stale, buildId: "b1" })).toBe(IDLE_DESKTOP_BUILD_STATE);
  });
});

describe("cancelDesktopBuild", () => {
  it("构建中时以后端取消命令终止；非构建中为空操作", async () => {
    // 非构建中：不应抛错
    await expect(cancelDesktopBuild("/project-noop")).resolves.toBeUndefined();

    const gate = deferred<DesktopBuildResult>();
    const pending = startDesktopBuild("/project-cancel", { ...request, buildId: "build-cancel-me" }, () => gate.promise);
    // 后端取消命令经由 lib wrapper 调用 invoke；这里只验证 store 侧不发疯
    await expect(cancelDesktopBuild("/project-cancel")).resolves.toBeUndefined();

    gate.resolve(successResult);
    await pending;
  });
});

describe("startDesktopSmoke", () => {
  it("通过后进入 passed 并保存 checks", async () => {
    const outcome = await startDesktopSmoke("/project-smoke-pass", { distDir: "/out" }, async () => smokeResult);

    expect(outcome).toEqual(smokeResult);
    expect(getDesktopBuildState("/project-smoke-pass").smoke).toEqual({
      phase: "passed",
      checks: smokeResult.checks,
      message: null,
    });
  });

  it("失败后进入 failed 并保存错误说明", async () => {
    const failure: DesktopBuildFailure = {
      ok: false,
      code: "desktop_smoke_failed",
      message: "桌面 Player 行为 smoke 未通过",
      cliError: { code: "smoke_desktop_behavior_failed", step: "desktopBehavior" },
    };
    await startDesktopSmoke("/project-smoke-fail", { distDir: "/out" }, async () => failure);

    expect(getDesktopBuildState("/project-smoke-fail").smoke).toEqual({
      phase: "failed",
      checks: [],
      message: "桌面 Player 行为 smoke 未通过",
    });
  });

  it("smoke 进行中再次发起会被拒绝", async () => {
    const gate = deferred<DesktopSmokeResult>();
    const pending = startDesktopSmoke("/project-smoke-busy", { distDir: "/out" }, () => gate.promise);
    const rejected = await startDesktopSmoke("/project-smoke-busy", { distDir: "/out" }, async () => smokeResult);

    expect(rejected).toMatchObject({ ok: false, code: "desktop_smoke_in_progress" });

    gate.resolve(smokeResult);
    await pending;
  });

  it("smoke 不影响构建结果状态", async () => {
    await startDesktopBuild("/project-smoke-keep", request, async () => successResult);
    await startDesktopSmoke("/project-smoke-keep", { distDir: "/out" }, async () => smokeResult);

    const state = getDesktopBuildState("/project-smoke-keep");
    expect(state.phase).toBe("success");
    expect(state.result).toEqual(successResult);
    expect(state.smoke.phase).toBe("passed");
  });
});

describe("generateDesktopBuildId", () => {
  it("生成可读的稳定格式", () => {
    // 0.5.toString(36) === "0.i"
    expect(generateDesktopBuildId(0, 0.5)).toBe("desktop-0-i");
    expect(generateDesktopBuildId()).toMatch(/^desktop-[a-z0-9]+-[a-z0-9]+$/);
  });
});

describe("subscribeDesktopBuild", () => {
  it("状态迁移时通知订阅者，退订后不再通知", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDesktopBuild("/project-sub", listener);

    const pending = startDesktopBuild("/project-sub", request, async () => successResult);
    expect(listener).toHaveBeenCalledTimes(1);

    await pending;
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    await startDesktopBuild("/project-sub", request, async () => cliFailure);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
