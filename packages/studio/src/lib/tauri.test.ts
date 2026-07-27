import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  buildDesktopGame,
  buildWebGame,
  cancelDesktopGameBuild,
  createProject,
  desktopBuildPreflight,
  isDesktopBuildResult,
  normalizeDesktopBuildFailure,
  openProject,
  pickOverviewAssetFiles,
  readRendererSource,
  rendererSourceFingerprint,
  repairProjectSupportFiles,
  renameVariable,
  revealPath,
  runDesktopGame,
  saveNode,
  saveThemeSetting,
  smokeDesktopGame,
  smokeWebGame,
  type DesktopBuildResult,
  type WebBuildResult,
} from "./tauri";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);
const openMock = vi.mocked(open);

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

const webSuccessResult: WebBuildResult = {
  ok: true,
  target: "web",
  outDir: "/project/dist/web",
  rendererId: "default",
  artifacts: [],
  warnings: [],
};

beforeEach(() => {
  invokeMock.mockReset();
  openMock.mockReset();
});

describe("createProject", () => {
  it("passes content and renderer template choices to Rust", async () => {
    invokeMock.mockResolvedValue({ path: "/projects/Story" });

    await createProject("/projects", "Story", "example", "classic");

    expect(invokeMock).toHaveBeenCalledWith("create_project", {
      parentDir: "/projects",
      name: "Story",
      template: "example",
      rendererTemplate: "classic",
    });
  });

  it("defaults new projects to the default renderer template", async () => {
    invokeMock.mockResolvedValue({ path: "/projects/Story" });

    await createProject("/projects", "Story", "blank");

    expect(invokeMock).toHaveBeenCalledWith("create_project", expect.objectContaining({
      rendererTemplate: "default",
    }));
  });
});

describe("pickOverviewAssetFiles", () => {
  it("opens one multi-file picker for every auto-classified asset extension", async () => {
    openMock.mockResolvedValue(["/tmp/bg.png", "/tmp/theme.ogg"]);

    await expect(pickOverviewAssetFiles()).resolves.toEqual(["/tmp/bg.png", "/tmp/theme.ogg"]);
    expect(openMock).toHaveBeenCalledWith({
      multiple: true,
      filters: [{
        name: "Assets",
        extensions: expect.arrayContaining(["png", "mp3", "mp4", "ttf"]),
      }],
    });
  });
});

describe("saveNode", () => {
  it("uses the typed identity-aware persistence boundary", async () => {
    const expectedRevision = { relPath: "content/nodes/start.json", mtimeMs: 1, size: 2 };
    const result = {
      instructions: [{ t: "narrate", id: "sp_saved", text: "Saved" }],
      serializedText: '[{"t":"narrate","id":"sp_saved","text":"Saved"}]',
      revision: { relPath: "content/nodes/start.json", mtimeMs: 2, size: 64 },
      assigned: [{ file: "content/nodes/start.json", nodeId: "start", jsonPath: "$[0].id", id: "sp_saved" }],
    };
    invokeMock.mockResolvedValue(result);

    await expect(saveNode(
      "/project",
      "nodes/start.json",
      [{ t: "narrate", text: "Saved" }],
      expectedRevision,
    )).resolves.toEqual(result);
    expect(invokeMock).toHaveBeenCalledWith("save_node", {
      projectPath: "/project",
      nodeFile: "nodes/start.json",
      instructions: [{ t: "narrate", text: "Saved" }],
      expectedRevision,
    });
  });
});

describe("buildWebGame", () => {
  it("以 camelCase 参数调用 build_web_game 并透传 Web 结果", async () => {
    invokeMock.mockResolvedValue(webSuccessResult);

    const outcome = await buildWebGame({
      projectPath: "/project",
      outDir: "/project/dist/web",
      buildId: "web-42",
      rendererId: "default",
      strict: true,
      allowWarnings: false,
    });

    expect(invokeMock).toHaveBeenCalledWith("build_web_game", {
      request: {
        projectPath: "/project",
        outDir: "/project/dist/web",
        buildId: "web-42",
        rendererId: "default",
        strict: true,
        allowWarnings: false,
      },
    });
    expect(outcome).toEqual(webSuccessResult);
  });

  it("Web 构建失败沿用结构化失败契约", async () => {
    invokeMock.mockRejectedValue({
      ok: false,
      code: "desktop_build_failed",
      message: "项目校验未通过",
      cliError: { code: "validation_failed", step: "validate" },
    });

    await expect(buildWebGame({ projectPath: "/project", outDir: "/out" })).resolves.toMatchObject({
      ok: false,
      code: "desktop_build_failed",
      cliError: { code: "validation_failed" },
    });
  });
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

describe("smokeWebGame", () => {
  const webSmokeResult = {
    ok: true,
    target: "web",
    distDir: "/project/dist/web",
    basePath: "./",
    checks: ["index", "gameManifest", "runtime", "content", "assets", "basePath"],
  };

  it("以 request 包裹参数调用 smoke_web_game", async () => {
    invokeMock.mockResolvedValue(webSmokeResult);

    const outcome = await smokeWebGame({ distDir: "/project/dist/web" });

    expect(invokeMock).toHaveBeenCalledWith("smoke_web_game", {
      request: { distDir: "/project/dist/web" },
    });
    expect(outcome).toEqual(webSmokeResult);
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

describe("openProject", () => {
  it("对后端原样返回的 manifest 归一化：补齐缺省的 unlocks 等注册表", async () => {
    // 后端原样返回 manifest.json（不套用 schema 默认值）；
    // 缺 unlocks 的项目不能再让 UI 裸访问 manifest.unlocks.endings 抛 TypeError
    const rawProject = {
      path: "/project",
      meta: { title: "P", activeRendererId: "default" },
      content: {
        manifest: { characters: {}, backgrounds: {} },
        meta: {},
        variables: { version: 1, variables: {} },
      },
      rendererIds: ["default"],
    };
    invokeMock.mockResolvedValue(rawProject);

    const project = await openProject("/project");

    expect(invokeMock).toHaveBeenCalledWith("open_project", { path: "/project" });
    expect(project.content.manifest.unlocks).toEqual({ cg: {}, music: {}, replay: {}, endings: {} });
    expect(project.content.manifest.audio).toEqual({ bgm: {}, sfx: {}, voice: {} });
  });
});

describe("renderer trust and project support commands", () => {
  it("reads renderer files and their fingerprint as one source snapshot", async () => {
    const source = {
      files: [{ path: "index.tsx", content: "export default {};" }],
      fingerprint: "abc123",
    };
    invokeMock.mockResolvedValue(source);

    await expect(readRendererSource("/project", "default")).resolves.toEqual(source);
    expect(invokeMock).toHaveBeenCalledWith("read_renderer_source", {
      projectPath: "/project",
      rendererId: "default",
    });
  });

  it("gets the renderer source fingerprint without reading files in React", async () => {
    invokeMock.mockResolvedValue("abc123");

    await expect(rendererSourceFingerprint("/project", "default")).resolves.toBe("abc123");
    expect(invokeMock).toHaveBeenCalledWith("renderer_source_fingerprint", {
      projectPath: "/project",
      rendererId: "default",
    });
  });

  it("updates the theme without dropping persisted renderer trust", async () => {
    invokeMock
      .mockResolvedValueOnce({ theme: "system", rendererTrust: { renderer: "hash" } })
      .mockResolvedValueOnce(undefined);

    await saveThemeSetting("dark");

    expect(invokeMock).toHaveBeenNthCalledWith(1, "load_app_settings");
    expect(invokeMock).toHaveBeenNthCalledWith(2, "save_app_settings", {
      settings: { theme: "dark", rendererTrust: { renderer: "hash" } },
    });
  });

  it("repairs missing project support files only through an explicit command", async () => {
    invokeMock.mockResolvedValue([".galstudio/schemas/variables.json"]);

    await expect(repairProjectSupportFiles("/project")).resolves.toEqual([
      ".galstudio/schemas/variables.json",
    ]);
    expect(invokeMock).toHaveBeenCalledWith("repair_project_support_files", {
      projectPath: "/project",
    });
  });
});

describe("renameVariable", () => {
  it("sends the rename to the backend as one atomic call", async () => {
    invokeMock.mockResolvedValue({
      variablesRevision: null,
      graphRevision: null,
      updatedConditions: 2,
      updatedNodes: 1,
    });

    const result = await renameVariable("/project", "variable_1", "affection");

    expect(invokeMock).toHaveBeenCalledWith("rename_variable", {
      projectPath: "/project",
      from: "variable_1",
      to: "affection",
    });
    expect(result.updatedConditions).toBe(2);
  });

  it("propagates a backend rejection instead of leaving the caller to guess", async () => {
    invokeMock.mockRejectedValue(new Error("变量 affection 已存在"));
    await expect(renameVariable("/project", "variable_1", "affection")).rejects.toThrow("已存在");
  });
});
