# Script Graph — 规格文档集

> 状态：完成。
> 当前产品契约以仓库根 [AGENTS.md](../../AGENTS.md)、[overview.md](./overview.md)、[node-and-graph-schema.md](./node-and-graph-schema.md) 和 `.galstudio/schemas/*.json` 为准。

本目录记录 Script Graph 的当前契约、活跃规格和历史背景。

## 文档分层

| 文档 | 内容 | 状态 |
|------|------|------|
| [overview.md](./overview.md) | 横切决策、统一数据模型、命名/路径/热重载约定 | 当前契约 |
| [node-and-graph-schema.md](./node-and-graph-schema.md) | 面向外部工具/Agent 的读写速查与路径安全约定 | 当前契约 |
| [01-workspace-navigation.spec.md](./01-workspace-navigation.spec.md) | 顶部工作台切换 Render/Script/Assets | 完成 |
| [02-graph-data-contract.spec.md](./02-graph-data-contract.spec.md) | 后端图数据加载、缺失图报 issue、节点文件读取 | 完成 |
| [03-script-graph-view.spec.md](./03-script-graph-view.spec.md) | 图画布视图（React Flow） | 完成 |
| [04-node-instruction-editor.spec.md](./04-node-instruction-editor.spec.md) | 节点内指令流编辑器 | 完成 |
| [05-graph-editing.spec.md](./05-graph-editing.spec.md) | 节点增/删/连线/重命名/移位/落盘 | 完成 |
| [06-external-data-operations.spec.md](./06-external-data-operations.spec.md) | 校验、可操作错误、外部刷新指示、无内置 AI 边界 | 完成 |
| [07-e2g-flowchart-inspired-plan.md](./07-e2g-flowchart-inspired-plan.md) | 借鉴 Everything2Galgame 后的流程图增强计划 | 规划中 |
| [15-graph-aware-choice-preview.spec.md](./15-graph-aware-choice-preview.spec.md) | graph-aware 分支预览与 choice/auto 出口播放器 | 完成 |
| [16-graph-undo-redo.spec.md](./16-graph-undo-redo.spec.md) | graph command stack 与 undo/redo | Spec 09 后续 Stage 6 |
| [00-feature-plan.md](./00-feature-plan.md) | 原始高层产品计划与早期设想 | 历史背景 |
| [archive/08-node-content-validation.spec.md](./archive/08-node-content-validation.spec.md) | 节点 `Instruction[]` 内容校验接入全局报告与 CLI | 已归档 |
| [archive/09-safe-persistence-collaboration.spec.md](./archive/09-safe-persistence-collaboration.spec.md) | 文件 revision、冲突检测、可恢复删除、graph patch 保存 | 已归档 |
| [archive/10-block-instruction-editor.spec.md](./archive/10-block-instruction-editor.spec.md) | 从 JSON 编辑升级到指令块编辑，同时保留 JSON 高级模式 | 已归档 |
| [archive/11-branch-choice-semantics.spec.md](./archive/11-branch-choice-semantics.spec.md) | `choice` 指令、graph 分支语义、分支校验与预览路线 | 已归档 |
| [archive/12-assets-renderer-productization.spec.md](./archive/12-assets-renderer-productization.spec.md) | 资产选择/预览/批量清理与 renderer 管理/契约/回归 | 已归档 |
| [archive/13-documentation-convergence.spec.md](./archive/13-documentation-convergence.spec.md) | 收敛 AGENTS、overview、历史 spec、项目自描述和 schema 文档 | 已归档 |
| [archive/14-release-readiness.spec.md](./archive/14-release-readiness.spec.md) | CI、smoke/e2e、打包版本、示例项目与发布 checklist | 已归档 |

## 如何阅读

1. 先读 [overview.md](./overview.md) 和 [node-and-graph-schema.md](./node-and-graph-schema.md) 了解当前契约。
2. 再读 01 → 06，理解已经落地的主干能力。
3. 读 07、15、16 时，把它们当作仍在推进的后续规格，按顶部状态判断当前阶段。
4. 需要回看路线图时再读 [00-feature-plan.md](./00-feature-plan.md)；它保留历史脉络，不代表当前契约。

## 归档规则

- `docs/script-graph/archive/` 存放已归档的历史文档、截面或替代版本。
- 已归档文档可以保留历史说法，但不能冒充当前产品契约。
- 如果某份规格已被新规格完全替代，优先在原文件顶部链接新规格，再考虑迁移到 `archive/`。

## 与 AGENTS.md 的关系

所有 spec 遵守仓库根 [AGENTS.md](../../AGENTS.md) 的产品模型、热重载约定、渲染层契约与 TDD 要求。
本目录的文档是对它的细化，不覆盖它。当二者冲突时以 AGENTS.md 为准。
