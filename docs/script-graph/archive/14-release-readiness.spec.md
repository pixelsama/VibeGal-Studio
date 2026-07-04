# Spec 14 — 发布级保障与归档流程

> 状态：已归档。
> 目标：把 GalStudio 从开发态推进到可发布、可回归、可归档的桌面应用工程。
> 说明：验收命令见“3.1 必跑”；若某些基础命令受现有并行改动影响失败，需在 release checklist 记录为既有阻塞并给出修复工单。

## 1. 需求与范围

发布级保障覆盖：

- CI 自动验证核心测试/构建。
- 版本一致性与 schema 漂移检查。
- 可靠的 CLI 验证路径（clean / broken 示例）。
- 发布清单与打包文档。
- 示例项目符合 graph-first 契约。
- 记录至少一个 smoke/e2e 或清晰人工验收模板（本期先交付 CLI smoke + 手工 UI 模板）。

## 2. 已完成改动

- 新增 `.github/workflows/ci.yml`。
- 新增脚本：
  - `scripts/check-version-consistency.mjs`
  - `scripts/check-schema-drift.mjs`
  - `scripts/release-smoke.mjs`
- 新增/更新文档：
  - `docs/release-checklist.md`
  - `docs/packaging.md`
- 新增 broken sample：
  - `examples/broken-projects/missing-node-file`
  - `examples/broken-projects/dangling-edge`
- 更新 `examples/sample-novel`：
  - 仍为 graph-first
  - 增加第二个节点与一条 edge
  - 保留背景、双表情、BGM/SFX
- `packages/studio/vite.config.ts` 增加基础分包策略，降低主 chunk 警告影响。
- `packages/studio/src-tauri/Cargo.toml` / `packages/studio/src-tauri/tauri.conf.json` 与顶层版本统一为 `0.0.0`。
- 根 `package.json` 增加发布检查/Smoke 脚本：
  - `check:versions`
  - `check:schemas`
  - `smoke:release`

## 3. 验证矩阵

### 3.1 必跑

| 层级 | 命令 | 目的 |
| --- | --- | --- |
| Engine unit | `pnpm --filter @galstudio/engine test` | schema / interpreter / validate |
| Studio unit | `pnpm --filter @galstudio/studio test` | 前端逻辑与 UI |
| Rust unit | `cargo test`（`packages/studio/src-tauri`） | 文件系统、校验、CLI |
| Web build | `pnpm --filter @galstudio/studio build` | Vite + TS 构建 |
| Rust build | `cargo build`（`packages/studio/src-tauri`） | Tauri backend + CLI |
| 发布前自检 | `pnpm run check:versions` | 版本一致性 |
| Schema 漂移 | `pnpm run check:schemas` | schema 快照一致性 |

### 3.2 Smoke / E2E

本阶段的自动 smoke 通过 CLI 路径执行：

```bash
pnpm smoke:release
```

要求：

- `examples/sample-novel` exit 0
- `examples/broken-projects/missing-node-file` exit 2
- `examples/broken-projects/dangling-edge` exit 非 0

此外，`docs/release-checklist.md` 提供手工 UI 验收模板。

## 4. CI

文件：`.github/workflows/ci.yml`

jobs：

- `app-frontend`
  - setup pnpm + install
  - `pnpm test`
  - `pnpm --filter @galstudio/studio build`
  - `pnpm run check:schemas`
  - `pnpm run check:versions`
  - `pnpm smoke:release`
- `app-tauri`
  - setup rust
  - `cargo test`（`packages/studio/src-tauri`）
  - `cargo build`（`packages/studio/src-tauri`）

## 5. 发布与打包

打包命令（本地未签名）：

```bash
pnpm --filter @galstudio/studio tauri build
```

产物：

```text
packages/studio/src-tauri/target/release/bundle/
```

签名/公证为后续流水线任务，不在本期 CI 自动化中启用。

## 6. 打包与性能警告

- Vite 主 chunk 警告不再作为阻断项；已通过
  `packages/studio/vite.config.ts` 的 `manualChunks` 做分包。
- 如果 build 仍出现预期外告警，需在
  `docs/release-checklist.md` 写明接受原因与评估时间。

## 7. 归档判定

本 spec 完成标准已满足：

- CI 与核心验证命令可自动执行。
- 版本、schema 检查有可复现脚本。
- sample project 与 broken sample 可用于回归。
- release checklist 与 packaging 文档可查可用。
- 至少一条 smoke 路径已自动化（CLI），并保留人工 UI 模板。
