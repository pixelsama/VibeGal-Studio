# 打包与发布说明

发布流水线同时支持无凭据演练和受保护凭据签名。普通 PR/CI 与本地命令保持未签名；只有 tag/release job 在凭据完整时执行真实签名，并把缺失凭据明确记录为 `unsigned-dry-run`，不能据此声称签名或公证完成。

## 安装前提
- Node.js + pnpm
- Rust 1.88+ 与 Cargo
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
- 发布元数据与校验：
  - 生成 checksum、release manifest 与 unsigned update manifest：`pnpm release:manifest -- <release-assets-dir>`
  - 使用受保护 Ed25519 私钥签 update manifest：`pnpm release:sign-update -- <update-manifest.json>`
  - 使用作品内配置的可信公钥验签：`pnpm release:verify-update -- <update-manifest.json> <current-version> <public-key.pem>`
- 打包（本地未签名演练）：
  - 当前平台自动选择：`pnpm bundle`
  - Windows NSIS：`pnpm bundle:windows`
  - macOS app + DMG：`pnpm bundle:macos`
- 产物目录（默认）：
  - `packages/studio/src-tauri/target/release/bundle/`

## Contracts 与 CLI 发布门槛
- exact MSRV：`cargo +1.88.0 check --locked --all-targets --manifest-path packages/studio/src-tauri/Cargo.toml`
- 离线 Cargo：先 `cargo fetch --locked`，再运行 `CARGO_NET_OFFLINE=true cargo test --locked --manifest-path packages/studio/src-tauri/Cargo.toml`
- `validate` 必须能从任意 cwd、无 Node 的 PATH 和无源码 checkout 环境运行。
- Windows 上 `pnpm smoke:release` 检测到已安装的 MSVC Rust 工具链（`*-pc-windows-msvc`）时会自动通过 `RUSTUP_TOOLCHAIN` 切换；这避开了默认 windows-gnu 工具链缺 `dlltool.exe` 时依赖编译失败的问题。未安装 MSVC 工具链的环境保持默认行为。
- 安装包内 CLI 的 Web `build` / `smoke` 必须使用 bundled exporter；当前 build 仍要求系统 Node 或 `VIBEGAL_NODE`。
- 桌面游戏构建同时提供两种后端目标：默认 `--runtime electron`（兼容模式，固定 Chromium）与可选 `--runtime tauri`（轻量模式，系统 WebView）；两者必须复用同一份 Web 产物。
- 构建前可运行 `vibegal-cli doctor --format json` 检查 Node、Electron 缓存、Tauri Player 与两个 exporter worker；该命令始终以 0 退出，缺失项通过 JSON 字段表达。
- 供应用后端消费的流式构建使用 `--format json --progress jsonl`：stdout 逐行输出 `validate`、`web-build`、`desktop-package` 的 start/done 事件，最后一行是原构建结果。不传 `--progress` 时保持原输出契约。
- Studio 后端通过 `desktop_build_progress` 事件转发构建进度，并以调用方提供的 `buildId` 支持 `cancel_desktop_game_build`；CLI 错误仍写入 stderr 并保持非零退出码。
- Electron 固定运行时首次构建时按需下载并校验，之后复用 VibeGal 本地缓存；Tauri 轻量 Player 随 Studio 预编译分发，单个游戏不得再次编译 Rust。
- 桌面游戏 portable 目录会继承项目自己的标题、版本、viewport 和派生图标；Studio 安装包的签名、公证则由仓库 release workflow 单独处理。
- `smoke_desktop_game` 会真实启动所选 Player 执行行为检查，最长等待 30 秒；`run_desktop_game` 启动后立即放手，`reveal_path` 只负责在系统文件管理器中显示产物。
- `renderer-check`（真实编译/类型检查）与 `renderer-snapshot`（无头截图）同样走 bundled exporter 里的 node worker（`build-web-export.mjs` / `renderer-snapshot.mjs` + 共享模块 `renderer-worker-shared.mjs`），新增 exporter 侧脚本必须同步 `packages/studio/scripts/prepare-web-exporter.mjs` 的拷贝清单。
- CI 在 macOS/Windows bundle 后把安装物复制到独立、无 checkout 的 job，并使用含空格路径完成 validate/build/browser smoke。

## 发布凭据与安全边界

真实凭据只能进入 GitHub Environment/Repository protected secrets 或发布者本机 keychain，禁止写入源码、workflow 常量、artifact 或日志。流水线使用以下 secret contract：

- macOS 应用与 DMG：`APPLE_CERTIFICATE_BASE64`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY`；
- Apple 公证：`APPLE_NOTARY_KEY_BASE64`、`APPLE_NOTARY_KEY_ID`、`APPLE_NOTARY_ISSUER_ID`；
- Windows Authenticode：`WINDOWS_CERTIFICATE_BASE64`、`WINDOWS_CERTIFICATE_PASSWORD`；
- 更新 manifest Ed25519 签名：`VIBEGAL_UPDATER_SIGNING_KEY`，加密私钥可另提供 `VIBEGAL_UPDATER_SIGNING_KEY_PASSWORD`。

每个平台只有在对应凭据完整时才进入 signed 状态。tag push workflow 会先生成 app，再 codesign app，然后从已签名 app 生成 DMG，最后签名、公证、staple 并重新挂载验证；Windows 安装包由 `signtool` 签名并以 `/pa /all` 验证。`workflow_dispatch` 用于同一不可变 tag 的可重复演练：缺少凭据时仍完成构建、安装 smoke、checksum 和 manifest，并上传明确标记的 dry-run manifest artifact，但不会创建 GitHub Release；tag push 发布步骤缺少任何发布签名凭据时会失败关闭，避免公开未签名产物。

本地 keychain 可以作为人工签名的凭据来源，但仓库脚本不读取或导出个人身份；私钥不得通过命令参数传递。临时证书文件和临时 keychain 必须在 job 内删除。真实 Apple notarization 与 Windows 证书信任链验证依赖外部账号和证书，必须在发布记录中作为人工验收留证；没有这些凭据时只能报告 `unsigned-dry-run`。

## 自动更新安全模型

- 项目不提供 `distribution.updates.endpoint` 和 `publicKey` 时 updater 保持关闭；两者必须同时存在，endpoint 必须是 HTTPS。
- 自动更新客户端随 Electron 兼容模式导出：启动时在后台验签、下载并校验 SHA-256，只把完整包原子暂存到应用数据目录；玩家确认后才交给操作系统打开安装包并退出当前版本。下载、验签、hash 或启动安装器失败都不会修改当前安装，下次启动可安全重试。轻量 Tauri player 不内嵌 Node 更新客户端，因此启用 updater 的项目若选择 Tauri 会明确构建失败，需改用 Electron，而不是产出一个静默忽略更新配置的包。
- `release-assets/update-manifest.json` 包含版本、频道、发布时间，以及各平台 artifact 的 HTTPS URL 与 SHA-256。签名使用稳定键序 canonical JSON，避免生成器属性顺序影响验签。
- 客户端只接受可信 Ed25519 公钥签名、HTTPS 下载地址且版本严格高于当前作品版本的 manifest；校验失败、同版本或降级都不会替换当前安装。
- 下载完成后仍必须先比对 manifest 中 SHA-256，再进入平台安装/替换流程；下载、hash 或签名失败时保留当前版本并允许重新获取 manifest 后安全重试。
- `release-manifest.json` 的 `signing.macos`、`signing.windows`、`signing.updater` 记录 `signed`、`signed-notarized` 或 `unsigned-dry-run`，便于审计，不能把 dry-run 当作真实发布。
- 更新源至少保留当前稳定版本和上一个已验证版本。发布出错时停止提供错误 manifest、恢复上一份已签名 manifest；不得用更低版本号绕过客户端的防降级检查。

## 回滚与审计
- tag 构建失败时修复源码并创建新版本 tag；不要移动、覆盖或重写已有公开 tag。`workflow_dispatch` 的 `release_tag` 只用于重试同一不可变 tag 的构建。
- updater 发布错误时先撤下错误的 manifest，恢复上一份已验证且已签名的 manifest 与产物；客户端不会接受降级版本，后续修复应使用更高 semver。
- `SHA256SUMS.txt`、`release-manifest.json`、`update-manifest.json`、notary request 结果和 Authenticode 验证输出应随 release 记录归档。私钥、证书原文、密码和临时 keychain 不得归档。
- 若版本号/签名信息调整，先运行：
  - `pnpm run check:versions`
  - `pnpm run check:schemas`
  - `pnpm smoke:release`
- 将 CI/本地命令输出归档到 release notes 或 checklist。
