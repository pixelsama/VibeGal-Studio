# Spec 31 — Genre Capabilities（品类能力）

> 状态：实施中（2026-07-27）。
> 目标版本：`0.4.0`。
> 基线：P2 `0.3.0` 收口提交。
> 来源：[Review 28 §4 P3](./28-product-review-and-roadmap.md)。

## 0. 目标

P3 补齐常见 Galgame 的表达和回看能力，同时保持旧项目零迁移可播放：

1. 一个项目可登记多种作品语言，Studio 能对照翻译，运行时有确定 fallback；
2. 台词直接绑定语音，历史回放和缺失诊断一致；
3. 文本支持安全插值、玩家命名、行内停顿、颜色和 ruby，而不是执行 HTML；
4. 角色立绘可移动、缩放、翻转、过渡，`animationAtlases` 获得可移植运行时语义；
5. 存档有缩略图和分页槽位，已解锁章节/回想可安全进入。

## 1. 兼容原则

- 所有项目契约变更优先 additive；现有 `say.text`/`narrate.text` 继续表示原文；
- 旧项目没有 `locales`、`voice`、markup、角色 transform 或新存档字段时保持现有行为；
- Zod 是唯一 schema 来源，JSON Schema、Rust validator、CLI、示例和文档同步生成/校验；
- story-point ID 继续是台词、旁白、等待、暂停、存档位置、已读状态和工具引用的稳定身份；
- 不把本地化 key、资源文件名或数组序号当作 story-point 身份；
- 不执行项目文本中的 HTML、JavaScript、CSS 或模板表达式；
- Runtime/renderer 不直接读项目文件系统，所有 locale 和资产经已校验数据进入。
- `characters.<id>.sprites.<expr>` 继续接受旧字符串路径；需要 atlas clip 时使用 `{ "atlas": "atlasId", "clip": "clipId", "fallback": "assets/hero.png" }`，不把 `atlas#clip` 之类私有字符串塞进路径字段。
- 章节安全跳读检查点使用 `graph.chapters[].checkpoint`，其形状与 runtime snapshot 的稳定终态字段一致；缺省时该章节只作为编辑分组，不自动获得跳读能力。

## 2. 本地化契约

### 2.1 项目字段

在 `content/meta.json` 增加可选语言配置：

```json
{
  "locale": {
    "default": "zh-CN",
    "available": ["zh-CN", "en"]
  }
}
```

- BCP 47 风格标签，保存前规范大小写；
- `default` 必须包含在 `available`；
- 字段缺省表示单语言旧项目，不要求 locale 文件。

`say`/`narrate` 保留必填 `text`，增加可选 `textKey`：

```json
{ "t": "say", "id": "opening-001", "who": "yuki", "text": "早上好。", "textKey": "opening.yuki.good_morning" }
```

- `text` 是项目默认语言原文，也是任何缺失情况下的最终 fallback；
- `textKey` 是显式稳定 key，不从正文自动生成；
- locale 表是平面 `Record<string,string>`，位于 `content/locales/<locale>.json`；
- 默认语言文件可选；若存在，`textKey` 的值应与 `text` 一致，CLI 可报告漂移但不阻止旧项目运行。

### 2.2 加载与 fallback

显示文本顺序固定为：

1. 当前玩家语言表中的 `textKey`；
2. 默认语言表中的 `textKey`；
3. 指令内 `text`；
4. 若文本本身无效则按现有 validation 阻止运行。

玩家语言属于 runtime settings，不属于故事状态或单个存档；载入不同存档不应切换语言。

### 2.3 Studio 与 CLI

- Studio 在现有剧本工作台内提供“翻译对照”，不新增顶层 tab；
- 左侧显示默认原文与定位，右侧选择语言并编辑译文；
- 未分配 key 的文本可显式生成稳定 key，不能静默根据正文重命名；
- 文件写入走 typed Tauri/Rust mutation，并使用 revision 冲突保护；
- CLI 按 locale、章节、节点和 story-point 报告缺失 key、缺失翻译、孤立翻译和默认文本漂移；
- 缺失翻译默认是 warning，可由现有严格构建策略升级为错误。

## 3. 逐行语音

采用 Review 28 中更明确、可诊断的方案：`say.voice?: string`。

- 值引用 `manifest.audio.voice`；
- 独立 `voice` 指令继续支持音效式或旁白前置播放，不迁移、不删除；
- 执行 `say.voice` 时，语音与该 dialogue story-point 绑定；
- 新语音开始前停止上一条 voice，行为与当前独立 voice channel 一致；
- history entry 保存 voice id；“重播语音”不能推进剧情；
- seek、rollback、save/load 不自动重复播放已经越过的语音；恢复停在当前台词时允许 renderer 提供显式重播；
- CLI 报告不存在的 voice id，并可按有台词/无语音列出缺失覆盖，但不强制所有台词配音。

Scenario 可读语法和行内控件必须支持 voice，无法表达的新字段仍保留 JSON 兜底。

## 4. 安全文本

### 4.1 插值

项目文本中的插值使用 `{状态显示名或稳定 id}`，解析时优先精确匹配稳定 id，创作者 UI 可插入显示名但写入稳定 id。

- 支持 string/number/boolean/null 的只读格式化；
- 未定义项原样显示占位并产生 runtime warning，不替换成空串；
- `{{` 与 `}}` 表示字面花括号；
- 不允许函数调用、运算、属性遍历或任意表达式；
- 同一个 formatter 用于 dialogue、backlog、存档预览、回想和 CLI preview；
- 插值后的文本参与当前显示，但已读 hash 仍以稳定原文/markup 和 story-point 为基础，避免状态变化制造无限“未读”。

创作者 UI 继续使用“故事状态”和句子化语言，不新增程序员式模板编辑器。

### 4.2 玩家命名

新增阻塞式 `inputName` 指令：

```json
{ "t": "inputName", "id": "ask-player-name", "key": "playerName", "prompt": "怎么称呼你？", "default": "旅行者", "maxLength": 20 }
```

- `key` 必须引用 `text` 用途的故事状态；玩家输入写入该状态；
- 输入属于当前 playthrough/save；若作者要跨周目保存，沿用该状态已有 scope，而不是建立私有存储；
- trim 后空值使用 default；没有 default 时保持在输入界面并提示；
- maxLength 默认 20，上限 100，按 Unicode code point 计数；
- renderer 通过明确的 pending input state 和 control callback 提交，不直接修改 vars；
- rollback 回到输入前时恢复此前状态值。

### 4.3 行内标记

采用小型结构化标记，不接受 HTML：

- `[pause=500]`：到此暂停毫秒数；
- `[color=#RRGGBB]文字[/color]`：受限颜色；
- `[ruby=读音]正文[/ruby]`：注音；
- `[b]文字[/b]`：加粗。

parser 输出纯文本片段 AST，限制嵌套深度和总片段数；颜色只接受安全 hex/已登记主题色标识。默认和 classic renderer、backlog、回想、存档预览都使用共享渲染器；未知/不完整标记按字面显示并产生诊断，不吞正文。

## 5. 角色表现与动画图集

### 5.1 `char` additive 字段

```json
{
  "t": "char",
  "id": "yuki",
  "expr": "smile",
  "pos": "center",
  "scale": 1,
  "flip": false,
  "moveFrom": "left",
  "trans": "slide",
  "ms": 600,
  "exprMs": 180
}
```

- `scale` 默认 1，范围 0.1–4；
- `flip` 默认 false；
- `moveFrom` 是可选语义槽，不是像素坐标；
- `exprMs` 控制表情资源交叉淡化，默认 0；
- save snapshot 保存最终 pos/expr/scale/flip，不保存过渡中间帧；
- rollback/load 直接恢复稳定终态；
- 不支持动画的 renderer 至少显示终态静态图，不能阻止剧情。

P3 不引入任意矩阵、骨骼脚本或 renderer 私有 transform 字符串。

### 5.2 `animationAtlases`

登记项增加可选 clips：

```json
{
  "image": "assets/yuki-atlas.webp",
  "frameWidth": 512,
  "frameHeight": 512,
  "clips": {
    "idle": { "frames": [0, 1, 2, 1], "fps": 8, "loop": true }
  }
}
```

- frame index 按行优先；
- `frames` 非空且不越过可推导网格；无法获知图片尺寸时运行时只验证非负；
- fps 范围 1–60；loop 默认 true；
- 角色 expression 可以通过统一资源引用选择 sprite 或 atlas clip；
- atlas 是渐进增强，静态 fallback 必须可用；
- save/load 记录 clip id，不记录当前帧。

Live2D/Spine、任意脚本动画和物理系统不属于 P3。

## 6. 存档、章节跳读与回想

### 6.1 缩略图与槽位

- `SavePreview` 增加可选 `thumbnail`，值是 runtime adapter 管理的 opaque asset key，不把 base64/blob 写进存档 JSON；
- runtime persistence adapter 增加可选 `writeThumbnail` / `readThumbnail` / `deleteThumbnail`，并通过可选 `captureThumbnail` service 获取图像；不支持这些能力的既有 adapter 保持可用；
- renderer 提供可选 capture service；不可用或失败时保存仍成功，只显示背景/文本 fallback；
- Web adapter 使用受配额管理的 IndexedDB/blob；桌面 adapter 使用应用数据目录，不写项目目录；
- 删除存档同时清理缩略图；孤立缩略图可安全回收；
- 存档页采用分页，每页 10 个手动槽位，至少 10 页；quick/auto 槽位保持独立命名；
- 旧 schemaVersion 记录通过既有 normalize/migration 读取，无缩略图视为正常。

### 6.2 章节跳读

- 可跳读入口来自 graph chapters 的明确 entry node；
- 默认只允许已到达章节，解锁记录进入 global persistent record；
- 新游戏可从已解锁章节开始一个新 playthrough，不覆写已有存档；
- 章节入口初始状态使用作者明确登记的 checkpoint/snapshot；没有登记时只允许项目 entry，避免猜测分支变量；
- Studio/CLI 报告不可安全跳读的章节，并提供补登记入口。

### 6.3 回想

- 继续复用 `manifest.unlocks.replay` 与现有 replay runtime，不另建平行登记表；
- 回想入口在标题/系统菜单中显示已解锁条目；
- 回想在隔离 runtime 中播放，结束返回原菜单，不修改当前 playthrough vars、存档或永久状态（显式 unlock/ending 也不二次写入）；
- 语音、富文本、locale 和立绘终态与正常播放一致。

## 7. 验收矩阵

| 能力 | 必须验证 |
|---|---|
| locale schema | 缺省旧项目、BCP47、default/available、strict unknown fields |
| fallback | current → default → inline；缺 key、缺文件、坏文件 |
| 翻译视图 | key 生成、对照编辑、revision 冲突、孤立项、文件安全 |
| CLI | 缺翻译/语音按准确节点和 story-point 报告，strict 升级 |
| voice | say 绑定、独立 voice 共存、history replay 不推进、rollback/save/load |
| 插值 | 全值类型、未定义、转义、无表达式执行、read hash 稳定 |
| markup | pause/color/ruby/b、未知/坏标记、深度/片段限制、所有视图一致 |
| 玩家名 | text 状态、空值/default、长度、提交/回滚/存读档 |
| 角色 | move/scale/flip/exprMs、静态 fallback、snapshot 终态 |
| atlas | clips、帧/fps/loop validation、fallback、save/load clip |
| 缩略图 | capture 可选、opaque key、删除清理、配额失败仍保存 |
| 章节/回想 | 解锁、checkpoint、隔离状态、返回菜单、旧记录迁移 |

## 8. 提交边界

P3 按以下顺序独立提交：

1. 本实施 spec；
2. locale/text/voice additive contracts、生成物与 Rust validator；
3. locale 加载/fallback、Studio 翻译对照与 CLI 报告；
4. say.voice、Scenario/表单和 history replay；
5. 安全插值、inline markup 和玩家命名；
6. 角色 transform/表情过渡与 animation atlas；
7. 存档缩略图/分页、章节跳读和回想；
8. `0.4.0` 文档、示例与 P3 全量门禁。

任何 runtime record schema 提升都必须在同一提交提供旧版本读取测试。每批保持工作区干净；P3 结束执行 JS、Rust、build、schema/types、两套 renderer、示例、docs、vocabulary、version 和 release smoke 全量门禁。
