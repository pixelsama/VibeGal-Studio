# Script Graph Doc Audit

> 目的：记录本次文档收敛中发现的契约冲突、处理方式和剩余风险。

| 文件 | 段落/关键词 | 当前说法 | 应改为 | 是否改完 |
|------|-------------|----------|--------|---------|
| `docs/script-graph/README.md` | 文档索引 | 只有线性 phase 列表，没有分层 | 分成当前契约 / 活跃 spec / 历史背景 / archive | 是 |
| `docs/script-graph/overview.md` | `chapters` / 合成 | 旧 chapters 只是“不是入口” | 明确为历史背景，不会合成图 | 是 |
| `docs/script-graph/node-and-graph-schema.md` | 线性故事 / chapters | 容易被理解为旧数据仍可作为入口 | 只保留当前写入速查，旧 chapters 只报 issue | 是 |
| `docs/script-graph/00-feature-plan.md` | `synthesize a linear graph` | 历史路线图仍描述旧合成逻辑 | 标记为历史背景，并提醒不作为当前契约 | 是 |
| `docs/script-graph/02-graph-data-contract.spec.md` | `synthesize` / `synthetic: true` | 旧契约把缺 graph 解释成合成图 | 改成 missing_graph issue + 空图返回 | 是 |
| `docs/script-graph/03-script-graph-view.spec.md` | `合成线性图` / `chapters` | 验收文案沿用旧章节口径 | 改成含 graph.json 的示例项目与空 graph 项目 | 是 |
| `docs/script-graph/04-node-instruction-editor.spec.md` | `project.content.chapters` | 仍把旧章节编辑器当主数据源 | 改成章节编辑器仅兼容，节点编辑以 project.nodes 为准 | 是 |
| `docs/script-graph/05-graph-editing.spec.md` | `synthetic: true` / chapters 固化 | 仍描述合成图固化按钮 | 改成始终直接写 graph.json | 是 |
| `docs/script-graph/06-external-data-operations.spec.md` | `synthetic: true` | 校验文档仍按合成图分类 | 改成图为空或图数据完整都校验 | 是 |
| `docs/script-graph/07-e2g-flowchart-inspired-plan.md` | 当前状态摘要 | 仍写旧章节合成线性图 | 改成 missing_graph issue，不合成旧 chapters | 是 |
| `docs/script-graph/13-documentation-convergence.spec.md` | 旧说法、校验串 | 作为审计 spec 本身仍提到禁用短语 | 保留为任务说明，但不作为当前契约 | 部分保留 |
| `packages/studio/src-tauri/src/lib.rs` | `PROJECT_AGENTS_MD` / `PROJECT_README_MD` | 新项目自描述仍需要同步当前契约措辞 | 补充 missing_graph 与 legacy chapters 只报 issue | 是 |

## 处理策略

1. 当前契约文档优先修正，不把历史说法留在主索引里。
2. 历史路线图保留在 `00-feature-plan.md`，并明确标成历史背景。
3. 旧章节相关内容只允许出现在历史背景或审计说明里。
4. 新项目自描述文件与 `docs` 同步，避免外部 Agent 读到两套口径。

## 剩余风险

- `13-documentation-convergence.spec.md` 是本次收敛的任务说明，里面仍会出现禁用短语用于审计语境。
- 后续若再新增 phase spec，需要继续补状态行并保持 `README` 索引同步。
