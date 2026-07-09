# Spec 08 — 节点内容校验接入全局报告与 CLI

> 状态：已归档。
> 前置：当前 `open_project` 已聚合 graph / asset / manifest 问题；`vibegal-cli validate` 已能输出结构化 `projectIssues`。
> 目标：把每个 `content/nodes/*.json` 的 `Instruction[]` 结构错误与资源引用错误纳入同一套问题闭环。

## 1. 需求

VibeGal-Studio 打开项目和 CLI 校验时，应能发现节点文件内部的问题，而不是只在预览播放时由 engine 抛出错误。

覆盖范围：

- 节点文件必须是 `Instruction[]`。
- 指令结构必须符合 `@vibegal/engine` 的 `InstructionSchema`。
- `bg` / `bgm` / `sfx` / `voice` / `char` / `say` 的资源引用必须存在于 manifest。
- 每个问题必须包含稳定 `code`、`message`、`severity`、`file`、`jsonPath`，能定位到指令 index。
- 问题进入 `projectReport.projectIssues`，source 使用 `"node"`。
- CLI JSON 输出也包含这些问题，并以 error 级问题返回非零退出码。

## 2. 当前状态

已有能力：

- `packages/engine/src/validate.ts` 有 `validateChapter()`、`validateReferences()`、`validateContent()`。
- `packages/studio/src-tauri/src/lib.rs` 的 `open_project_inner()` 已聚合 graph、asset、manifest 问题。
- `packages/studio/src-tauri/src/bin/cli.rs` 已复用 `open_project_for_cli()` 输出结构化问题。

缺口：

- Rust 后端没有等价的节点指令结构校验与引用校验。
- 节点内容错误只会在 `useProjectPlayer()` / `useNodePreview()` 预览链路里暴露。
- CLI 不知道具体哪个节点文件、第几条指令引用了不存在的资源。

## 3. 设计原则

- **规则单源化**：优先复用或镜像 engine schema，避免 TS 与 Rust 规则长期漂移。
- **非致命聚合**：节点内容问题进入 report，不阻断 `open_project` 返回。非法 JSON 文件仍保持现有硬错误，避免编辑器消费未知数据。
- **Agent 可读**：CLI 输出必须适合外部 Agent 解析和迭代修复。
- **不引入 in-app AI**：只增强数据契约、校验报告和 CLI。

## 4. 数据结构

`ProjectIssue.source` 新增：

```text
node
```

节点问题使用现有 `ProjectIssue` 字段：

| 字段 | 要求 |
| --- | --- |
| `severity` | 指令结构和引用错误均为 `error` |
| `source` | `"node"` |
| `code` | 稳定错误码 |
| `message` | 中文可读，含指令类型/id |
| `file` | `content/nodes/<id>.json` |
| `jsonPath` | 如 `$[3].id`、`$[5].who` |
| `nodeId` | 若能从 graph 反查到 node id，则填 |

建议错误码：

| code | 触发条件 |
| --- | --- |
| `node_not_array` | 节点文件不是 JSON 数组 |
| `instruction_unknown_type` | `t` 缺失或不是支持的指令类型 |
| `instruction_invalid_field` | 字段类型、枚举、范围不合法 |
| `missing_background_ref` | `bg.id` 不存在 |
| `missing_bgm_ref` | `bgm.id` 不存在 |
| `missing_sfx_ref` | `sfx.id` 不存在 |
| `missing_voice_ref` | `voice.id` 不存在 |
| `missing_character_ref` | `char.id` 或 `say.who` 不存在 |
| `missing_character_expr` | 角色存在但表情不存在 |

## 5. 后端实现计划

### 5.1 Rust 校验模块

在 `packages/studio/src-tauri/src/lib.rs` 中新增纯函数：

```rust
fn validate_node_contents(
    graph: &ProjectGraph,
    nodes: &[NodeEntry],
    manifest: &serde_json::Value,
) -> Vec<ProjectIssue>
```

要求：

- 只依赖传入数据，不读写磁盘。
- 对 `NodeEntry.data == None` 不重复报错，交给 graph 的 `missing_node_file`。
- manifest 结构非法时跳过引用校验，避免产生误导性二次问题；manifest 结构问题由 `validate_manifest_structure()` 报告。
- 尽量按 `graph.nodes` 顺序输出，保证 CLI diff 稳定。

### 5.2 指令结构校验

Rust 侧需要覆盖 engine 当前指令类型：

- `bg`
- `bgm`
- `sfx`
- `voice`
- `char`
- `say`
- `narrate`
- `wait`
- `effect`
- `transition`

校验策略：

- 必填字段缺失或类型错误报 `instruction_invalid_field`。
- `t` 缺失或未知报 `instruction_unknown_type`。
- 数值字段检查非负整数或区间。
- 枚举字段检查允许值。
- `say.text` / `narrate.text` 为空字符串报错，保持和 engine Zod 的 `.min(1)` 一致。

### 5.3 引用校验

引用表：

| 指令 | 字段 | manifest 位置 |
| --- | --- | --- |
| `bg` | `id` | `backgrounds` |
| `bgm` | `id` | `audio.bgm` |
| `sfx` | `id` | `audio.sfx` |
| `voice` | `id` | `audio.voice` |
| `char` | `id` / `expr` | `characters[id].sprites[expr]` |
| `say` | `who` / `expr` | `characters[who].sprites[expr]` |

### 5.4 聚合接入

在 `open_project_inner()` 聚合阶段追加：

```rust
project_issues.extend(validate_node_contents(&graph, &nodes, &manifest));
```

排序规则：

- source 顺序建议固定为 `graph` → `node` → `asset` → `manifest`。
- 同 source 下 error 先于 warn。
- 同文件按指令 index 递增。

### 5.5 CLI 输出

`ValidateOutput` 可保持现有 `projectIssues` 为主，不一定新增 `nodeIssues` 顶层字段。

可选增强：

```json
{
  "nodeIssues": []
}
```

若新增字段，必须保持 `projectIssues` 仍包含 node 问题，避免下游只读聚合字段时漏报。

## 6. 前端计划

### 6.1 全局状态面板

`StatusPanel` 已支持 source 分组，需要补充：

- `sourceLabel("node")` → `节点内容`。
- 点击带 `nodeId` 的 node issue 时跳转到对应节点编辑页。
- 若 issue 只有 `file` 没有 `nodeId`，尽量通过 `graph.nodes[].file` 前端反查。

### 6.2 节点编辑器 inline error

第一阶段可只在全局问题面板展示。

第二阶段在 `NodeEditor` 中：

- 显示当前节点的问题列表。
- 点击问题定位 textarea 到对应指令。
- 后续块级编辑器复用同一批 issue。

## 7. TDD 清单

### Rust

| 测试名 | 断言 |
| --- | --- |
| `validate_node_contents_flags_non_array_node` | 节点数据不是数组 → `node_not_array` |
| `validate_node_contents_flags_unknown_instruction_type` | 未知 `t` → `instruction_unknown_type`，jsonPath 指到 `$[0].t` |
| `validate_node_contents_flags_missing_required_field` | `say` 缺 `text` → `instruction_invalid_field` |
| `validate_node_contents_flags_invalid_enum` | `bg.trans` 非法 → `instruction_invalid_field` |
| `validate_node_contents_flags_missing_background_ref` | `bg.id` 不存在 → `missing_background_ref` |
| `validate_node_contents_flags_missing_character_expr` | 角色存在但 expr 不存在 → `missing_character_expr` |
| `open_project_aggregates_node_issues` | `projectReport` 包含 source=`node` |
| `validate_node_contents_skips_missing_node_file` | `NodeEntry.data == None` 不重复生成 node issue |

### CLI

| 测试名 | 断言 |
| --- | --- |
| `validate_cli_reports_node_instruction_error_as_json` | JSON 输出含 `source:"node"`、`file`、`jsonPath` |
| `validate_cli_exits_one_for_node_error` | 节点 error 返回 exit 1 |

### 前端

| 测试名 | 断言 |
| --- | --- |
| `sourceLabel_supports_node_issues` | 状态面板 source 分组展示“节点内容” |
| `graphFocusTargetFromIssue_handles_node_source` | node issue 可跳转到节点编辑 |

## 8. 验收标准

1. 手造 `content/nodes/start.json` 为 `{}`，UI 问题面板显示节点内容错误，CLI JSON 输出同一错误。
2. 手造 `[{ "t": "say", "who": "ghost", "text": "hi" }]`，报缺失角色引用，包含 `file` 与 `jsonPath`。
3. 手造 `bg.id` 指向不存在背景，预览不再是唯一发现路径。
4. 合法项目 `vibegal-cli validate . --format json` 输出 `ok: true`。
5. manifest 结构非法时，只报 manifest 结构错误，不额外制造大量引用错误。

## 9. 可归档标准

本 spec 可归档的条件：

- Rust、CLI、前端相关测试全部落地并通过。
- `projectReport`、CLI JSON 和 UI 问题面板都能显示节点内容问题。
- 文档更新：项目内 `.galstudio/README.md` 或 schema 说明中提到 CLI 会校验节点内容。
- 至少一个示例坏节点被手动验收并记录在 PR/提交说明中。

## 10. 不在本期范围

- 自动修复节点内容。
- 块级编辑器。
- choice/branch 语义。
- 将 TS engine schema 自动生成 Rust 校验器。
