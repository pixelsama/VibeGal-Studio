# VibeGal-Studio

![VibeGal-Studio icon](packages/studio/src-tauri/icons/128x128.png)

VibeGal-Studio 是一个 graph-first 的 Galgame 项目编辑器和实时预览工具。剧情、资源与渲染层都保存在普通项目文件中，不锁进私有数据库；Studio 负责可视化编辑、校验、热重载、预览和导出。

> 当前状态：`0.1.0-alpha.1`。核心创作链路已经可用，但安装包暂未签名，仍建议先备份重要项目并阅读[已知限制](#已知限制)。

## 下载

从 [GitHub Releases](https://github.com/pixelsama/VibeGal-Studio/releases) 下载最新版本：

- Windows 10/11 x64：`VibeGal-Studio_*_x64-setup.exe`
- macOS Apple Silicon：`VibeGal-Studio_*.dmg`
- `SHA256SUMS.txt`：安装前校验下载文件完整性

当前 alpha 安装包尚未进行 Windows Authenticode 签名或 Apple notarization，因此系统可能显示未知发布者提示。只应从本仓库 Releases 页面下载。Linux 桌面安装包尚未作为公开发布目标。

## 快速开始

1. 安装并启动 VibeGal-Studio。
2. 选择“新建项目”，先选父目录，再输入项目文件夹名称。
3. 在“剧本”中编辑剧情图和节点，在“资源”中导入素材，在“预览”和“外观”中检查呈现效果。
4. 在“导出”中构建 Web 游戏或桌面游戏。

打开已有项目时，请选择包含 `gal.project.json` 的项目根目录。如果误选了同时包含多个项目的上级目录，Studio 会列出其中的直接子项目供选择，不会直接诱导你把父目录初始化成嵌套项目。

项目 renderer 是会执行的 TSX 代码。Studio 会在首次预览时要求明确授权；只对你信任来源的项目选择“信任并运行”。

## 项目结构

```text
my-game/
  gal.project.json
  AGENTS.md
  .galstudio/
    README.md
    schemas/
  content/
    graph.json
    nodes/
    assets/
    fixtures/
  renderers/
    default/
      index.tsx
```

- `content/graph.json` 与 `content/nodes/*.json` 是剧情的唯一来源。
- `content/variables.json` 声明 run/global 变量；正式结局由 manifest registry + `completeEnding` 结算，图终点不自动等于正式结局。
- `renderers/<id>/index.tsx` 定义玩家界面和呈现方式。
- `.galstudio/` 为外部工具提供 schema 与项目契约说明。
- 外部编辑器或 Agent 修改文件后，Studio 会通过原生文件监听自动刷新。

完整数据说明见 [项目 Wiki](docs/project-wiki.md)，renderer API 见 [Renderer Contract](docs/renderer-contract.md)。

## 导出要求

Web 导出与桌面导出当前需要系统可用的 Node.js 22，或通过 `VIBEGAL_NODE` 指定 Node 可执行文件。

- Web：输出可部署的静态目录。
- Electron 桌面：固定 Chromium，兼容性更稳定，首次构建可能下载运行时。
- Tauri 桌面：体积较小，依赖目标系统 WebView。

Studio 的“导出”页面会先运行环境检查，并提供构建、取消、启动和 smoke 验证入口。

## 命令行工具

安装包附带 `vibegal-cli`。Windows 用户可在“设置 → 命令行工具”复制 CLI 路径并手动加入 `PATH`；macOS/Linux 开发环境可以使用设置页提供的安装入口。

```bash
vibegal-cli validate <project-path> --format json
vibegal-cli instruction-ids assign <project-path> --format json
vibegal-cli node insert <project-path> <node-id> --after <story-point-id> --file <instruction.json> --format json
vibegal-cli node update <project-path> <node-id> <story-point-id> --patch-file <patch.json> --format json
vibegal-cli node move <project-path> <node-id> <story-point-id> --before <story-point-id> --format json
vibegal-cli node duplicate <project-path> <node-id> <story-point-id> --format json
vibegal-cli node delete <project-path> <node-id> <story-point-id> --format json
vibegal-cli renderer-check <project-path> --renderer default --format json
vibegal-cli renderer-snapshot <project-path> --renderer default --out snapshots
vibegal-cli build <project-path> --target web --out dist-game --format json
vibegal-cli smoke dist-game --target web --format json
vibegal-cli build <project-path> --target desktop --runtime electron --out dist-desktop --format json
vibegal-cli smoke dist-desktop --target desktop --runtime electron --format json
vibegal-cli build <project-path> --target desktop --runtime tauri --out dist-light --format json
vibegal-cli smoke dist-light --target desktop --runtime tauri --format json
```

CLI 使用稳定退出码和机器可读 JSON，适合 Codex、Claude Code 等外部 Agent 直接检查、修复并重新验证项目。VibeGal-Studio 本身不包含内置 AI。

## 从源码运行

需要 Node.js 22、pnpm 11、Rust 1.88 或更新版本，以及当前平台的 Tauri 系统依赖。

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm tauri dev
```

常用质量门禁：

```bash
pnpm test
pnpm build
pnpm check:schemas
pnpm check:engine-types
pnpm check:renderer-template
pnpm check:doc-contract
pnpm smoke:release
```

可重复平台打包：

```bash
# 当前平台自动选择目标：Windows NSIS；macOS app + DMG
pnpm bundle

# 显式平台命令
pnpm bundle:windows
pnpm bundle:macos
```

`v*` tag 会触发 Release workflow。流水线校验 tag 与源码版本一致，构建 Windows/macOS 安装包，在独立路径执行安装后 CLI、Web 导出与 Tauri 桌面导出 smoke，最后发布安装包和 SHA-256 校验文件。

## 已知限制

- alpha 安装包尚未签名或公证。
- macOS 公开构建当前只覆盖 Apple Silicon。
- 项目 renderer 在 Studio 主 WebView 中执行，不是强隔离沙箱；不要打开不可信项目。
- Electron 桌面导出首次运行可能需要联网下载固定运行时。
- 图级完整 undo/redo 仍在后续规划中；保存前建议使用 Git 或其他备份工具。

问题反馈请使用 [GitHub Issues](https://github.com/pixelsama/VibeGal-Studio/issues)。安全问题请不要附带私密项目素材或凭据；正式的私密漏洞报告渠道将在稳定版前补充。

## 开源许可

VibeGal-Studio 使用 GNU Affero General Public License v3.0 or later，详见 [LICENSE](LICENSE)。
