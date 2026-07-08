# Spec 07 — Playback History Rollback And Skip

> 状态：已决策，待开发。
> 前置：[Spec 01](../archive/01-runtime-contract-foundation.spec.md)、[Spec 02](../archive/02-renderer-runtime-api.spec.md)、[Spec 06](./06-persistent-runtime-save-and-restore.spec.md)。
> 目标：让 backlog、rollback、read skip、all skip、voice replay 成为真正可用的播放控制能力。

## 1. 背景

V1 已有 `HistoryService`、`BacklogEntry`、`ReadTextKey`、`controls.setSkipMode()`、`controls.rollbackTo()` 的接口形状，但很多方法仍是 minimal/in-memory 或 structured unavailable。

正规 gal runtime 需要：

- 历史回看；
- 语音重播；
- 回滚到历史停点；
- 已读跳过；
- 全文跳过；
- 自动记录已读文本。

这些能力属于 runtime，不属于 Studio 的正式 UI。

## 2. 产品边界

engine/runtime 负责：

- 记录 story point cursor；
- 维护 backlog；
- 标记 read text；
- 执行 rollback；
- 执行 skip loop；
- 暴露 voice replay hook。

renderer 负责：

- backlog 菜单长什么样；
- rollback 按钮、滚轮、触屏手势；
- skip 状态如何显示。

Studio preview 可提供 debug 面板，但不实现最终游戏菜单。

## 3. V1.1 决策

- `say` / `narrate` / `pause` / `wait` 是可恢复 story point；`say` / `narrate` 进入 backlog，`pause` / `wait` 只作为 rollback/save 停点。
- read status 使用 `ReadTextKey(nodeId, instructionId, textHash)`，由 runtime 在文本 fully revealed 后标记。
- rollback 只允许回到当前 backlog 中存在且可恢复的 point；不能任意跳到未经过的未来点。
- `skipMode: "read"` 只跳过已读文本；遇到未读文本、choice、explicit pause、load warning 停止。
- `skipMode: "all"` 跳过文本，但仍在 choice、explicit pause、error 停止。
- voice replay 不推进剧情，只播放 backlog entry 的 voice cue。

## 4. 功能范围

### 4.1 Story Cursor

`GraphNovelPlayer` 需要暴露：

- current node id；
- current instruction id；
- current story point；
- last stable story point；
- current text read key。

### 4.2 Backlog

runtime 记录：

- entry id；
- story point；
- speaker name；
- text；
- voice id；
- read key；
- created order。

### 4.3 Rollback

rollback 通过 snapshot/checkpoint 或 replay 实现，不直接序列化 transient `NovelState`。

### 4.4 Skip

skip loop 需要：

- 可取消；
- 不阻塞 UI thread；
- 不无限循环；
- 尊重 choice/pause/error。

## 5. 非目标

- 不做 backlog UI。
- 不做正式快捷键布局。
- 不做触屏/手柄映射。
- 不做跨周目历史回看。

## 6. 验收标准

- `history.getBacklog()` 返回真实播放历史。
- `history.replayVoice(entryId)` 只重播语音，不推进剧情。
- `history.rollbackTo(entryId)` 恢复到对应 story point。
- `controls.setSkipMode("read")` 在未读文本处停止。
- `controls.setSkipMode("all")` 在 choice/pause 处停止。
- read status 自动写入 global persistent。

## 7. TDD 清单

| 测试名 | 断言 |
| --- | --- |
| `historyAddsBacklogForSayAndNarrate` | say/narrate 进入 backlog |
| `historyDoesNotAddPauseOnlyEntry` | pause 不进入 backlog 文本列表 |
| `readStatusMarksAfterTextRevealed` | 文本完成显示后标记 read key |
| `readSkipStopsAtUnreadLine` | 已读跳过在未读文本停止 |
| `allSkipStopsAtChoice` | 全文跳过在 choice 停止 |
| `rollbackRestoresPreviousStoryPoint` | rollback 恢复历史停点 |
| `voiceReplayDoesNotAdvanceStory` | voice replay 不改变 current state progress |
