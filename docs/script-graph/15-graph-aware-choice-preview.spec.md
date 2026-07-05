# Spec 15 — Graph-Aware Branch Preview

> 状态：完成。
> 前置：Graph 节点/边、Scenario Editor、`pause` 剧情帧语义。
> 目标：预览不再把图拍平成“第一条边”线性序列，而是按 graph outgoing edges 执行线性、玩家选择和自动条件路由。

## 1. 分支契约

分支只存在于 `content/graph.json` 的 outgoing edges，节点文件内部保持线性 `Instruction[]`：

- `mode: "linear"`：单一后继。节点结束后自动进入 `to`。
- `mode: "choice"`：玩家选择。每条 edge 必须提供非空 `label`，预览把这些 label 显示为选项，选择后进入对应 `to`。
- `mode: "auto"`：自动条件。按 edge 顺序匹配 `condition`，第一条命中的 edge 跳转；空 `condition` 是默认分支。

节点文件中的 `choice` 指令已废弃，必须报 `choice_instruction_not_supported`。自动条件读取 `state.vars`；变量由节点内 `set` 指令写入。

## 2. Player 行为

`GraphNovelPlayer` 负责加载 `ProjectGraphData` 和节点表：

```ts
loadGraph(graph, nodes);
advance();
choose(toNodeId);
```

推进规则：

- 节点内仍按剧情帧推进：非阻塞舞台命令连续执行，停在 `say` / `narrate` / `wait` / `pause`。
- 节点指令播放完后读取当前节点 outgoing edges。
- 无 outgoing edges：停在当前末尾，视为自然结束。
- `linear`：目标唯一时加载下一节点并继续本次推进；多目标由校验报错。
- `choice`：写入 `state.choice.choices` 并等待 renderer 调用 `onChoose`。
- `auto`：用 `state.vars` 判断条件并跳转；没有匹配项时停止并记录警告。

## 3. 条件表达式

V1 条件表达式保持轻量，面向外部 Agent 可稳定生成：

- `flag`
- `!flag`
- `key == value`
- `key != value`
- `score >= 3`
- `route == "stay"`

值支持字符串、数字、布尔值和 `null`。复杂脚本、随机数生成和函数调用不进入 V1；随机分支应先通过 `set` 写入变量，再用 `auto` edge 判断。

## 4. Studio UI

- Graph 视图展示 edge label：`choice` 显示 `label`，`auto` 显示 `if <condition>`。
- 节点编辑页底部提供“节点出口”块，编辑结束、线性后继、玩家选择和自动条件。
- Scenario 文本区、Inspector 和 JSON 模式不再提供 `choice` 正文块。
- 保存节点时若出口配置有错误，保存按钮禁用并显示问题；保存成功时同时落节点文件和 `content/graph.json`。

## 5. 验收测试

| 测试名 | 断言 |
| --- | --- |
| `graph player follows linear edge to next node` | 节点结束后进入唯一 `linear` 后继 |
| `graph player exposes choice edges and follows selected target` | `choice` edges 转为 `state.choice`，`choose()` 后进入目标节点 |
| `graph player evaluates auto edges from runtime vars` | `set` 写入变量后命中对应 `auto` edge |
| `validate_node_contents_rejects_choice_instruction` | 节点内 `choice` 立即报错 |
| `validate_graph_flags_choice_edge_missing_label` | `choice` edge 缺 label 报错 |
| `validate_graph_flags_linear_multiple_outgoing` | `linear` 多出边报错 |
| `validate_graph_flags_auto_multiple_default_edges` | `auto` 多默认边报错 |
| `validate_graph_warns_auto_without_default_edge` | 多条 `auto` 无默认边给 warning |

## 6. 不在范围

- 存档系统、历史回放、多周目状态。
- 复杂表达式语言、函数调用或 renderer 自定义路由脚本。
- 节点内部的分支块；节点内部必须保持线性。
