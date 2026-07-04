# Spec 13 — 文档与规格收敛

> 状态：已归档。
> 前置：AGENTS.md 已锁定当前产品边界；`docs/script-graph/` 中仍有部分历史规划与当前实现不一致。
> 目标：让仓库文档、项目自描述文件和 schema 快照都指向同一套真实产品契约。

## 1. 需求

GalStudio 明确服务外部 Agent 直接读写项目文件，因此文档本身就是产品接口的一部分。
如果 spec 过时，外部 Agent 会做出错误修改。

需要完成：

- 清理旧文档中“legacy chapters 合成线性图”的过时说法。
- 明确当前规则：缺 `content/graph.json` 报 issue；legacy chapters 不加载、不合成。
- 统一 docs、AGENTS、项目初始化写入的 `AGENTS.md` / `.galstudio/README.md`。
- 为每个 spec 标注状态：规划中、实施中、完成、归档。
- 建立归档标准和归档目录。
- 确保 schema 快照由 engine schema 导出，不手写漂移。

## 2. 当前状态

一致的文档：

- 根 `AGENTS.md` 已描述 graph-first、no in-app AI、hot reload、renderer contract。
- `overview.md` 已写明旧 chapters 不再作为入口。
- 项目初始化写入的 `PROJECT_AGENTS_MD` 和 `PROJECT_README_MD` 已符合当前产品边界。

不一致风险：

- `00-feature-plan.md` 仍提到旧 chapters 合成线性图。
- `02-graph-data-contract.spec.md` 仍以旧合成行为为主体。
- `07-e2g-flowchart-inspired-plan.md` 当前状态摘要里仍提到旧章节合成线性图。
- README 的阶段说明可能没有标注“历史文档，以 AGENTS/overview 为准”。

## 3. 文档分层

建议建立三层：

### 3.1 当前契约

必须准确，外部 Agent 可直接依赖：

- `AGENTS.md`
- `docs/script-graph/overview.md`
- `docs/script-graph/node-and-graph-schema.md`
- `docs/script-graph/schemas/*.json`
- 新项目内 `AGENTS.md`
- 新项目内 `.galstudio/README.md`
- 新项目内 `.galstudio/schemas/*.json`

### 3.2 实施 spec

描述未来工作，允许规划未完成，但必须标状态：

- `01-*.spec.md` 到当前新增 spec。

### 3.3 历史背景

保留思考过程，但不能伪装成当前契约：

- `00-feature-plan.md`
- 过时 phase spec 的旧段落

可移动到：

```text
docs/script-graph/archive/
```

或在文件顶部加明显 warning。

## 4. 状态标记

每份 spec 顶部统一：

```md
> 状态：规划中 | 实施中 | 完成 | 已归档 | 历史背景
> 当前契约以：AGENTS.md + overview.md 为准。
```

完成定义：

- 行为已实现。
- 测试和验收已完成。
- 文档和 schema 已更新。
- 无已知阻塞项。

归档定义：

- 完成后不再作为活跃计划维护。
- 若有未做项，必须拆成新的 spec。
- README 中移动到“已归档/历史”区域。

## 5. 收敛任务

### Stage 1：冲突审计

搜索关键词：

```text
synthesize
合成
chapters
旧章节
legacy
AI
agent
renderer
graph.json
```

输出一份文档冲突列表：

```text
docs/script-graph/doc-audit.md
```

每项包含：

- 文件
- 段落/关键词
- 当前说法
- 应改为
- 是否改完

### Stage 2：修正当前契约文档

优先修：

- `overview.md`
- `node-and-graph-schema.md`
- `README.md`
- schema 说明

确保它们无过时行为。

### Stage 3：处理历史 spec

对旧 spec 选择一种策略：

- 若仍有价值：更新为当前规则。
- 若主要是历史：移入 `archive/` 或加历史标记。
- 若内容已被新 spec 替代：在顶部链接新 spec。

### Stage 4：项目自描述同步

`PROJECT_AGENTS_MD`、`PROJECT_README_MD`、schema include 文件同步：

- 新项目初始化后的文件必须和 docs 当前契约一致。
- 若 schema 更新，运行 schema export。

### Stage 5：文档校验脚本

新增轻量脚本可选：

```text
scripts/check-doc-contract.mjs
```

检查：

- 活跃文档不包含禁止短语，如“合成线性图”。
- README 文档清单文件都存在。
- schema 快照文件存在。
- 每份 spec 有状态行和可归档标准。

## 6. TDD / 验证清单

文档任务不需要行为测试，但需要自动化验证。

| 验证 | 断言 |
| --- | --- |
| `rg "合成线性图|synthesizes linear" docs/script-graph` | 只允许 archive 或历史背景文件出现 |
| README 链接检查 | 所有链接存在 |
| schema export | 导出后无 diff 或 diff 已提交 |
| 初始化项目测试 | 新项目含最新 AGENTS/README/schema |

若新增 `check-doc-contract.mjs`：

| 测试名 | 断言 |
| --- | --- |
| `docs_contract_check_passes` | 活跃文档无禁止短语 |

## 7. 验收标准

1. 外部 Agent 只读新项目根 `AGENTS.md` 和 `.galstudio/README.md`，能知道当前 graph-first 规则。
2. `docs/script-graph/README.md` 清楚区分当前契约、活跃计划、历史背景。
3. 所有活跃 spec 顶部都有状态。
4. 旧 chapters 行为没有在活跃契约中被描述成可用能力。
5. schema 快照与 engine schema 对齐。

## 8. 可归档标准

本 spec 可归档的条件：

- 完成一次 doc audit，并提交结果或删除所有已修复项。
- 当前契约文档无冲突。
- README 文档索引更新。
- 新项目自描述文件同步。
- 若没有自动脚本，至少在提交说明中记录使用的 `rg` 校验命令。

## 9. 不在本期范围

- 用户手册完整重写。
- 官网文档。
- 多语言文档。
- 自动生成所有 Markdown。
