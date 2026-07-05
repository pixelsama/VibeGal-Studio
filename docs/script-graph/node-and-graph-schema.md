# Node and Graph Schema

> 状态：完成。
> 当前契约以 [AGENTS.md](../../AGENTS.md) 和 [overview.md](./overview.md) 为准。

本文档面向外部工具/Agent 与人工编辑，说明 GalStudio 图模式项目的可写文件、数据格式和路径安全约定。

## 文件布局

一个 GalStudio 项目根目录包含：

```text
gal.project.json
AGENTS.md
.galstudio/
  README.md
  schemas/
    graph.json
    nodeFile.json
    manifest.json
    meta.json
content/
  manifest.json
  meta.json
  graph.json
  nodes/
    prologue.json
renderers/
```

`content/graph.json` 和 `content/nodes/*.json` 是项目剧本的核心文件。保存后 GalStudio 会通过项目 watcher 自动刷新，无需重启应用。

新建/初始化项目会把 Agent 指令和 schema 快照写进项目根目录。外部 Agent 的首选入口是项目内 `AGENTS.md`、`.galstudio/README.md` 和 `.galstudio/schemas/*.json`，不需要依赖 GalStudio 源码仓库路径。

旧的 `content/meta.json` `chapters` 字段和 `content/chapters/` 目录不再作为剧本入口。它们存在时会进入项目错误面板，外部 Agent 不应读取、生成或修补这些旧结构。

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
      "mode": "linear",
      "label": null,
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
| `mode` | edge | `linear` / `choice` / `auto`。旧图缺省按 `linear` 处理。 |
| `label` | edge | `choice` 出口展示给玩家的选项文本；其他模式通常为 `null`。 |
| `condition` | edge | `auto` 出口条件表达式；空值表示默认分支。 |

出口规则：

- `linear`：同一节点最多一条 outgoing edge。
- `choice`：同一节点所有 outgoing edges 都必须是 `choice`，且每条 edge 必须有非空 `label`。
- `auto`：同一节点所有 outgoing edges 都必须是 `auto`，表达式按顺序匹配；建议保留一条 `condition: null` 的默认边。
- 同一节点的 outgoing edges 不能混用 `linear` / `choice` / `auto`。

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

指令 schema 会随新项目复制到 `.galstudio/schemas/nodeFile.json`。`galstudio-cli validate . --format json` 会校验节点文件是否为 `Instruction[]`、指令结构是否符合 schema，以及 `bg` / `bgm` / `sfx` / `voice` / `char` / `say` 引用的 manifest id 是否存在；问题会以 `source: "node"` 进入 `projectIssues`，并包含 `file`、`jsonPath` 和可定位的 `nodeId`。当前可用的 `t` 判别值：

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
| `pause` | 纯画面剧情帧停点，等待玩家下一次推进 | 无 |
| `set` | 设置剧情变量，供自动出口条件使用 | `key`, `value` |

`choice` 不再是合法节点指令；分支选项必须写在 `content/graph.json` 的 outgoing edges 上。

`manifest.json` 中定义角色、背景和音频资源 id。剧本指令应引用这些 id，而不是直接写资源路径。

## 节点 Scenario Editor DSL

Studio 的节点编辑器默认显示剧本文本，但磁盘文件仍然保存为 `Instruction[]` JSON。这个文本 DSL 是可逆投影：保存时编译回节点 JSON，外部 Agent 仍可直接编辑 `content/nodes/*.json`。

基础写法：

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

DSL 规则：

- 空行分隔剧情帧。每次玩家点击/按键会推进到下一个停点。
- 同一帧内的 `@bg` / `@bgm` / `@sfx` / `@voice` / `@char` / `@effect` / `@transition` 属于舞台命令，会在同一次推进里连续应用。
- `角色ID: 文本` 编译为 `say`；普通文本行编译为 `narrate`。
- 只有舞台命令、没有文本/等待的帧会自动补一个 `{ "t": "pause" }`，用于停在纯画面状态等待玩家继续。
- `@wait 800` 是时间等待，计时结束后自动继续；`@pause` 是玩家停点，不会自动继续。
- `@set key value` 设置剧情变量；`value` 可为字符串、数字、布尔值或 `null`。
- `@choice` 和 `- 文本 -> nodeId` 在节点文本中非法；请在节点编辑页底部的“节点出口”或 `graph.json` outgoing edges 中配置分支。
- V1 不支持 `@layout`、相对坐标或 renderer layout override；精细布局属于后续能力。

## meta.json

`content/meta.json` 存放项目级播放参数和固定舞台尺寸：

```json
{
  "title": "Project Title",
  "typingSpeedCps": 30,
  "autoAdvanceMs": 1200,
  "chapterGapMs": 1500,
  "stage": { "width": 1280, "height": 720 }
}
```

`stage.width` / `stage.height` 是 galgame 的固定内部分辨率。Studio 预览会把该舞台等比缩放进当前面板，renderer 应以这个固定尺寸作为坐标系，而不是以编辑器窗口大小作为坐标系。

`galstudio-cli validate . --format json` 会校验 meta 字段类型和舞台尺寸范围；相关问题会以 `source: "meta"` 进入 `projectIssues`。

## 外部 Agent 操作流程

新增节点：

1. 写入 `content/nodes/<id>.json`，内容必须是 `Instruction[]`。
2. 更新 `content/graph.json` 的 `nodes`，加入 `{ "id", "title", "file", "position" }`。
3. 如需接入流程，更新 `edges`，加入 `{ "id", "from", "to", "mode": "linear", "label": null, "condition": null }`。
4. 保存文件。GalStudio 会自动热重载并展示最新图。

修改节点剧情：

1. 直接编辑对应的 `content/nodes/<id>.json`。
2. 保持 JSON 为数组，数组项必须符合 `.galstudio/schemas/nodeFile.json`。

删除节点：

1. 从 `content/graph.json` 的 `nodes` 移除节点。
2. 从 `edges` 移除引用该节点的边。
3. 删除对应 `content/nodes/<id>.json`，或保留为未引用草稿文件。

调整流程：

1. 修改 `content/graph.json` 的 `edges`。
2. 玩家选择使用 `mode: "choice"` + `label`；自动路由使用 `mode: "auto"` + `condition`。

## Revision 与协作安全

GalStudio 打开项目时会为关键文件返回轻量 revision：

- `projectRevision`：`gal.project.json`
- `graphRevision`：`content/graph.json`
- `manifestRevision`：`content/manifest.json`
- `metaRevision`：`content/meta.json`
- `nodeRevisions`：各 `content/nodes/*.json`

Studio 自身保存这些文件时会带上对应 revision；若外部 Agent 在此期间修改了文件，保存会返回 `write_conflict`，并保留当前草稿而不是静默覆盖。外部 Agent 仍可直接读写普通项目文件；写完后运行 `galstudio-cli validate . --format json` 即可得到结构化问题报告。

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
