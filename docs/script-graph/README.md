# Script Graph — 规格文档集

本目录是「脚本图（Script Graph）」功能的规格说明集合，把 GalStudio 从单一预览/编辑器演化为
**Render / Script / Assets** 三工作台，并在 Script 工作台中引入 graph-first 的剧本编排方式。

## 文档清单

| 文档 | 内容 | 角色 |
|------|------|------|
| [00-feature-plan.md](./00-feature-plan.md) | 原始高层产品计划（6 阶段路线图） | 路线图 / 背景 |
| [overview.md](./overview.md) | 横切决策、统一数据模型、命名/路径/热重载约定 | **所有 phase 共用，先读这个** |
| [01-workspace-navigation.spec.md](./01-workspace-navigation.spec.md) | 顶部工作台切换 Render/Script/Assets | Phase 1 |
| [02-graph-data-contract.spec.md](./02-graph-data-contract.spec.md) | 后端图数据加载 + 线性图合成 | Phase 2（后端核心，TDD 重点） |
| [03-script-graph-view.spec.md](./03-script-graph-view.spec.md) | 图画布视图（React Flow） | Phase 3 |
| [04-node-instruction-editor.spec.md](./04-node-instruction-editor.spec.md) | 节点内指令流编辑器 | Phase 4 |
| [05-graph-editing.spec.md](./05-graph-editing.spec.md) | 节点增/删/连线/重命名/移位 | Phase 5 |
| [06-ai-operations.spec.md](./06-ai-operations.spec.md) | 校验、可操作错误、外部刷新指示 | Phase 6 |
| [07-e2g-flowchart-inspired-plan.md](./07-e2g-flowchart-inspired-plan.md) | 借鉴 Everything2Galgame 后的流程图增强计划 | Phase 7+ |

## 如何阅读

1. **先读 [00-feature-plan.md](./00-feature-plan.md)** 了解整体目标与 6 阶段划分。
2. **再读 [overview.md](./overview.md)** —— 它锁定所有 phase 共享的横切决策（数据格式、命名、路径安全、热重载、测试约定）。每个 phase spec 都假设你已读过 overview。
3. 按阶段顺序读 01 → 06。**阶段间有依赖**：01 是 UI 地基；02 是数据契约（几乎其它所有 phase 依赖它）；03/04 可并行；05 依赖 03+04；06 依赖 02+05。

## 推荐实施顺序

按原 plan 文档的建议：**Phase 1 + Phase 2 一起做**。UI 暴露新形态的同时后端长出图数据契约，
之后图画布（Phase 3）可增量推进，不阻塞编辑器（Phase 4）。

## 与 AGENTS.md 的关系

所有 spec 遵守仓库根 [AGENTS.md](../../AGENTS.md) 的产品模型、热重载约定、渲染层契约与 TDD 要求。
本目录的文档是对它的细化，不覆盖它。当二者冲突时以 AGENTS.md 为准。
