# Phase 4 — 节点 Scenario Editor 规格

> 状态：完成。
> 前置：Phase 3（图视图）、Phase 2（`project.nodes`）。
> 已读 [overview.md](./overview.md)（§1.1 节点=Instruction[]、§1.3 预览播放选中节点）。

本阶段把 Graph 节点内部编辑改为 **Scenario Editor + 单节点预览 + Inspector**。Graph 继续承接节点结构和分支；节点内部负责一段戏的剧本文本、舞台命令和当前节点预览。

## 1. 数据契约

节点文件仍然是 `content/nodes/*.json` 的 `Instruction[]` JSON 数组，不新增 `.galscript` 文件。Scenario Editor 显示的剧本文本只是 `Instruction[]` 的可逆投影：

- 进入节点时：`Instruction[]` → Scenario DSL。
- 保存节点时：Scenario DSL → `Instruction[]` JSON → 写回 `content/${node.file}`。
- JSON 高级模式保留，用于外部 Agent 或高级用户处理特殊结构。
- 外部 Agent 仍应直接读写 `content/nodes/*.json`，并使用 `.galstudio/schemas/nodeFile.json` 与 `galstudio-cli validate . --format json` 校验。

## 2. Scenario DSL

基础语法：

```text
@bg classroom fade
@bgm daily
@char akari smile left

akari: 今天也很安静呢。

@sfx door
@char akari surprised center
akari: 咦？

@set affection 3
```

规则：

- 空行分隔剧情帧；玩家一次推进会消费本帧舞台命令并停在文本、`wait` 或 `pause`。
- `@bg` / `@bgm` / `@sfx` / `@voice` / `@char` / `@effect` / `@transition` 是非阻塞舞台命令。
- `角色ID: 文本` 编译为 `say`；普通文本行编译为 `narrate`。
- 只有舞台命令的帧自动补 `{ "t": "pause" }`，作为纯画面玩家停点。
- `@wait 800` 是计时等待；`@pause` 是玩家输入停点。
- `@set key value` 编译为变量写入指令，供流程图出口的自动条件路由使用。
- `@choice` 和 `- 文本 -> nodeId` 在节点文本中非法；分支统一在流程图节点出口中配置。
- V1 不支持 `@layout`、相对坐标或 renderer layout override。

## 3. 节点编辑页布局

```text
┌───────────────────────────────┬────────────────────────────┐
│ Scenario Editor                │ Live Preview               │
│ - toolbar / save / status      │ fixed stage frame          │
│ - command palette / line plus  ├────────────────────────────┤
│ - textarea DSL or JSON         │ Inspector                  │
│                                │ selected line / node issues │
└───────────────────────────────┴────────────────────────────┘
```

- 左侧是主要写作区，默认 Scenario DSL，JSON 为高级模式。
- 右上是当前节点预览，使用最后一次合法草稿；剧本文本有解析错误时，预览不丢失。
- 右下 Inspector 跟随光标行：
  - 台词行：角色、表情、文本。
  - `@bg`：背景 picker、转场。
  - `@char`：角色、表情、位置槽、转场。
  - `@set`：变量名、变量值。
  - 空白或无可编辑行：节点摘要、诊断和问题列表。
- Inspector 修改必须立即同步 Scenario 文本；用户手写文本也会反向更新 Inspector。
- 分支编辑不进入节点正文编辑页；出口是流程图节点属性，在 Graph 视图中通过连线和节点 Inspector 配置。

## 4. 播放语义

`NovelPlayer.advance()` 不再只消费一条指令，而是推进到下一个停点：

- 非阻塞：`bg`、`bgm`、`sfx`、`voice`、`char`、`effect`、`transition`。
- 停点：`say`、`narrate`、`wait`、`pause`。
- `wait` 到时后继续推进到下一个停点。
- `pause` 清掉文本/选项，停在当前画面等待玩家输入。
- `stepOnce()` 保持逐条指令调试语义。
- 节点结束后由 graph-aware player 读取该节点 outgoing edges：`linear` 自动跳转，`choice` 展示选项等待选择，`auto` 根据 `state.vars` 条件跳转。

## 5. 校验与协作

- `pause` 和 `set` 是合法节点指令，进入 engine schema、JSON Schema、Rust/Tauri node validation 和 CLI/projectReport。
- `choice` 节点指令不合法，CLI/projectReport 立即报 `choice_instruction_not_supported`。
- graph 校验覆盖流程图出口：混用模式、线性多出边、choice 缺 label、auto 多默认边等问题会进入 graphReport/projectReport。
- Scenario DSL 解析失败时保留草稿、显示行级诊断、禁用保存。
- 保存仍带 `nodeRevisions`，发生 `write_conflict` 时保留当前草稿并允许另存副本。
- 外部更新同一节点文件时，无本地脏改动则自动载入；有脏改动则提示手动载入。

## 6. 验收标准

1. 双击 Graph 节点进入编辑器，默认显示 Scenario DSL。
2. 编辑剧本文本并保存后，磁盘仍写入规范化 `Instruction[]` JSON。
3. 空行分帧；舞台命令帧自动生成 `pause`，播放器按剧情帧推进。
4. 右上预览跟随最后一次合法草稿。
5. 右下 Inspector 能编辑 say/bg/char/set 并即时回写文本。
6. JSON 高级模式能正常切换、保存和返回 Scenario 模式。
7. 节点正文编辑页不显示出口编辑；流程图能由连线推断结束/普通继续，并能在图侧节点 Inspector 配置玩家选择和自动条件出口。
8. CLI validate 和全局问题面板接受 `pause`/`set`，拒绝节点内 `choice`，并报告 graph 出口问题。
