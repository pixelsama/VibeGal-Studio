# Spec 16 — Graph Undo/Redo Command Stack

> 状态：后续规划。
> 来源：从 [09-safe-persistence-collaboration.spec.md](./archive/09-safe-persistence-collaboration.spec.md) Stage 6 拆出。
> 目标：为 Script graph 编辑提供统一 undo/redo，而不重新扩大安全持久化阶段范围。

## 1. 范围

本 spec 只覆盖 graph 级编辑：

- add node
- remove nodes
- connect
- remove edge
- rename
- move / position patch
- set entry
- auto layout

节点内容编辑继续使用文本框或块编辑器自身的局部 undo，不进入 graph 栈。

## 2. 设计要求

- 所有 graph 编辑入口先收敛为 command。
- 每个 command 记录可执行 inverse patch。
- undo/redo 只改变内存 graph draft；落盘仍走已有 `save_graph` 或 `save_graph_positions` 安全持久化路径。
- 外部文件刷新时，如果本地 undo 栈基于旧 revision，应提示用户重载或清空栈，不静默把旧 inverse 应用到新 graph。

## 3. TDD 清单

| 测试名 | 断言 |
| --- | --- |
| `undoRedoGraphReducerRestoresPreviousGraph` | 执行 command 后 undo 恢复旧 graph，redo 恢复新 graph |
| `undoClearsRedoAfterNewCommand` | undo 后执行新 command 会清空 redo 栈 |
| `undoStackDoesNotApplyAcrossGraphRevisionChange` | 外部 revision 更新后不把旧 inverse 应用到新 graph |

## 4. 非目标

- 实时协同。
- CRDT。
- 节点文本编辑统一 undo。
- Git 集成或历史可视化。
