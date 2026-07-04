# Spec 14 — 发布级保障与归档流程

> 状态：规划中。
> 前置：单元测试、Rust 测试、Web build、Cargo build 已能通过。
> 目标：把 GalStudio 从开发态推进到可发布、可回归、可归档的桌面应用工程。

## 1. 需求

当前项目已有大量单元测试，但发布级保障还需要覆盖真实应用路径：

- Tauri app smoke/e2e。
- 新建项目、打开项目、热重载、资产导入、节点编辑、renderer 切换、CLI 校验。
- CI 能在无人工操作下跑核心验证。
- 打包、签名、版本号、更新策略有明确流程。
- 示例项目和用户文档可作为发布验收素材。

## 2. 当前状态

已有验证：

- `pnpm test`
- `cargo test`
- `pnpm build`
- `cargo build`

已知提示：

- Vite 主 chunk 超过 500KB。
- `src/lib/tauri.ts` 动态 import 不能实际拆包，因为也被静态 import。

缺口：

- 无端到端 UI smoke。
- 无 CI workflow。
- 无 release checklist。
- 无打包签名流程文档。
- 无版本迁移策略。

## 3. 验证矩阵

### 3.1 必跑

| 层级 | 命令 | 目的 |
| --- | --- | --- |
| Engine unit | `pnpm --filter @galstudio/engine test` | schema / interpreter / validate |
| Studio unit | `pnpm --filter @galstudio/studio test` | 前端纯逻辑与 SSR 组件 |
| Rust unit | `cargo test` in `packages/studio/src-tauri` | 文件系统、校验、CLI |
| Web build | `pnpm --filter @galstudio/studio build` | TS + Vite |
| Rust build | `cargo build` | Tauri backend + CLI |

### 3.2 Smoke / E2E

建议使用 Playwright + Tauri driver 或最小可行 UI 自动化。

场景：

| 场景 | 断言 |
| --- | --- |
| 新建项目 | 生成 `gal.project.json`、`content/graph.json`、`AGENTS.md`、默认 renderer |
| 打开非项目目录 | 弹确认，不静默写入 |
| 打开示例项目 | Render/Script/Assets 可切换 |
| 编辑节点并保存 | `content/nodes/<id>.json` 改变，预览刷新 |
| 外部修改节点 | UI 同步状态从 syncing 到 synced |
| 导入背景 | 文件复制到 assets，manifest 登记 |
| 切换 renderer | `activeRendererId` 持久化 |
| CLI validate | clean 项目 exit 0，坏项目 exit 非零并输出 JSON |

## 4. CI 计划

GitHub Actions 建议：

```text
.github/workflows/ci.yml
```

jobs：

- `frontend-engine`
  - setup pnpm
  - install
  - `pnpm test`
  - `pnpm build`
- `rust`
  - setup Rust
  - install Tauri system deps if needed
  - `cargo test`
  - `cargo build`
- `schemas`
  - `pnpm --filter @galstudio/engine export-schemas`
  - fail on diff

macOS app build 可单独 release workflow，不必每个 PR 都跑。

## 5. 打包与版本

### 5.1 版本来源

需要统一：

- root `package.json`
- `packages/studio/package.json`
- `packages/studio/src-tauri/Cargo.toml`
- `packages/studio/src-tauri/tauri.conf.json`

建议新增脚本：

```text
scripts/check-version-consistency.mjs
```

### 5.2 打包命令

文档化：

```bash
pnpm --filter @galstudio/studio tauri build
```

产物路径：

```text
packages/studio/src-tauri/target/release/bundle/
```

### 5.3 签名与公证

macOS 发布需要：

- Developer ID Application certificate。
- Apple notarization。
- Tauri signing 配置。

第一期可只写本地未签名 build 流程；签名作为 release gate 前的独立任务。

## 6. 示例项目

`examples/sample-novel` 应成为 smoke 素材。

需要确保：

- 使用当前 graph-first 结构。
- 不依赖 legacy chapters。
- 包含至少：
  - 一个背景。
  - 一个角色两种表情。
  - BGM/SFX。
  - 两个节点和一条边。
  - 后续若 choice 完成，包含一个 choice 分支。

新增可选：

```text
examples/broken-projects/
  missing-node-file/
  dangling-edge/
  missing-asset/
  invalid-instruction/
```

用于 CLI 和 UI 问题面板验收。

## 7. 发布 Checklist

发布前必须完成：

- [ ] `git status --short` 干净。
- [ ] `pnpm test` 通过。
- [ ] `cargo test` 通过。
- [ ] `pnpm build` 通过。
- [ ] `cargo build` 通过。
- [ ] smoke/e2e 通过或人工记录通过。
- [ ] schema export 无未提交 diff。
- [ ] sample project 可打开。
- [ ] CLI validate clean sample exit 0。
- [ ] 版本号一致。
- [ ] release notes 已写。
- [ ] 若发布 macOS app，签名/公证完成。

## 8. 性能与包体

当前 Web build chunk warning 不是 blocker，但发布前应处理或明确接受。

候选任务：

- 拆分 render/script/assets/settings 工作台 chunk。
- 延迟加载 esbuild-wasm 和 renderer compiler。
- 只在 Render/Node Preview 使用 renderer loader 时加载相关代码。
- 调整 chunk warning limit 前必须先记录理由。

验收：

- 首屏项目列表不加载 renderer compiler。
- 主 chunk 低于 500KB，或 release checklist 记录接受原因。

## 9. 崩溃与错误报告

第一期不接远程 crash reporting。

本地能力：

- 可复制错误详情。
- CLI 输出机器可读错误。
- renderer compile error 包含 renderer id 和文件。
- 文件写入失败不丢草稿。

## 10. 归档流程

每个 phase/spec 完成后：

1. 确认可归档标准全部满足。
2. 未完成项拆成新 spec 或明确不做。
3. 在 spec 顶部改 `状态：完成`。
4. 更新 `docs/script-graph/README.md`。
5. 可选择移动到 `docs/script-graph/archive/`，或保留在主目录但列入“已完成”。

## 11. TDD / 验证清单

| 项目 | 验证 |
| --- | --- |
| CI workflow | PR 上自动跑 test/build |
| CLI sample | clean/broken 示例项目 exit code 正确 |
| smoke 新建项目 | 自动或人工记录 |
| smoke 热重载 | 自动或人工记录 |
| version check | 版本不一致时失败 |
| schema check | schema 导出有 diff 时失败 |

## 12. 可归档标准

本 spec 可归档的条件：

- CI 跑通核心 test/build。
- release checklist 存在并被执行至少一次。
- 至少一个 smoke/e2e 路径自动化，或有明确人工验收模板。
- sample project 更新为当前契约。
- 版本一致性和 schema 漂移有检查。
- 打包流程文档可被从零执行。

## 13. 不在本期范围

- 自动更新服务。
- 崩溃遥测平台。
- 多平台商店发布。
- 完整安装器 UX 设计。
