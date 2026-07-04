# Spec 11 — 分支与选择语义

> 状态：规划中。
> 前置：graph 节点/边已存在；`edge.condition` 当前是保留字段；预览当前按线性启发式排序。
> 目标：定义 galgame 选择项如何驱动 graph 分支，使剧情流程、预览、校验和外部 Agent 数据写入有稳定契约。

## 1. 需求

真正的 galgame 需要选择和分支。GalStudio 需要明确：

- 选择项写在节点文件里，还是 graph edge 上，或二者如何关联。
- 玩家选择后如何跳到下一个 node。
- 多条 outgoing edges 如何显示、校验和预览。
- 外部 Agent 如何安全新增分支。
- 未连接选择、悬空边、无法到达节点如何报告。

## 2. 当前状态

已有能力：

- `graph.edges[]` 有 `from`、`to`、`condition`。
- `ProjectGraph` 有 `entryNodeId`。
- 预览 `orderGraphNodesForPreview()` 从 entry 沿第一条可用边走，再追加未访问节点。
- 节点状态已能区分 branch / ending / orphan 等视觉状态。

缺口：

- engine 没有正式 `choice` 指令。
- `edge.condition` 没有 schema。
- 渲染层 props 没有选择项交互契约。
- CLI 无法校验“选择项是否连接到边”。

## 3. 语义决策

推荐方案：**选择项在节点内，跳转目标在 choice item 上，graph edge 是可视化索引**。

新增指令：

```json
{
  "t": "choice",
  "choices": [
    { "text": "留下", "to": "stay" },
    { "text": "离开", "to": "leave" }
  ]
}
```

理由：

- 剧本文本和玩家看到的选项属于演出内容，放在节点文件里更自然。
- 外部 Agent 修改单个节点即可新增选择项。
- graph edge 可由 choice 派生或校验，不需要在 edge 上复制展示文本。
- `edge.condition` 保留给未来 flags/条件分支。

Graph 约定：

- 对每个 `choice.choices[].to`，应存在一条 `edge.from == currentNodeId && edge.to == choice.to`。
- edge id 仍默认 `<from>__<to>`。
- 若存在 outgoing edge 但节点无 choice，表示线性后继。
- 若节点有 choice，则 outgoing edges 应由 choice 覆盖；额外 edge 报 warn。

## 4. Schema 变更

### 4.1 Engine

`InstructionSchema` 新增：

```ts
export const ChoiceInstruction = z.object({
  t: z.literal("choice"),
  choices: z.array(z.object({
    text: z.string().min(1),
    to: z.string().min(1),
  })).min(1),
});
```

类型：

```ts
export type ChoiceInstr = z.infer<typeof ChoiceInstruction>;
```

### 4.2 JSON Schema 导出

更新：

- `.galstudio/schemas/nodeFile.json`
- `docs/script-graph/schemas/nodeFile.json`
- 项目初始化复制的 schema 快照

## 5. Engine 行为

`NovelState` 新增：

```ts
choice: {
  choices: { text: string; to: string }[];
} | null
```

`applyInstruction(choice)`：

- 清空 dialogue/narration。
- 设置 `state.choice`。
- 暂停自动推进。

`RendererProps` 新增：

```ts
onChoose?: (toNodeId: string) => void;
```

对于单节点预览：

- 点击选择项时显示“将跳转到 xxx”，但不真正加载下个节点，除非进入整图预览模式。

对于整图预览：

- `NovelPlayer` 需要从 flat instruction stream 过渡到 graph-aware player。

## 6. 预览分阶段

### Stage 1：数据和校验先行

- 增加 `choice` schema。
- 节点编辑器可编辑 choice。
- Graph/CLI 校验 choice 和 edge 一致性。
- 预览遇到 choice 时展示选项但不跨节点跳转。

### Stage 2：路径预览

新增“选择一条路径预览”：

- 从 entry 开始。
- 遇到 choice 时，默认使用第一项，或用户在预览中点击。
- 加载目标节点并继续。
- 检测循环，超过最大节点数停止并提示。

### Stage 3：正式整图播放

引入 graph-aware player：

```ts
loadGraph({ graph, nodes })
choose(toNodeId)
```

播放器不再只消费拍平 chapters，而是按节点边界加载。

## 7. 校验规则

新增 project/node issues：

| code | severity | 触发条件 |
| --- | --- | --- |
| `choice_target_missing_node` | error | `choice.to` 不存在 |
| `choice_missing_graph_edge` | warn | choice target 没有对应 edge |
| `edge_missing_choice` | warn | choice 节点存在额外 outgoing edge |
| `linear_node_multiple_outgoing` | warn | 无 choice 的节点有多条 outgoing edges |
| `unreachable_node` | warn | 从 entry 按 edges 不可达 |
| `dead_end_node` | warn | 非 choice、非终点标记却无 outgoing edge |

终点判定第一期：

- 无 outgoing edge 即可作为 ending，不强制报 `dead_end_node`。
- `dead_end_node` 可推迟，避免误伤短篇/未完成项目。

## 8. UI 计划

### GraphCanvas

- choice 节点状态显示为 branch。
- edge label 可显示 choice text。
- 从 choice 块新增选项时，可自动创建 edge。

### NodeEditor

choice 块控件：

```text
选择
  选项文本 [留下      ]  目标节点 [stay ▼]
  选项文本 [离开      ]  目标节点 [leave ▼]
  [+ 添加选项]
```

支持：

- 新建目标节点。
- 连接到已有节点。
- 删除选项时提示是否删除对应 edge。

### Inspector

分支节点显示：

- choices 数量。
- 每个 choice 的目标节点。
- 缺失 edge / 缺失 node 的问题。

## 9. TDD 清单

### Engine

| 测试名 | 断言 |
| --- | --- |
| `schema_accepts_choice_instruction` | choice 合法 |
| `schema_rejects_empty_choice_text` | 空文本非法 |
| `applyInstruction_choice_sets_choice_state` | state.choice 被设置 |
| `player_does_not_auto_advance_past_choice` | choice 停住 |

### Studio Rust

| 测试名 | 断言 |
| --- | --- |
| `validate_choice_flags_missing_target_node` | target 不存在报 error |
| `validate_choice_flags_missing_graph_edge` | choice 无 edge 报 warn |
| `validate_choice_flags_extra_edge_from_choice_node` | 额外 outgoing edge 报 warn |
| `validate_choice_flags_linear_multiple_outgoing` | 无 choice 多出边报 warn |

### Frontend

| 测试名 | 断言 |
| --- | --- |
| `summarizeInstructions_includes_choice` | 大纲显示 choice |
| `choiceBlock_adds_choice_item` | choice 块可添加选项 |
| `mapGraphToFlow_labels_choice_edges` | edge label 显示 choice text |

## 10. 验收标准

1. 作者可在节点内新增 choice 指令。
2. Graph 显示分支边，并能看出每条边对应的选择文本。
3. CLI 能报告 choice 指向不存在节点。
4. choice 目标存在但缺 graph edge 时，UI/CLI 报 warn。
5. 预览遇到 choice 不再继续自动推进。

## 11. 可归档标准

本 spec 可归档的条件：

- `choice` 已进入 engine schema、JSON Schema、节点编辑器。
- graph 和 CLI 校验覆盖 choice/edge 一致性。
- 渲染层 contract 文档说明 choice state 和 onChoose。
- 至少 Stage 1 预览行为完成并有测试。
- Stage 2/3 若未做，需拆出独立后续 spec。

## 12. 不在本期范围

- flags / variables / conditional expression。
- 存档系统。
- 多周目状态。
- 复杂脚本语言。
