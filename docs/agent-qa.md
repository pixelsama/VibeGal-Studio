# Agent QA 管线

这套管线让 Codex、Claude Code 或其他能运行命令行的 Agent 在不使用 Computer Use、鼠标坐标脚本或已登录浏览器会话的前提下，对 VibeGal-Studio 做发布前实际验收。入口、退出码和证据格式均为仓库契约，适合直接移交给另一个 Agent 或接入 CI。

## 快速交接

在仓库根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm qa:agent:desktop
```

先读取命令最后输出的 `summary` 路径。只有 `summary.json` 同时满足以下条件才算通过：

- `kind` 为 `vibegal-agent-qa`
- `schemaVersion` 为 `1`
- `status` 为 `passed`
- `exitCode` 为 `0`
- 每个步骤的 `status` 为 `passed`

这是自动化功能检查的通过条件，不是最终视觉放行。若 `requiredReviews` 非空，测试 Agent 还必须逐张打开其中的截图，检查文字裁切、控件重叠、异常加载态和视觉回归，并把观察结果写进测试报告。

若要做完整发布候选验收，执行 `pnpm qa:agent:release`。失败后可用报告中的步骤 ID 定点复测，例如：

```bash
pnpm qa:agent:desktop -- --only desktop-authoring-loop
pnpm qa:agent:release -- --only browser-behavior
```

定点复测不会隐式重跑被省略的依赖；例如单独重跑 `desktop-authoring-loop` 前，应确认专用 debug 二进制已经由 `desktop-agent-build` 成功构建。查看计划而不执行可使用 `--list` 或 `--dry-run`，自定义证据目录可使用 `--artifacts <dir>`。

桌面 runner 会校验 `desktop-agent-build` 写入的 binary SHA-256 指纹。若先执行普通 `pnpm build` 或其他 Tauri 构建覆盖了 debug binary，runner 会在启动 WebDriver 前直接提示重新执行 `node qa/agent/build-desktop.mjs`，而不会把普通 binary 当作 QA binary 启动。

桌面长链可以按场景独立复测。实现代码可以并行维护，但真实 Tauri 场景必须串行运行，每个场景都有独立临时项目、应用进程和证据目录：

```bash
pnpm qa:agent:desktop -- --scenario project-lifecycle
pnpm qa:agent:desktop -- --scenario core-authoring
pnpm qa:agent:desktop -- --scenario external-collaboration
pnpm qa:agent:desktop -- --scenario asset-workflow
pnpm qa:agent:desktop -- --scenario renderer-appearance
pnpm qa:agent:desktop -- --scenario validation-export
```

场景覆盖项目生命周期、核心脚本创作、外部文件协作、资产引用修复、Renderer/外观持久化，以及验证与 Web/Tauri 导出。`project-lifecycle` 使用 `empty-parent` fixture，并保留用户文件 sentinel；当前 embedded WebDriver 无法操作原生目录选择器，因此初始化阶段通过测试专用 IPC 准备选定目录，之后的打开、关闭和重开仍由真实桌面 UI 完成。

## 套件与覆盖矩阵

| 要求 | 可执行步骤 | 实际边界 | 主要证据 |
| --- | --- | --- | --- |
| 仓库契约无回归 | `repository-contracts` | 单元/集成测试、TypeScript 构建、schema/type/template/doc/version 漂移、Rust 测试 | 步骤日志 |
| 编辑器浏览器行为与规模采样正常 | `browser-behavior` | 无头 Chromium 中的真实 React UI 和受控规模项目；本地不与异构机器基线比较 | `browser/scale.json` |
| 测试能力和设置不泄漏到正式产品 | `agent-qa-isolation` | 正式前端构建扫描、默认 Cargo 依赖树扫描、独立应用 identifier | 步骤日志 |
| 专用桌面测试程序可复现 | `desktop-agent-build` | `agent-qa` Cargo feature + 专用 QA 前端，debug、无 bundle | `desktop/build.json`（路径、大小、SHA-256） |
| 核心创作循环真实可用 | `desktop-authoring-loop` | 真实 Tauri/WebView、真实 Rust 后端、隔离项目副本、真实文件系统 watcher | JUnit、场景 NDJSON、前后文件快照、四张阶段截图、步骤日志 |
| CLI 正反例与导出 smoke 正常 | `release-smoke` | clean/broken 项目、Web/桌面导出契约 | 步骤日志 |
| 当前平台能构建发布包 | `platform-bundle` | macOS app + DMG、Windows NSIS；其他平台使用默认 bundle | 步骤日志、Tauri bundle 目录 |

套件映射：

- `quick`：`repository-contracts` + `browser-behavior`
- `desktop`：隔离门禁 + 专用构建 + 真实桌面创作循环
- `package`：release smoke + 当前平台 bundle
- `release`：以上全部步骤

## 真实桌面场景

`desktop-authoring-loop` 不连接生产项目。它把 `examples/sample-novel` 复制到系统临时目录中的 `Project With Spaces`，然后由 WebDriver 连接专用 Tauri 二进制并执行：

1. 从最近项目列表打开隔离项目，必要时确认可信 renderer。
2. 依次进入剧本、资源、外观、导出和项目工作区。
3. 在项目设置中修改作品标题并保存，直接读取磁盘文件确认 Rust 后端已落盘。
4. 刷新整个 WebView、重新打开项目，确认标题持久化。
5. 在应用外原子替换 `content/meta.json`，等待原生 watcher 触发并确认 UI 热重载。
6. 截取项目已打开、工作区已导航、保存完成、外部热重载四个阶段。

默认会删除临时项目。排查失败时设置 `VIBEGAL_AGENT_QA_KEEP_FIXTURE=1` 可保留它；设置 `VIBEGAL_AGENT_QA_LOG_LEVEL=info` 可临时打开底层协议日志。正常运行默认使用 `warn`，避免 WebDriver 协议细节淹没测试结论。

当前固定的 `@wdio/tauri-service` 1.1 在 embedded provider 已成功启动时，仍可能打印一次找不到外部 `tauri-driver` 的诊断，并在会话关闭后打印 mock/window 清理 warning。这两类上游生命周期噪声不会改变场景、JUnit 或 Runner 的退出码，也不表示管线依赖外部 driver；不要因此安装 `tauri-driver`。若场景没有进入 `RUNNING`/`PASSED` 或摘要不是 `passed`，才按真实失败处理。1.2 版本目前存在已发布包导出不兼容，升级前必须先跑完整 desktop 套件。

每个 phase 默认动态申请独立的本地 WebDriver 端口，并同时设置 `VIBEGAL_AGENT_QA_WEBDRIVER_PORT` 与 `TAURI_WEBDRIVER_PORT`。后者是 DirectEval 客户端读取的变量；两者必须一致，否则 `browser.tauri.execute()` 可能连接到默认端口上的残留 Tauri 进程。启动后 runner 还会验证 `window.__TAURI__.core.invoke`、原始 core、`window.wdioTauri` 以及 `plugin:wdio|get_active_window_label` 握手。

## 证据和退出码

每次运行写入 `artifacts/agent-qa/<UTC-run-id>/`：

```text
summary.json
report.html
logs/
  <step-id>.log
desktop/
  build.json
  scenarios.ndjson
  project-before-after.json
  junit/agent-qa.xml
  screenshots/*.png
  scenarios/<scenario-id>/
    phases.json
    project-before-after.json
    desktop/junit/
    desktop/screenshots/
browser/
  scale.json
```

退出码 `0` 表示自动化步骤全部通过，`1` 表示至少一个步骤失败或超时，`2` 表示计划不完整（例如 dry-run 或依赖被跳过）。Runner 会持续改写摘要和 HTML，所以即使后续步骤失败，已经完成的证据也可读取。带截图的报告会写入 `requiredReviews` 并在 HTML 顶部显示视觉复核提示；自动化 `status: passed` 不会掩盖这项 Agent 责任。写入 artifact 的日志会遮蔽已知发布凭据环境变量和 PEM 私钥。

## 安全与生产隔离

桌面自动化使用官方 Tauri WebDriver 插件的 embedded provider，不要求系统安装 ChromeDriver、EdgeDriver、SafariDriver，也不调用任何 GUI 自动化工具。它通过三个共同成立的条件启用：

- Cargo 显式传入非默认 `agent-qa` feature；
- Tauri 合并 `src-tauri/tauri.agent-qa.conf.json`，只给专用构建开放 WDIO capability；
- QA 构建使用 `com.vibegal.studio.agent-qa`，不会读取或写入正式应用的设置目录；
- 前端构建脚本设置 `VITE_AGENT_QA=1`，才动态加载浏览器侧插件。

`pnpm check:agent-qa-isolation` 会构建并扫描正式前端，同时检查不带 feature 的 Cargo 依赖树。任何 WDIO 运行时代码进入默认产品都会使门禁失败。不要把 `agent-qa` feature 或专用 config 加到 `pnpm bundle*` 命令中。

## CI 和平台责任

普通 CI 的 `Agent QA real desktop` job 在 macOS 和 Windows 上并行运行 `desktop` 套件，并在成功或失败时上传完整证据。既有 `scale-benchmark` job 在固定 Ubuntu/x64 runner class 上执行 20% 内存回归基线门禁；本地 Agent 只做真实浏览器行为和规模采样，避免把异构 CPU/操作系统差异误报成回归。`desktop-bundle` 与 `installed-cli-smoke` jobs 继续负责真实安装包、无源码/受限 PATH 下的 bundled CLI、Web 导出和 Tauri 桌面导出 smoke。这些结果共同覆盖浏览器规模、创作应用实际操作和安装后发布载荷三条边界。

本地 `release` 套件只构建当前主机平台的安装包；它不能替代另一操作系统的 CI 结果。签名、公证、Gatekeeper 和 Authenticode 仍依赖受保护凭据与发布 workflow，不能由无凭据的本地 Agent 宣称完成。

## 给测试 Agent 的最小任务说明

可以直接把下面内容交给另一位 Agent：

> 在仓库根目录运行 `pnpm install --frozen-lockfile` 和 `pnpm qa:agent:desktop`。读取输出指向的 `summary.json`、`report.html`、JUnit、截图与失败步骤日志；逐张审查 `requiredReviews` 指向的截图，不要使用 Computer Use，不要修改真实用户项目。若失败，先报告具体步骤、退出码、错误和证据路径，再仅修复确认属于产品或测试管线的问题并定点复测。发布候选还需运行 `pnpm qa:agent:release`，并结合 macOS/Windows CI 的 Agent QA、desktop-bundle、installed-cli-smoke 结果给出结论。
