# GalStudio 发布清单

用于 PR/发布前的人工核对与自动化验收记录。日期记录格式建议 `YYYY-MM-DD HH:mm`。

## 版本与合规
- [ ] 代码已通过 `pnpm test`
- [ ] 代码已通过 `cargo test`（`packages/studio/src-tauri`）
- [ ] 代码已通过 `pnpm build`
- [ ] 代码已通过 `cargo build`（`packages/studio/src-tauri`）
- [ ] `pnpm run check:versions` 成功
- [ ] `pnpm run check:schemas` 成功（schema 无漂移）
- [ ] `git status --short` 干净（除本次更改外）

## 核心验收场景
- [ ] `pnpm smoke:release` 成功（clean sample exit 0，broken samples exit 非零）
- [ ] CLI：
  - [ ] `galstudio-cli validate examples/sample-novel --format json` 出口码 0
  - [ ] `galstudio-cli validate examples/broken-projects/dangling-edge --format json` 出口码 非 0
  - [ ] `galstudio-cli validate examples/broken-projects/missing-node-file --format json` 出口码 2
- [ ] 打开 `examples/sample-novel`，主工作区可切换 Render / Script / Assets
- [ ] 记录一次热重载/外部改文件验收（有脚本：`docs/script-graph/14-release-readiness.spec.md` 的 Smoke 模板）

## 包体与发布策略
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
