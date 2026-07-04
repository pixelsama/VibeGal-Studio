# Spec 10 — 节点指令块编辑器

> 状态：已归档。
> 前置：节点 JSON 编辑器、插入按钮、大纲定位、单节点预览已存在。
> 目标：保留 JSON 作为高级模式，同时提供适合日常创作的块级指令编辑体验。

## 1. 需求

作者编辑节点时，不应长期依赖手写 JSON。GalStudio 需要一个结构化但不封闭的数据编辑器：

- 每条 `Instruction` 是一个可编辑块。
- 支持新增、复制、删除、拖拽排序。
- 常用字段使用合适控件：文本框、资源选择器、数字输入、下拉枚举、开关。
- 块编辑直接写回 `Instruction[]`，不引入新 DSL。
- JSON 模式保留，可查看和编辑原始数据。
- inline 显示节点内容校验问题。
- 预览仍以当前节点为单位。

## 2. 当前状态

已有能力：

- [NodeEditor](../../../packages/studio/src/features/script/NodeEditor.tsx) 以 textarea 编辑 JSON。
- `summarizeInstructions()` 能生成 say/narrate/bg/bgm 大纲。
- `insertInstructionAt()` 和 `defaultInstruction()` 支持常用插入。
- `useNodePreview()` 可播放当前节点。

缺口：

- 无字段级表单。
- 无资源选择器。
- 无拖拽排序。
- 错误定位只停留在保存失败或预览失败文本。
- JSON 与结构化视图没有双向模式切换设计。

## 3. 信息架构

节点编辑器目标布局：

```text
┌─ Node: 序章 ──────────────────────────────────────┐
│ Toolbar: [块编辑] [JSON] [保存] [预览状态]        │
├──────────────────────────────┬───────────────────┤
│ 指令流                        │ 右侧预览           │
│ 01 背景 ocean_dawn            │                   │
│ 02 BGM bgm_main               │                   │
│ 03 旁白 ...                   │                   │
│ 04 台词 hero/default ...      │                   │
└──────────────────────────────┴───────────────────┘
```

块结构：

```text
┌ say #4 ───────────────────────┐
│ 角色 [hero ▼] 表情 [default ▼] │
│ 文本 [........................]│
│ 停顿 [全局 ▼ / 1200ms]         │
│ [复制] [删除] [上移] [下移]     │
└───────────────────────────────┘
```

## 4. 指令块范围

第一期覆盖全部现有指令，但复杂字段可以简化：

| 指令 | 控件 |
| --- | --- |
| `narrate` | 多行文本、ms |
| `say` | 角色选择、表情选择、多行文本、ms |
| `bg` | 背景选择、transition、ms |
| `bgm` | BGM 选择、fade、loop |
| `sfx` | SFX 选择 |
| `voice` | voice 选择 |
| `char` | 角色选择、表情选择、位置、transition、ms、clear/remove |
| `choice` | 选项列表、文案、跳转目标 |
| `wait` | ms |
| `effect` | type、intensity、ms |
| `transition` | type、ms |

> 2026-07 更新：`choice` 已在 engine/schema 中合入，因此块编辑器也同步覆盖，而不是留到 Phase 11 之后补做。

## 5. 模式切换

编辑模式：

- `blocks`
- `json`

切换规则：

- JSON → blocks：先 `JSON.parse`，必须是数组，否则停留 JSON 并显示错误。
- blocks → JSON：从当前 instruction array pretty-print。
- 未保存状态跨模式保留。
- JSON 模式保存仍走同一套节点校验和 `saveFile`。

## 6. 数据流

新增纯函数模块：

```text
packages/studio/src/features/script/instructionEditing.ts
```

核心函数：

```ts
parseInstructionDraft(text): { ok: true; instructions } | { ok: false; error }
serializeInstructionDraft(instructions): string
updateInstruction(instructions, index, patch): Instruction[]
moveInstruction(instructions, from, to): Instruction[]
duplicateInstruction(instructions, index): Instruction[]
deleteInstruction(instructions, index): Instruction[]
```

组件建议：

```text
NodeEditor
  InstructionEditorShell
  InstructionBlockList
  InstructionBlock
  ResourceSelect
  InstructionIssueList
  JsonInstructionEditor
```

## 7. 资源选择器

资源选择器从 manifest 读取：

- backgrounds
- audio.bgm
- audio.sfx
- audio.voice
- characters
- characters[id].sprites

要求：

- 显示 id 和可读名称。
- 当前值不存在时仍显示“缺失：xxx”，不清空用户数据。
- 支持手动输入 id，以便外部 Agent 或用户稍后补资源。
- 后续可加缩略图；第一期只做文本选择。

## 8. Inline 问题显示

依赖 Phase 8 的 node issues。

表现：

- 指令块右上角显示 error 标记。
- 点击全局问题面板跳到节点后，自动滚动到对应指令。
- JSON 模式下定位到对应文本位置。

## 9. 保存策略

保存内容永远是 `Instruction[]` JSON：

```ts
JSON.stringify(instructions, null, 2)
```

保存前：

- blocks 模式直接序列化当前 instruction array。
- json 模式先 parse，必须是数组。
- 若接入 revision，则带 expected revision 调用保存。

保存后：

- 清 dirty。
- 通知 `onSaved()` 刷新 project。
- 保留当前滚动位置和选中块。

## 10. TDD 清单

### 纯函数

| 测试名 | 断言 |
| --- | --- |
| `parseInstructionDraft_accepts_array` | 合法数组解析成功 |
| `parseInstructionDraft_rejects_object` | 对象不是节点数组 |
| `updateInstruction_does_not_mutate_original` | 不可变更新 |
| `moveInstruction_reorders_items` | 拖拽排序正确 |
| `duplicateInstruction_copies_item_after_source` | 复制插入到源后 |
| `deleteInstruction_removes_item` | 删除指定 index |
| `serializeInstructionDraft_pretty_prints` | 2 空格格式稳定 |

### 组件

| 测试名 | 断言 |
| --- | --- |
| `InstructionBlock_renders_say_fields` | say 块显示角色、表情、文本 |
| `ResourceSelect_keeps_missing_current_value` | 缺失 id 不被清空 |
| `NodeEditor_switches_json_to_blocks_when_valid` | 合法 JSON 可切换 |
| `NodeEditor_refuses_blocks_when_json_invalid` | 非法 JSON 不丢草稿 |

## 11. 手动验收

1. 新建节点后，用块编辑添加背景、BGM、旁白、台词并保存。
2. 切到 JSON，确认内容仍是 `Instruction[]`。
3. 手动输入不存在角色 id，块上显示错误但不清空字段。
4. 拖拽排序后保存，重新打开顺序保持。
5. 外部修改节点时，本地未保存草稿仍被保护。

## 12. 可归档标准

本 spec 可归档的条件：

- 所有现有指令类型（含 `choice`）都有块编辑能力。
- JSON 模式和块模式可安全切换。
- 资源选择器覆盖角色、表情、背景、音频。
- 节点问题能 inline 定位到块。
- 节点文件落盘格式保持现有 `Instruction[]`。
- 关键编辑纯函数和组件行为有测试。

## 13. 不在本期范围

- 所见即所得舞台编辑。
- 复杂时间轴。
- 多选批量编辑。
- 自动补全文案。
- AI 生成剧情。
