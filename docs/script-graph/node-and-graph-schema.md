# Node and Graph Schema

本文档面向外部工具/Agent 与人工编辑，说明 GalStudio 图模式项目的可写文件、数据格式和路径安全约定。

## 文件布局

一个 GalStudio 项目根目录包含：

```text
gal.project.json
content/
  manifest.json
  meta.json
  graph.json
  nodes/
    prologue.json
renderers/
```

`content/graph.json` 和 `content/nodes/*.json` 是图模式的核心文件。保存后 GalStudio 会通过项目 watcher 自动刷新，无需重启应用。

## graph.json

`content/graph.json` 描述叙事结构图：

```json
{
  "version": 1,
  "entryNodeId": "prologue",
  "nodes": [
    {
      "id": "prologue",
      "title": "序章",
      "file": "nodes/prologue.json",
      "position": { "x": 120, "y": 180 }
    }
  ],
  "edges": [
    {
      "id": "prologue__ending",
      "from": "prologue",
      "to": "ending",
      "condition": null
    }
  ]
}
```

字段约定：

| 字段 | 位置 | 说明 |
| --- | --- | --- |
| `version` | root | 当前为 `1`。 |
| `entryNodeId` | root | 入口节点 id。空字符串表示未设置入口。 |
| `nodes` | root | 图节点数组。 |
| `edges` | root | 图边数组。 |
| `id` | node | 节点稳定标识，建议使用文件名友好的 kebab-case 或 snake_case。 |
| `title` | node | UI 中显示的节点标题。 |
| `file` | node | 相对 `content/` 的节点文件路径，如 `nodes/prologue.json`。 |
| `position` | node | 画布坐标，单位为 px，形如 `{ "x": 120, "y": 180 }`。 |
| `id` | edge | 边稳定标识，推荐 `<from>__<to>`。 |
| `from` / `to` | edge | 起点和终点节点 id。 |
| `condition` | edge | 当前固定写 `null`，分支条件留作后续扩展。 |

## 节点文件

节点文件就是 `Instruction[]` JSON 数组，不是对象包装。

最小示例：

```json
[
  { "t": "narrate", "text": "雨声停在窗外。" },
  { "t": "say", "who": "hero", "expr": "default", "text": "我们该出发了。" },
  { "t": "wait", "ms": 600 }
]
```

指令 schema 的唯一来源是 [packages/engine/src/schema.ts](../../packages/engine/src/schema.ts)。当前可用的 `t` 判别值：

| `t` | 用途 | 常用字段 |
| --- | --- | --- |
| `bg` | 切换背景 | `id`, `trans`, `ms` |
| `bgm` | 播放背景音乐 | `id`, `fade`, `loop` |
| `sfx` | 播放音效 | `id` |
| `voice` | 播放语音 | `id` |
| `char` | 角色立绘入场、退场或切换表情 | `id`, `pos`, `expr`, `trans`, `ms`, `clear`, `remove` |
| `say` | 角色台词 | `who`, `expr`, `text`, `ms` |
| `narrate` | 旁白 | `text`, `ms` |
| `wait` | 等待 | `ms` |
| `effect` | 舞台效果 | `type`, `intensity`, `ms` |
| `transition` | 转场 | `type`, `ms` |

`manifest.json` 中定义角色、背景和音频资源 id。剧本指令应引用这些 id，而不是直接写资源路径。

## 外部 Agent 操作流程

新增节点：

1. 写入 `content/nodes/<id>.json`，内容必须是 `Instruction[]`。
2. 更新 `content/graph.json` 的 `nodes`，加入 `{ "id", "title", "file", "position" }`。
3. 如需接入流程，更新 `edges`，加入 `{ "id", "from", "to", "condition": null }`。
4. 保存文件。GalStudio 会自动热重载并展示最新图。

修改节点剧情：

1. 直接编辑对应的 `content/nodes/<id>.json`。
2. 保持 JSON 为数组，数组项必须符合 `packages/engine/src/schema.ts`。

删除节点：

1. 从 `content/graph.json` 的 `nodes` 移除节点。
2. 从 `edges` 移除引用该节点的边。
3. 删除对应 `content/nodes/<id>.json`，或保留为未引用草稿文件。

调整流程：

1. 修改 `content/graph.json` 的 `edges`。
2. 不要把 `condition` 改成非 `null`，当前播放器尚未实现分支语义。

## 路径安全

所有 graph 节点的 `file` 都相对 `content/`。合法示例：

```text
nodes/prologue.json
nodes/act01/scene-a.json
```

不要写绝对路径、父目录跳转或 Windows 盘符路径：

```text
../../outside.json
/tmp/outside.json
C:\outside.json
```

后端会通过集中式路径防护拒绝越界路径。JSON 非法、路径越界、必填字段缺失仍是硬错误；节点文件缺失、悬空边、重复 id、入口缺失等结构一致性问题会进入 `graphReport.graphIssues`，不会阻断项目加载。

## 最小完整示例

`content/graph.json`：

```json
{
  "version": 1,
  "entryNodeId": "prologue",
  "nodes": [
    {
      "id": "prologue",
      "title": "序章",
      "file": "nodes/prologue.json",
      "position": { "x": 120, "y": 180 }
    }
  ],
  "edges": []
}
```

`content/nodes/prologue.json`：

```json
[
  { "t": "narrate", "text": "新的故事从这里开始。" }
]
```
