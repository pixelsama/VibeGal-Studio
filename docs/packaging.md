# 打包与发布说明

本阶段不引入真实签名密钥，先跑本地未签名包用于回归与归档验证。

## 安装前提
- Node.js + pnpm
- Rust 1.85+ 与 Cargo
- macOS 打包时（若需要）：对应 Xcode Command Line Tools
- Windows 打包时：Windows 10+（需 WebView2 运行时，Windows 11 自带）+ Rust MSVC 工具链

## Windows 平台说明
- `pnpm bundle` 在 Windows 产出 NSIS 安装包（`packages/studio/src-tauri/target/release/bundle/nsis/`）。
- Windows 保留原生标题栏（`titleBarStyle: Overlay` 仅 macOS 生效），前端按平台做红绿灯避让。
- 应用内「一键安装命令行工具」依赖 symlink，仅 macOS/Linux 提供；Windows 请在 设置 → 命令行工具 中复制随附的 `vibegal-cli.exe` 路径，把它所在目录手动加入 PATH 后使用。
- symlink 相关的安全测试用例标注 `#[cfg(unix)]`，Windows 下运行 `cargo test` 时自动跳过。

## 常用命令（本地）
- 安装依赖：`pnpm install`
- 生成 workspace 产物：`pnpm build`
- 导出 schema 并校验漂移：`pnpm run check:schemas`
- 版本一致性校验：`pnpm run check:versions`
- 发布前 smoke：`pnpm smoke:release`
- 打包（未签名）：
  - 当前平台自动选择：`pnpm bundle`
  - Windows NSIS：`pnpm bundle:windows`
  - macOS app + DMG：`pnpm bundle:macos`
- 产物目录（默认）：
  - `packages/studio/src-tauri/target/release/bundle/`

## Contracts 与 CLI 发布门槛
- exact MSRV：`cargo +1.85.0 check --locked --all-targets --manifest-path packages/studio/src-tauri/Cargo.toml`
- 离线 Cargo：先 `cargo fetch --locked`，再运行 `CARGO_NET_OFFLINE=true cargo test --locked --manifest-path packages/studio/src-tauri/Cargo.toml`
- `validate` 必须能从任意 cwd、无 Node 的 PATH 和无源码 checkout 环境运行。
- Windows 上 `pnpm smoke:release` 检测到已安装的 MSVC Rust 工具链（`*-pc-windows-msvc`）时会自动通过 `RUSTUP_TOOLCHAIN` 切换；这避开了默认 windows-gnu 工具链缺 `dlltool.exe` 时依赖编译失败的问题。未安装 MSVC 工具链的环境保持默认行为。
- 安装包内 CLI 的 Web `build` / `smoke` 必须使用 bundled exporter；当前 build 仍要求系统 Node 或 `VIBEGAL_NODE`。
- 桌面游戏构建同时提供两种后端目标：默认 `--runtime electron`（兼容模式，固定 Chromium）与可选 `--runtime tauri`（轻量模式，系统 WebView）；两者必须复用同一份 Web 产物。
- 构建前可运行 `vibegal-cli doctor --format json` 检查 Node、Electron 缓存、Tauri Player 与两个 exporter worker；该命令始终以 0 退出，缺失项通过 JSON 字段表达。
- 供应用后端消费的流式构建使用 `--format json --progress jsonl`：stdout 逐行输出 `validate`、`web-build`、`desktop-package` 的 start/done 事件，最后一行是原构建结果。不传 `--progress` 时保持原输出契约。
- Studio 后端通过 `desktop_build_progress` 事件转发构建进度，并以调用方提供的 `buildId` 支持 `cancel_desktop_game_build`；CLI 错误仍写入 stderr 并保持非零退出码。
- Electron 固定运行时首次构建时按需下载并校验，之后复用 VibeGal 本地缓存；Tauri 轻量 Player 随 Studio 预编译分发，单个游戏不得再次编译 Rust。
- 桌面产物当前是可直接运行并可自行压缩分发的 portable 目录；签名、公证和商店安装器仍属于独立发布阶段。
- `smoke_desktop_game` 会真实启动所选 Player 执行行为检查，最长等待 30 秒；`run_desktop_game` 启动后立即放手，`reveal_path` 只负责在系统文件管理器中显示产物。
- `renderer-check`（真实编译/类型检查）与 `renderer-snapshot`（无头截图）同样走 bundled exporter 里的 node worker（`build-web-export.mjs` / `renderer-snapshot.mjs` + 共享模块 `renderer-worker-shared.mjs`），新增 exporter 侧脚本必须同步 `packages/studio/scripts/prepare-web-exporter.mjs` 的拷贝清单。
- CI 在 macOS/Windows bundle 后把安装物复制到独立、无 checkout 的 job，并使用含空格路径完成 validate/build/browser smoke。

## macOS 签名与公证（后续）
1. 准备 Apple Developer 账号与证书。
2. 在 `packages/studio/src-tauri/tauri.conf.json` 配置签名密钥与安装器。
3. 在 CI 引入 Notarize 阶段（暂不在本 spec 中执行，避免泄露凭据）。

## 回滚与审计
- 若版本号/签名信息调整，先运行：
  - `pnpm run check:versions`
  - `pnpm run check:schemas`
  - `pnpm smoke:release`
- 将 CI/本地命令输出归档到 release notes 或 checklist。
