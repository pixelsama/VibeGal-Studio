# Spec 15 — Graph-Aware Choice Preview

> 状态：后续规划。
> 前置：Spec 11 Stage 1 已定义 `choice` 指令、choice/edge 校验和 renderer choice contract。
> 目标：把 Stage 1 的“遇到 choice 停住并展示选项”推进为可沿 graph 选择路径播放。

## 1. Stage 2：路径预览

- 从 `graph.entryNodeId` 开始加载节点。
- 遇到 `choice` 时默认停住，用户点击选项后加载 `choice.to` 目标节点。
- 支持“按第一项自动预览路径”的调试模式。
- 检测循环；超过最大节点数或重复访问策略触发时停止并报告。
- 单节点预览继续保持 Stage 1 行为：展示目标提示，不跨节点加载。

## 2. Stage 3：正式整图播放

引入 graph-aware player API：

```ts
loadGraph({ graph, nodes });
choose(toNodeId);
```

播放器按节点边界加载指令，不再依赖把节点拍平成章节列表。`onChoose` 调用 `choose()` 后推进目标节点，并由校验保证目标和 edge 可解释。

## 3. TDD 清单

| 测试名 | 断言 |
| --- | --- |
| `graphPlayer_starts_at_entry_node` | 从入口节点第一条指令开始 |
| `graphPlayer_choose_loads_target_node` | 点击 choice 后加载目标节点 |
| `graphPlayer_rejects_missing_choice_target` | 缺失目标以错误状态停止 |
| `graphPlayer_stops_on_cycle_limit` | 循环超过上限停止并报告 |
| `singleNodePreview_choice_does_not_load_target` | 单节点预览保持 Stage 1 行为 |

## 4. 不在范围

- flags / variables / conditional expressions。
- 存档系统和历史回放。
- 多周目状态。
