# Spec 09 — 安全持久化与外部协作冲突处理

> 状态：规划中。
> 前置：当前 watcher 可感知外部文件变化；`NodeEditor` 已能在未保存时提示外部更新。
> 目标：让 GalStudio 和外部 Agent 同时编辑项目文件时，减少静默覆盖和不可恢复删除。

## 1. 需求

GalStudio 的数据源是项目目录。外部 Agent、脚本和用户都可能直接修改 `content/`、`renderers/`、`gal.project.json`。
因此写入操作必须具备基本协作安全：

- 保存前检测被写文件是否自加载后发生变化。
- 冲突时不静默覆盖外部变更。
- 删除操作可恢复，至少在本地保留备份。
- graph 拖拽防抖保存不能覆盖并发新增节点/边。
- 保存失败时 UI 能保留用户草稿。
- CLI / 外部 Agent 仍直接读写普通项目文件，不引入锁服务器或 in-app AI。

## 2. 当前状态

已有能力：

- `NodeEditor` 用 `loadedTextRef`、`pendingExternalText` 提示外部更新。
- `watch_project` 对 `content/`、`renderers/`、`gal.project.json` 有 debounce。
- `save_graph`、`save_file`、`save_manifest` 都经 Rust 后端统一路径校验。

缺口：

- `save_graph` 是整体覆盖，不知道调用方基于哪个版本编辑。
- 节点删除直接 `remove_file`，失败前后没有备份/回滚。
- 资产删除也是直接删文件，然后尝试保存 manifest。
- 文件写入没有 atomic write 约定。
- 没有统一 undo/redo 动作模型。

## 3. 设计原则

- **普通文件优先**：不引入数据库，不隐藏项目真实文件。
- **轻量版本检测**：用 mtime/size/content hash，避免引入复杂锁。
- **先可恢复，再复杂合并**：第一阶段先阻止静默覆盖并保留备份，后续再做语义 merge。
- **后端拥有最终校验**：mtime/hash 校验在 Rust 命令里完成，不只靠前端判断。
- **写入保持稳定格式**：继续 pretty JSON，降低外部 diff 噪音。

## 4. 数据结构

新增文件版本描述：

```ts
export interface FileRevision {
  relPath: string;
  mtimeMs: number;
  size: number;
  sha256?: string;
}
```

后端可先实现 mtime + size；sha256 作为后续增强。

命令输入示意：

```ts
saveFile(projectPath, relPath, content, expectedRevision?)
saveGraph(projectPath, graph, expectedRevision?)
saveManifest(projectPath, manifest, expectedRevision?)
deleteFile(projectPath, relPath, expectedRevision?)
```

冲突错误建议：

```json
{
  "code": "write_conflict",
  "message": "文件已被外部修改，未覆盖：content/graph.json",
  "file": "content/graph.json",
  "currentRevision": {}
}
```

Tauri command 当前只返回 `String` error，可第一阶段用可解析中文错误；第二阶段改为结构化错误。

## 5. 实施阶段

### Stage 1：文件版本快照

后端新增：

```rust
fn file_revision(project_root: &Path, rel_path: &str) -> Result<FileRevision, String>
```

`open_project` 返回：

- `graphRevision`：`content/graph.json`
- `manifestRevision`：`content/manifest.json`
- `nodeRevisions`：按 `NodeEntry.relPath`

要求：

- 文件缺失时 revision 为 null。
- revision 路径必须通过现有 `resolve_relative_under`。

### Stage 2：保存前冲突检测

对以下命令增加 expected revision：

- `save_file`
- `save_graph`
- `save_manifest`
- `delete_file`
- `delete_asset`

检测规则：

- expected 为空时保持旧行为，用于兼容过渡。
- expected 不为空，当前 mtime/size 不同则拒绝写入。
- 文件从存在变缺失、或从缺失变存在，也视为冲突。

### Stage 3：atomic write

JSON 和文本写入改为：

1. 写入同目录临时文件。
2. flush。
3. rename 到目标路径。

目的：

- 避免外部 Agent 或 watcher 读到半截 JSON。
- 减少 Tauri 崩溃/断电导致的损坏窗口。

### Stage 4：可恢复删除

删除改为移动到：

```text
.galstudio/trash/<timestamp>/<relative-path>
```

同时写入 manifest：

```text
.galstudio/trash/<timestamp>/trash.json
```

记录：

- 原路径
- 删除时间
- 删除来源命令
- 文件大小

第一阶段不做 UI 恢复入口，但 CLI/手工可恢复。

### Stage 5：graph 语义合并

拖拽保存只修改 position，不能覆盖外部新增节点/边。

方案：

- 前端发送 patch，而不是整个 graph：

```ts
saveGraphPositions(projectPath, updates: { id: string; position: { x: number; y: number } }[], expectedRevision)
```

- 后端读取当前 `graph.json`，只更新匹配 node 的 position。
- 外部新增的 nodes/edges 保留。

后续再扩展：

- rename patch
- set entry patch
- add node patch
- delete node patch

### Stage 6：undo/redo

前端 graph reducer 动作收敛为命令：

- add node
- remove nodes
- connect
- remove edge
- rename
- move
- set entry
- auto layout

每个动作记录 inverse patch。

第一期只做 graph undo/redo；节点文本编辑依赖 textarea 浏览器 undo，不纳入统一栈。

## 6. TDD 清单

### Rust

| 测试名 | 断言 |
| --- | --- |
| `file_revision_changes_when_file_changes` | 修改文件后 revision 改变 |
| `save_file_rejects_stale_revision` | expected 旧版本 → 拒绝覆盖 |
| `save_graph_rejects_stale_revision` | graph 被外部改过 → 拒绝 |
| `write_json_is_atomic_enough_for_valid_json` | 写入成功后目标 JSON 完整可解析 |
| `delete_file_moves_to_trash` | 删除后原文件消失、trash 有备份 |
| `delete_file_rejects_stale_revision` | 被外部修改后拒绝删除 |
| `save_graph_positions_preserves_external_nodes` | position patch 不覆盖外部新增 node |

### 前端

| 测试名 | 断言 |
| --- | --- |
| `nodeEditorKeepsDraftOnWriteConflict` | 保存冲突时 textarea 内容保留 |
| `graphPositionPatchBuildsOnlyMovedNodes` | 拖拽只生成 position patch |
| `undoRedoGraphReducerRestoresPreviousGraph` | undo/redo 可恢复 graph 状态 |

## 7. UI 验收标准

1. 外部修改当前打开节点后，用户本地未保存草稿不被覆盖。
2. 用户尝试保存旧草稿时，提示“文件已被外部修改”，并提供“载入外部版本 / 另存为副本 / 强制覆盖”中的前两项。
3. 外部 Agent 新增节点时，用户拖拽另一个节点的位置不会删除外部新增节点。
4. 删除节点后，可在 `.galstudio/trash/` 找到原节点文件。
5. 保存 graph 时不会短暂产生非法 JSON 文件。

## 8. 可归档标准

本 spec 可归档的条件：

- 所有写入命令支持 revision 检测或有明确兼容豁免。
- 删除节点文件和资产文件均可恢复。
- graph position patch 替代拖拽整体覆盖。
- 关键冲突场景有 Rust 和前端单测。
- 手动验收记录覆盖“外部 Agent 同时修改”场景。

## 9. 不在本期范围

- 多用户实时协同。
- CRDT。
- Git 集成。
- 自动三方 merge 节点 JSON。
- in-app Agent 会话管理。
