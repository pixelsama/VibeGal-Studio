# VibeGal-Studio 发布清单

用于 PR/发布前的人工核对与自动化验收记录。日期记录格式建议 `YYYY-MM-DD HH:mm`。

## 版本与合规
- [ ] 代码已通过 `pnpm test`
- [ ] 代码已通过 `cargo test --locked`（`packages/studio/src-tauri`，包含 integration tests）
- [ ] 代码已通过 `pnpm build`
- [ ] 代码已通过 `cargo build`（`packages/studio/src-tauri`）
- [ ] `pnpm run check:versions` 成功
- [ ] `pnpm run check:schemas` 成功（schema 无漂移）
- [ ] `pnpm run check:engine-types` 成功（engine 类型无漂移）
- [ ] `pnpm run check:renderer-template` 成功（default/classic 界面风格的 canonical 与镜像无漂移）
- [ ] `pnpm run check:example-template` 成功（示例项目模板镜像无漂移）
- [ ] `pnpm run check:doc-contract` 与 `pnpm run check:vocabulary` 成功
- [ ] Rust `1.88.0` 下 `cargo check --locked --all-targets` 成功
- [ ] `cargo fetch --locked` 后，`CARGO_NET_OFFLINE=true cargo test --locked` 成功
- [ ] `git status --short` 干净（除本次更改外）

## 核心验收场景
- [ ] `pnpm smoke:release` 成功（clean sample exit 0，broken samples exit 非零）
- [ ] CLI：
  - [ ] `vibegal-cli validate examples/sample-novel --format json` 出口码 0
  - [ ] `vibegal-cli validate examples/broken-projects/dangling-edge --format json` 出口码 非 0
  - [ ] `vibegal-cli validate examples/broken-projects/missing-node-file --format json` 出口码 2
  - [ ] 安装包内 CLI 在无源码 checkout、无 Node 的 PATH、含空格项目路径下 validate 成功
  - [ ] 安装包内 CLI 使用 packaged exporter 完成 Web build 与 browser smoke
  - [ ] `vibegal-cli build examples/sample-novel --target desktop --runtime electron --out <dir> --format json` 产出兼容模式目录
  - [ ] `vibegal-cli build examples/sample-novel --target desktop --runtime tauri --out <dir> --format json` 产出轻量模式目录
  - [ ] 两种桌面模式的 `desktop.manifest.json` 指向内容等价的 Web payload
- [ ] 打开 `examples/sample-novel`，主工作区可切换 Render / Script / Assets
- [ ] 记录一次热重载/外部改文件验收（有脚本：`docs/script-graph/14-release-readiness.spec.md` 的 Smoke 模板）

## 签名、公证与更新安全
- [ ] 普通 PR/CI 未要求签名凭据；无凭据演练在 manifest 中明确记录 `unsigned-dry-run`
- [ ] protected secrets 完整性已核对，源码、日志和 artifact 不含证书、私钥、密码、Apple team/issuer 凭据
- [ ] macOS app 在 DMG 生成前完成 codesign，DMG 已完成 codesign、notarytool、staple 与 Gatekeeper 验证
- [ ] 重新挂载 DMG 后，其中 `.app` 的 codesign 与 Gatekeeper 验证仍成功
- [ ] Windows 安装包已完成 Authenticode timestamp、`signtool verify /pa /all`
- [ ] `SHA256SUMS.txt` 与 `release-manifest.json` 覆盖全部发布 artifact，版本、平台、架构、URL、hash 与签名状态正确
- [ ] updater 无 endpoint/public key 时保持关闭；启用时 endpoint 为 HTTPS 且两项同时存在
- [ ] `update-manifest.json` 已使用 protected Ed25519 key 签名，可信 public key 验签成功
- [ ] mock updater 接受更高版本，拒绝同版本/降级、HTTP URL、篡改 hash 和非可信签名
- [ ] 下载后 SHA-256 不符、manifest 验签失败或安装失败时保留当前安装，并可安全重试
- [ ] 更新源保留当前与上一已验证版本；错误 manifest 的撤回/恢复和不可变 tag 重试步骤已演练
- [ ] 真实 Apple notarization 与 Windows 证书链的外部验收证据已归档；无凭据时没有把 dry-run 描述为完成

## 包体与发布策略
- [ ] macOS `.app`/安装包与 Windows NSIS bundle 均构建成功
- [ ] macOS/Windows 安装后 CLI smoke 的 CI artifact/job 均成功
- [ ] Vite 主 chunk 警告已处理或记录：
  - 处理：`packages/studio/vite.config.ts` 的分包策略使主 chunk 无警告
  - 或接受：在发布注记里写明原因（历史构建结果、目标性能阈值）
- [ ] 文档已更新：
  - `docs/release-checklist.md`
  - `docs/packaging.md`
  - `docs/script-graph/14-release-readiness.spec.md`
- [ ] 版本号和签名状态已更新记录（签名密钥不入仓库）

## 最终确认
- [ ] release 阶段模板已执行并留存链接/截图（至少一条）
