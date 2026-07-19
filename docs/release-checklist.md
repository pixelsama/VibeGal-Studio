# VibeGal-Studio 发布清单

用于 PR/发布前的人工核对与自动化验收记录。日期记录格式建议 `YYYY-MM-DD HH:mm`。

## 版本与合规
- [ ] 代码已通过 `pnpm test`
- [ ] 代码已通过 `cargo test --locked`（`packages/studio/src-tauri`，包含 integration tests）
- [ ] 代码已通过 `pnpm build`
- [ ] 代码已通过 `cargo build`（`packages/studio/src-tauri`）
- [ ] `pnpm run check:versions` 成功
- [ ] `pnpm run check:schemas` 成功（schema 无漂移）
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
- [ ] 版本号和签名信息已更新记录（签名密钥不入仓库）

## 最终确认
- [ ] release 阶段模板已执行并留存链接/截图（至少一条）
