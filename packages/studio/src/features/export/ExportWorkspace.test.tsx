import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopBuildFailure, DesktopBuildPreflight, DesktopBuildResult } from "../../lib/tauri";
import type { ProjectData, ProjectIssue } from "../../lib/types";
import { EXPORT_PREFS_STORAGE_KEY } from "../../lib/exportPrefs";
import { startDesktopBuild, startDesktopSmoke, type DesktopBuildState } from "./buildStore";
import {
  buildFailurePresentation,
  buildStepLabel,
  buildStepStatus,
  BuildProgressSteps,
  defaultDesktopOutDir,
  ExportWorkspace,
  formatElapsedSeconds,
  groupIssuesBySource,
  preflightBlockReason,
  PreflightPanel,
  smokeCheckLabel,
  validateDesktopOutDir,
} from "./ExportWorkspace";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeProject(overrides: Partial<ProjectData> = {}): ProjectData {
  return {
    path: "/project",
    meta: { name: "Galgame-test", activeRendererId: "default", createdAt: "0" },
    content: {
      manifest: { characters: {}, backgrounds: {}, audio: { bgm: {}, sfx: {}, voice: {} } },
      meta: {},
    },
    rendererIds: ["default", "mobile"],
    ...overrides,
  };
}

function stubExportPrefs(prefs: Record<string, unknown>) {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) =>
      key === EXPORT_PREFS_STORAGE_KEY ? JSON.stringify({ projects: prefs }) : null,
    setItem: () => {},
  });
}

const successResult: DesktopBuildResult = {
  ok: true,
  target: "desktop",
  outDir: "/project/dist/desktop-electron",
  rendererId: "default",
  runtime: "electron",
  mode: "compatible",
  executable: "/project/dist/desktop-electron/Galgame-test.exe",
  artifacts: ["Galgame-test.exe", "desktop.manifest.json", "resources/app"],
  warnings: [
    { severity: "warn", source: "asset", code: "unused_asset", message: "资产未被引用" } as ProjectIssue,
  ],
};

describe("defaultDesktopOutDir", () => {
  it("按 runtime 推导项目 dist 下的默认目录", () => {
    expect(defaultDesktopOutDir("/project", "electron")).toBe("/project/dist/desktop-electron");
    expect(defaultDesktopOutDir("/project", "tauri")).toBe("/project/dist/desktop-tauri");
  });
});

describe("validateDesktopOutDir", () => {
  it("接受项目内外的合法目录", () => {
    expect(validateDesktopOutDir("/project", "/project/dist/desktop-electron")).toBeNull();
    expect(validateDesktopOutDir("/project", "/other/release")).toBeNull();
    expect(validateDesktopOutDir("/project", "D:/release/game")).toBeNull();
  });

  it("拒绝空目录、相对路径与文件系统根目录", () => {
    expect(validateDesktopOutDir("/project", "  ")).toBe("请选择输出目录");
    expect(validateDesktopOutDir("/project", "dist/out")).toBe("输出目录需要是绝对路径");
    expect(validateDesktopOutDir("/project", "/")).toBe("输出目录不能是文件系统根目录");
    expect(validateDesktopOutDir("/project", "C:\\")).toBe("输出目录不能是文件系统根目录");
  });

  it("拒绝项目根目录及其上级目录", () => {
    expect(validateDesktopOutDir("/project", "/project")).toBe("输出目录不能是项目根目录或其上级目录");
    expect(validateDesktopOutDir("/project", "/")).not.toBeNull();
    expect(validateDesktopOutDir("/projects/game", "/projects")).toBe("输出目录不能是项目根目录或其上级目录");
  });

  it("拒绝项目源目录（含 Windows 分隔符归一化）", () => {
    expect(validateDesktopOutDir("/project", "/project/content/dist")).toBe("输出目录不能位于项目源目录 content/ 内");
    expect(validateDesktopOutDir("/project", "/project/renderers")).toBe("输出目录不能位于项目源目录 renderers/ 内");
    expect(validateDesktopOutDir("/project", "/project/.galstudio/x")).toBe("输出目录不能位于项目源目录 .galstudio/ 内");
    expect(validateDesktopOutDir("C:\\game", "C:\\game\\content\\out")).toBe("输出目录不能位于项目源目录 content/ 内");
  });

  it("content 前缀的兄弟目录不误伤", () => {
    expect(validateDesktopOutDir("/project", "/project/content-backup/out")).toBeNull();
  });
});

describe("buildFailurePresentation", () => {
  const make = (code: string, cliCode?: string): DesktopBuildFailure => ({
    ok: false,
    code,
    message: "msg",
    cliError: cliCode ? { code: cliCode } : null,
  });

  it("映射后端错误码为中文标题", () => {
    expect(buildFailurePresentation(make("desktop_cli_unavailable")).title).toBe("找不到随应用分发的 vibegal-cli");
    expect(buildFailurePresentation(make("desktop_build_spawn_failed")).title).toBe("无法启动构建进程");
    expect(buildFailurePresentation(make("desktop_build_invalid_output")).title).toBe("构建工具返回了无法解析的结果");
    expect(buildFailurePresentation(make("desktop_build_task_failed")).title).toBe("构建任务异常结束");
  });

  it("CLI 校验失败提示按问题列表修复", () => {
    const p = buildFailurePresentation(make("desktop_build_failed", "validation_failed"));
    expect(p.title).toBe("项目校验未通过");
    expect(p.hint).toContain("问题列表");
  });

  it("Node 缺失引导安装 Node.js", () => {
    const p = buildFailurePresentation(make("desktop_build_failed", "desktop_worker_failed"));
    expect(p.title).toBe("桌面打包失败");
    expect(p.hint).toContain("Node.js");
  });

  it("输出目录与未知错误码的兜底", () => {
    expect(buildFailurePresentation(make("desktop_build_failed", "build_path_error")).title).toBe("输出目录不合法");
    expect(buildFailurePresentation(make("whatever_new_code")).title).toBe("构建失败");
  });
});

describe("groupIssuesBySource", () => {
  it("按 source 分组并保持首次出现顺序", () => {
    const issues = [
      { severity: "error", source: "node", code: "a", message: "1" },
      { severity: "error", source: "asset", code: "b", message: "2" },
      { severity: "warn", source: "node", code: "c", message: "3" },
    ] as ProjectIssue[];

    const groups = groupIssuesBySource(issues);
    expect(groups.map(([source]) => source)).toEqual(["node", "asset"]);
    expect(groups[0][1].map((issue) => issue.code)).toEqual(["a", "c"]);
  });
});

describe("formatElapsedSeconds", () => {
  it("向下取整且不为负", () => {
    expect(formatElapsedSeconds(1000, 4500)).toBe(3);
    expect(formatElapsedSeconds(5000, 1000)).toBe(0);
  });
});

describe("ExportWorkspace 渲染", () => {
  it("默认渲染：运行时卡片、渲染层、默认输出目录与构建按钮", () => {
    const html = renderToStaticMarkup(
      createElement(ExportWorkspace, { project: makeProject(), hasUnsavedChanges: false }),
    );

    expect(html).toContain("导出桌面游戏");
    expect(html).toContain("Electron 兼容模式");
    expect(html).toContain("Tauri 轻量模式");
    expect(html).toContain("/project/dist/desktop-electron");
    expect(html).toContain('value="default"');
    expect(html).toContain("构建桌面游戏");
    expect(html).not.toContain("构建成功");
    expect(html).not.toContain("data-testid=\"build-failure-panel\"");
  });

  it("记住的 tauri 偏好让默认输出目录跟随 runtime", () => {
    stubExportPrefs({ "/project": { runtime: "tauri", customOutDir: "", rendererId: "", strict: false, allowWarnings: false } });

    const html = renderToStaticMarkup(
      createElement(ExportWorkspace, { project: makeProject(), hasUnsavedChanges: false }),
    );

    expect(html).toContain("/project/dist/desktop-tauri");
  });

  it("自定义输出目录不合法时显示错误并禁用构建按钮", () => {
    stubExportPrefs({ "/project": { runtime: "electron", customOutDir: "/project/content/out", rendererId: "", strict: false, allowWarnings: false } });

    const html = renderToStaticMarkup(
      createElement(ExportWorkspace, { project: makeProject(), hasUnsavedChanges: false }),
    );

    expect(html).toContain("输出目录不能位于项目源目录 content/ 内");
    expect(html).toContain("重置为默认");
  });

  it("项目有错误时显示构建前提醒", () => {
    const project = makeProject({
      projectReport: {
        projectIssues: [
          { severity: "error", source: "graph", code: "dangling_edge", message: "边指向不存在的节点" } as ProjectIssue,
        ],
      },
    });

    const html = renderToStaticMarkup(
      createElement(ExportWorkspace, { project, hasUnsavedChanges: false }),
    );

    expect(html).toContain("当前项目有 1 个错误");
  });

  it("有未保存草稿时提示构建只读磁盘文件", () => {
    const html = renderToStaticMarkup(
      createElement(ExportWorkspace, { project: makeProject(), hasUnsavedChanges: true }),
    );

    expect(html).toContain("草稿内容不会包含在产物中");
  });

  it("构建中显示进度态并禁用操作", async () => {
    const project = makeProject({ path: "/project-export-building" });
    let resolveBuild: (value: DesktopBuildResult) => void = () => {};
    const gate = new Promise<DesktopBuildResult>((resolve) => {
      resolveBuild = resolve;
    });
    const pending = startDesktopBuild(project.path, {
      projectPath: project.path,
      outDir: "/project-export-building/dist/desktop-electron",
      runtime: "electron",
    }, () => gate);

    const html = renderToStaticMarkup(
      createElement(ExportWorkspace, { project, hasUnsavedChanges: false }),
    );

    expect(html).toContain("构建中");
    expect(html).toContain("首次 Electron 构建需要下载运行时");

    resolveBuild(successResult);
    await pending;
  });

  it("构建成功后展示产物信息、警告与分发提示", async () => {
    const project = makeProject({ path: "/project-export-success" });
    await startDesktopBuild(project.path, {
      projectPath: project.path,
      outDir: successResult.outDir,
      runtime: "electron",
    }, async () => successResult);

    const html = renderToStaticMarkup(
      createElement(ExportWorkspace, { project, hasUnsavedChanges: false }),
    );

    expect(html).toContain("构建成功");
    expect(html).toContain("/project/dist/desktop-electron");
    expect(html).toContain("Galgame-test.exe");
    expect(html).toContain("desktop.manifest.json");
    expect(html).toContain("复制路径");
    expect(html).toContain("警告（1）");
    expect(html).toContain("资产未被引用");
    expect(html).toContain("签名、公证与安装器属于后续发布环节");
  });

  it("构建失败时展示标题、阶段、问题列表与诊断", async () => {
    const project = makeProject({ path: "/project-export-failure" });
    const failure: DesktopBuildFailure = {
      ok: false,
      code: "desktop_build_failed",
      message: "项目校验未通过",
      cliError: {
        code: "validation_failed",
        message: "项目校验未通过",
        step: "validate",
        file: "content/nodes/intro.json",
        line: 3,
        column: 5,
        issues: [
          { severity: "error", source: "node", code: "missing_field", message: "节点缺少 title 字段" } as ProjectIssue,
        ],
        diagnostics: [
          { severity: "error", message: "渲染层编译失败", file: "renderers/default/index.tsx", line: 10, column: 2 },
        ],
      },
    };
    await startDesktopBuild(project.path, {
      projectPath: project.path,
      outDir: "/project-export-failure/dist/desktop-electron",
      runtime: "electron",
    }, async () => failure);

    const html = renderToStaticMarkup(
      createElement(ExportWorkspace, { project, hasUnsavedChanges: false }),
    );

    expect(html).toContain("项目校验未通过");
    expect(html).toContain("阶段：validate");
    expect(html).toContain("content/nodes/intro.json:3:5");
    expect(html).toContain("节点缺少 title 字段");
    expect(html).toContain("渲染层编译失败");
    expect(html).toContain("renderers/default/index.tsx:10:2");
  });

  it("构建被取消时展示中性提示而非错误面板", async () => {
    const project = makeProject({ path: "/project-export-cancelled" });
    await startDesktopBuild(project.path, {
      projectPath: project.path,
      outDir: "/project-export-cancelled/dist/desktop-electron",
      runtime: "electron",
    }, async () => ({ ok: false, code: "desktop_build_cancelled", message: "桌面构建已取消", cliError: null }));

    const html = renderToStaticMarkup(
      createElement(ExportWorkspace, { project, hasUnsavedChanges: false }),
    );

    expect(html).toContain("build-cancelled-panel");
    expect(html).toContain("构建已取消");
    expect(html).not.toContain("build-failure-panel");
  });

  it("成功面板提供打开目录、运行游戏与冒烟检查入口", async () => {
    const project = makeProject({ path: "/project-export-actions" });
    await startDesktopBuild(project.path, {
      projectPath: project.path,
      outDir: successResult.outDir,
      runtime: "electron",
    }, async () => successResult);

    const html = renderToStaticMarkup(
      createElement(ExportWorkspace, { project, hasUnsavedChanges: false }),
    );

    expect(html).toContain("打开输出目录");
    expect(html).toContain("运行游戏");
    expect(html).toContain("冒烟检查");
  });

  it("冒烟通过后展示中文检查项", async () => {
    const project = makeProject({ path: "/project-export-smoke-pass" });
    await startDesktopBuild(project.path, {
      projectPath: project.path,
      outDir: successResult.outDir,
      runtime: "electron",
    }, async () => successResult);
    await startDesktopSmoke(project.path, { distDir: successResult.outDir, runtime: "electron" }, async () => ({
      ok: true,
      target: "desktop",
      distDir: successResult.outDir,
      basePath: "./",
      runtime: "electron",
      mode: "compatible",
      checks: ["desktopManifest", "desktopBehavior", "saveRoundTrip", "mediaLoad"],
    }));

    const html = renderToStaticMarkup(
      createElement(ExportWorkspace, { project, hasUnsavedChanges: false }),
    );

    expect(html).toContain("冒烟通过");
    expect(html).toContain("桌面清单");
    expect(html).toContain("桌面行为");
    expect(html).toContain("存档读写");
    expect(html).toContain("媒体加载");
  });

  it("冒烟失败时展示错误说明", async () => {
    const project = makeProject({ path: "/project-export-smoke-fail" });
    await startDesktopBuild(project.path, {
      projectPath: project.path,
      outDir: successResult.outDir,
      runtime: "electron",
    }, async () => successResult);
    await startDesktopSmoke(project.path, { distDir: successResult.outDir, runtime: "electron" }, async () => ({
      ok: false,
      code: "desktop_smoke_failed",
      message: "桌面 Player 行为 smoke 未通过",
      cliError: { code: "smoke_desktop_behavior_failed", step: "desktopBehavior" },
    }));

    const html = renderToStaticMarkup(
      createElement(ExportWorkspace, { project, hasUnsavedChanges: false }),
    );

    expect(html).toContain("冒烟未通过");
    expect(html).toContain("桌面 Player 行为 smoke 未通过");
  });
});

describe("preflightBlockReason", () => {
  const readyReport: DesktopBuildPreflight = {
    ok: true,
    cliAvailable: true,
    node: { available: true, version: "v22.1.0", source: "path", path: "/usr/bin/node" },
    electron: { cached: true, version: "43.1.1", overridePath: null },
    tauriPlayer: { available: true, path: "/app/player" },
    exporter: { webWorker: true, desktopWorker: true },
  };

  it("检查中与就绪时不阻塞", () => {
    expect(preflightBlockReason(null, "electron")).toBeNull();
    expect(preflightBlockReason(readyReport, "electron")).toBeNull();
    expect(preflightBlockReason(readyReport, "tauri")).toBeNull();
  });

  it("CLI 缺失、检查失败、Node 缺失、打包组件缺失都阻塞", () => {
    expect(preflightBlockReason({ ok: false, cliAvailable: false }, "electron")).toContain("vibegal-cli");
    expect(preflightBlockReason({ ok: false, cliAvailable: true, error: "boom" }, "electron")).toContain("环境检查失败");
    expect(preflightBlockReason({ ...readyReport, node: { available: false, version: null, source: null, path: null } }, "electron")).toContain("Node.js");
    expect(preflightBlockReason({ ...readyReport, exporter: { webWorker: true, desktopWorker: false } }, "electron")).toContain("打包组件");
  });

  it("Electron 未缓存不阻塞；Tauri Player 缺失只阻塞轻量模式", () => {
    const uncached = { ...readyReport, electron: { cached: false, version: "43.1.1", overridePath: null } };
    expect(preflightBlockReason(uncached, "electron")).toBeNull();

    const noPlayer = { ...readyReport, tauriPlayer: { available: false, path: null } };
    expect(preflightBlockReason(noPlayer, "electron")).toBeNull();
    expect(preflightBlockReason(noPlayer, "tauri")).toContain("轻量模式");
  });
});

describe("构建步骤展示", () => {
  it("buildStepLabel 覆盖三个阶段", () => {
    expect(buildStepLabel("validate")).toBe("校验项目");
    expect(buildStepLabel("web-build")).toBe("构建 Web 产物");
    expect(buildStepLabel("desktop-package")).toBe("打包桌面运行时");
    expect(buildStepLabel("mystery")).toBe("mystery");
  });

  it("buildStepStatus 依据 completedSteps 与当前进度", () => {
    const state = {
      phase: "building",
      buildId: "b1",
      startedAt: 1,
      progress: { step: "web-build", phase: "start", message: "打包中", percent: null },
      completedSteps: ["validate"],
      result: null,
      failure: null,
      smoke: { phase: "idle", checks: [], message: null },
    } as DesktopBuildState;

    expect(buildStepStatus("validate", state)).toBe("done");
    expect(buildStepStatus("web-build", state)).toBe("active");
    expect(buildStepStatus("desktop-package", state)).toBe("pending");
  });

  it("BuildProgressSteps 渲染各阶段状态与当前消息", () => {
    const state = {
      phase: "building",
      buildId: "b1",
      startedAt: 1,
      progress: { step: "desktop-package", phase: "start", message: "正在下载 Electron 运行时", percent: 42 },
      completedSteps: ["validate", "web-build"],
      result: null,
      failure: null,
      smoke: { phase: "idle", checks: [], message: null },
    } as DesktopBuildState;

    const html = renderToStaticMarkup(createElement(BuildProgressSteps, { state }));

    expect(html).toContain("校验项目");
    expect(html).toContain("构建 Web 产物");
    expect(html).toContain("打包桌面运行时");
    expect(html).toContain("正在下载 Electron 运行时");
    expect(html).toContain("42%");
  });
});

describe("smokeCheckLabel", () => {
  it("映射已知检查项并回退原值", () => {
    expect(smokeCheckLabel("desktopManifest")).toBe("桌面清单");
    expect(smokeCheckLabel("saveRoundTrip")).toBe("存档读写");
    expect(smokeCheckLabel("unknown-check")).toBe("unknown-check");
  });
});

describe("PreflightPanel 渲染", () => {
  const readyReport: DesktopBuildPreflight = {
    ok: true,
    cliAvailable: true,
    node: { available: true, version: "v22.1.0", source: "path", path: "/usr/bin/node" },
    electron: { cached: true, version: "43.1.1", overridePath: null },
    tauriPlayer: { available: true, path: "/app/player" },
    exporter: { webWorker: true, desktopWorker: true },
  };

  it("环境就绪时展示各项状态", () => {
    const html = renderToStaticMarkup(
      createElement(PreflightPanel, { report: readyReport, loading: false, onRefresh: () => {} }),
    );

    expect(html).toContain("构建环境");
    expect(html).toContain("v22.1.0");
    expect(html).toContain("已缓存（43.1.1）");
    expect(html).toContain("已随应用分发");
    expect(html).toContain("Web / 桌面打包组件就绪");
  });

  it("CLI 缺失时展示明确错误", () => {
    const html = renderToStaticMarkup(
      createElement(PreflightPanel, { report: { ok: false, cliAvailable: false }, loading: false, onRefresh: () => {} }),
    );

    expect(html).toContain("找不到随应用分发的 vibegal-cli");
  });

  it("Node 缺失与 Electron 未缓存的引导文案", () => {
    const report: DesktopBuildPreflight = {
      ...readyReport,
      node: { available: false, version: null, source: null, path: null },
      electron: { cached: false, version: "43.1.1", overridePath: null },
    };
    const html = renderToStaticMarkup(
      createElement(PreflightPanel, { report, loading: false, onRefresh: () => {} }),
    );

    expect(html).toContain("桌面构建需要安装 Node.js 或配置 VIBEGAL_NODE");
    expect(html).toContain("首次 Electron 构建将自动下载");
  });

  it("加载中展示检查中文案", () => {
    const html = renderToStaticMarkup(
      createElement(PreflightPanel, { report: null, loading: true, onRefresh: () => {} }),
    );

    expect(html).toContain("正在检查构建环境");
  });
});
