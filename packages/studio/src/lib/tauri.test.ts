import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  buildDesktopGame,
  cancelDesktopGameBuild,
  desktopBuildPreflight,
  isDesktopBuildResult,
  normalizeDesktopBuildFailure,
  revealPath,
  runDesktopGame,
  smokeDesktopGame,
  type DesktopBuildResult,
} from "./tauri";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

const successResult: DesktopBuildResult = {
  ok: true,
  target: "desktop",
  outDir: "/project/dist/desktop-electron",
  rendererId: "default",
  runtime: "electron",
  mode: "compatible",
  executable: "/project/dist/desktop-electron/My Game.exe",
  artifacts: ["My Game.exe", "desktop.manifest.json", "resources/app"],
  warnings: [],
};

beforeEach(() => {
  invokeMock.mockReset();
});

describe("buildDesktopGame", () => {
  it("以 camelCase 参数调用 build_desktop_game 命令", async () => {
    invokeMock.mockResolvedValue(successResult);

    await buildDesktopGame({
      projectPath: "/project",
      outDir: "/project/dist/desktop-electron",
      runtime: "electron",
      rendererId: "default",
      strict: true,
      allowWarnings: false,
    });

    expect(invokeMock).toHaveBeenCalledWith("build_desktop_game", {
      request: {
        projectPath: "/project",
        outDir: "/project/dist/desktop-electron",
        runtime: "electron",
        rendererId: "default",
        strict: true,
        allowWarnings: false,
      },
    });
  });

  it("成功时透传结构化构建结果", async () => {
    invokeMock.mockResolvedValue(successResult);

    const outcome = await buildDesktopGame({ projectPath: "/project", outDir: "/out" });

    expect(outcome).toEqual(successResult);
  });

  it("CLI 失败时把 reject 对象规范化为 DesktopBuildFailure", async () => {
    invokeMock.mockRejectedValue({
      ok: false,
      code: "desktop_build_failed",
      message: "项目校验未通过",
      cliError: { code: "validation_failed", step: "validate", issues: [] },
    });

    const outcome = await buildDesktopGame({ projectPath: "/project", outDir: "/out" });

    expect(outcome).toEqual({
      ok: false,
      code: "desktop_build_failed",
      message: "项目校验未通过",
      cliError: { code: "validation_failed", step: "validate", issues: [] },
    });
  });

  it("成功载荷形状不合法时返回 desktop_build_invalid_output", async () => {
    invokeMock.mockResolvedValue({ unexpected: true });

    const outcome = await buildDesktopGame({ projectPath: "/project", outDir: "/out" });

    expect(outcome).toMatchObject({ ok: false, code: "desktop_build_invalid_output" });
  });

  it("无法归类的异常包装为 desktop_build_unknown，不向上抛", async () => {
    invokeMock.mockRejectedValue(new Error("network blew up"));

    const outcome = await buildDesktopGame({ projectPath: "/project", outDir: "/out" });

    expect(outcome).toEqual({
      ok: false,
      code: "desktop_build_unknown",
      message: "network blew up",
      cliError: null,
    });
  });
});

describe("normalizeDesktopBuildFailure", () => {
  it("保留 code/message 并只接受对象形态的 cliError", () => {
    const failure = normalizeDesktopBuildFailure({
      code: "desktop_cli_unavailable",
      message: "找不到 vibegal-cli",
      cliError: "not-an-object",
    });

    expect(failure).toEqual({
      ok: false,
      code: "desktop_cli_unavailable",
      message: "找不到 vibegal-cli",
      cliError: null,
    });
  });

  it("非对象错误转字符串", () => {
    expect(normalizeDesktopBuildFailure("boom")).toMatchObject({
      code: "desktop_build_unknown",
      message: "boom",
    });
  });
});

describe("isDesktopBuildResult", () => {
  it("要求 ok === true 且 outDir 为字符串", () => {
    expect(isDesktopBuildResult(successResult)).toBe(true);
    expect(isDesktopBuildResult({ ok: true })).toBe(false);
    expect(isDesktopBuildResult({ ok: false, code: "x", message: "y" })).toBe(false);
    expect(isDesktopBuildResult(null)).toBe(false);
  });
});

describe("desktopBuildPreflight", () => {
  it("调用 desktop_build_preflight 并透传报告", async () => {
    const report = {
      ok: true,
      cliAvailable: true,
      node: { available: true, version: "v22.1.0", source: "path", path: "/usr/bin/node" },
      electron: { cached: false, version: "43.1.1", overridePath: null },
      tauriPlayer: { available: true, path: "/app/player/vibegal-player-tauri" },
      exporter: { webWorker: true, desktopWorker: true },
    };
    invokeMock.mockResolvedValue(report);

    const result = await desktopBuildPreflight();

    expect(invokeMock).toHaveBeenCalledWith("desktop_build_preflight");
    expect(result).toEqual(report);
  });

  it("CLI 缺失是状态而非异常", async () => {
    invokeMock.mockResolvedValue({ ok: false, cliAvailable: false });

    const result = await desktopBuildPreflight();

    expect(result).toEqual({ ok: false, cliAvailable: false });
  });

  it("doctor 进程失败时把错误写进 error 字段，不向上抛", async () => {
    invokeMock.mockRejectedValue({ ok: false, code: "desktop_build_spawn_failed", message: "启动 vibegal-cli 失败: boom" });

    const result = await desktopBuildPreflight();

    expect(result.ok).toBe(false);
    expect(result.error).toBe("启动 vibegal-cli 失败: boom");
  });
});

describe("smokeDesktopGame", () => {
  const smokeResult = {
    ok: true,
    target: "desktop",
    distDir: "/project/dist/desktop-electron",
    basePath: "./",
    runtime: "electron",
    mode: "compatible",
    checks: ["desktopManifest", "desktopExecutable", "webPayload", "desktopBehavior", "advance", "saveRoundTrip", "mediaLoad"],
  };

  it("以 request 包裹参数调用 smoke_desktop_game", async () => {
    invokeMock.mockResolvedValue(smokeResult);

    const outcome = await smokeDesktopGame({ distDir: "/project/dist/desktop-electron", runtime: "tauri" });

    expect(invokeMock).toHaveBeenCalledWith("smoke_desktop_game", {
      request: { distDir: "/project/dist/desktop-electron", runtime: "tauri" },
    });
    expect(outcome).toEqual(smokeResult);
  });

  it("smoke 失败规范化为 DesktopBuildFailure", async () => {
    invokeMock.mockRejectedValue({
      ok: false,
      code: "desktop_smoke_failed",
      message: "桌面 Player 行为 smoke 未通过",
      cliError: { code: "smoke_desktop_behavior_failed", step: "desktopBehavior" },
    });

    const outcome = await smokeDesktopGame({ distDir: "/out" });

    expect(outcome).toMatchObject({
      ok: false,
      code: "desktop_smoke_failed",
      cliError: { code: "smoke_desktop_behavior_failed" },
    });
  });

  it("结果形状不合法时返回 invalid_output", async () => {
    invokeMock.mockResolvedValue({ ok: true });

    const outcome = await smokeDesktopGame({ distDir: "/out" });

    expect(outcome).toMatchObject({ ok: false, code: "desktop_build_invalid_output" });
  });
});

describe("取消与系统交互命令", () => {
  it("cancelDesktopGameBuild 传 buildId", async () => {
    invokeMock.mockResolvedValue(undefined);

    await cancelDesktopGameBuild("build-42");

    expect(invokeMock).toHaveBeenCalledWith("cancel_desktop_game_build", { buildId: "build-42" });
  });

  it("revealPath 传 path", async () => {
    invokeMock.mockResolvedValue(undefined);

    await revealPath("/project/dist/desktop-electron");

    expect(invokeMock).toHaveBeenCalledWith("reveal_path", { path: "/project/dist/desktop-electron" });
  });

  it("runDesktopGame 传 executable", async () => {
    invokeMock.mockResolvedValue(undefined);

    await runDesktopGame("/project/dist/desktop-electron/Game.exe");

    expect(invokeMock).toHaveBeenCalledWith("run_desktop_game", { executable: "/project/dist/desktop-electron/Game.exe" });
  });

  it("buildDesktopGame 透传 buildId", async () => {
    invokeMock.mockResolvedValue(successResult);

    await buildDesktopGame({ projectPath: "/project", outDir: "/out", buildId: "build-42" });

    expect(invokeMock).toHaveBeenCalledWith("build_desktop_game", {
      request: expect.objectContaining({ buildId: "build-42" }),
    });
  });
});
