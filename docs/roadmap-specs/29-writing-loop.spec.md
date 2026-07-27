# Spec 29 — Writing Loop（写作主循环）

> 状态：已完成（2026-07-27）。
> 目标版本：`0.2.0`。
> 基线：`6eb3ce0b5fbffcf8ef9ed33079aeb0ab9479dd74`。
> 实施：P1 十一批全部落地；版本、模板漂移、文档、词汇与全量测试门禁均已纳入收口。
> 来源：[Review 28 §4 P1](./28-product-review-and-roadmap.md)。

## 0. 目标

P1 要让作者不离开创作者语言，就能完成一条完整路径：

1. 新建空白项目或带示例项目；
2. 在节点里写剧情、选择角色与资源、调整可视化参数并重排指令；
3. 在画布上读懂分流条件和节点内容摘要；
4. 导入与清理资源；
5. 从当前节点或当前光标位置试演，并使用不依赖界面风格的播放控制。

完成标志不是“增加了若干入口”，而是上述路径中的每个主要空态都有说明和一个主操作，编辑行为可撤销、保存后稳定，现有项目文件仍是唯一事实来源。

## 1. 范围与非目标

### 1.1 本期范围

- Scenario 编辑器二期：高亮、参数补全、当前行可视化控件、安全调序。
- 节点预览默认从节点开头开始，并可跟随 Scenario 光标。
- Studio 级播放工具条：重新开始、上一句、下一句、自动、快进。
- 图画布的句子化条件与创作者式节点摘要。
- 资产总览按钮导入、统一批量清理、引用计数说明。
- 新建项目的空白/示例模板选择。
- 仅面向刚创建空白项目的三步引导，以及可行动空态补全。
- 全仓版本同步到 `0.2.0`。

### 1.2 非目标

- 不新建脚本语言，不移除 `@instruction {…}` 无损兜底。
- 不重做默认界面风格，不把播放器能力重新实现到 renderer HUD。
- 不实现本地化、逐行语音契约、文本插值或立绘运动等 P2/P3 能力。
- 不在预览中直接修改运行时故事状态。
- 不增加顶层工作台。
- 不允许应用内 AI。
- 不让 React 直接访问项目文件系统。

## 2. 全局工程约束

### 2.1 项目数据与文件安全

- `content/graph.json`、`content/nodes/*.json`、`content/variables.json` 与 `content/manifest.json` 继续是事实来源。
- 所有文件系统读写通过已有 typed Tauri wrappers 和 Rust backend 完成。
- `initializeProject(path)` 面向任意现有目录，必须继续完整预检、拒绝覆盖，并固定使用空白初始化。
- 新建模板必须在首次写入前预检全部目标。失败不能把已有文件覆盖成半成品项目。

### 2.2 Scenario 可逆性与稳定身份

Scenario 文本是 `Instruction[]` 的可逆创作者投影，engine 的 `parseScenarioText()` / `formatScenarioText()` 是唯一 parser/formatter。

自由文本输入继续使用既有身份 reconciliation。行内控件和调序属于结构化编辑，必须走另一条路径：

1. 从 `lastValidInstructionsRef.current` 读取最后一份有效指令；
2. 通过 `updateInstruction()` 或 `moveInstruction()` 构造下一份数组；
3. 记录一次 programmatic undo checkpoint；
4. 直接更新有效 `Instruction[]`；
5. 用 `formatScenarioText(next)` 回写编辑文本；
6. 更新 dirty、draft version 与 diagnostics；
7. 不将格式后的文本再次 parse 后通过相似度猜测身份。

已有 story-point ID 在更新和移动后必须保持；插入/复制必须获得新 ID。重复文本之间的移动也不能交换身份。

### 2.3 创作者词汇

界面沿用 `docs/vocabulary.md` 的词汇：界面风格、故事状态、分流、出口效果、属性面板、资源登记表。补全列表可以显示创作者名称，但写入项目文件的必须是稳定 ID。`@set` 的可视化编辑继续复用句子化故事状态控件，不暴露程序员式赋值器。

## 3. Scenario 编辑器二期

### 3.1 高亮

高亮至少区分：

- 说话人；
- 普通指令名；
- 指令参数；
- `@set` 故事状态改变；
- 正文与辅助/注释文本；
- 无效或不完整语法。

故事状态改变不得继续只使用普通指令色。高亮层只解释文本，不拥有 parser 语义；无法识别时必须保持内容可见。

### 3.2 参数补全

命令名补全继续识别 `@` / `/` trigger。另建纯函数解析“光标当前处于哪一个参数”，至少支持：

| 上下文 | 候选来源 |
|---|---|
| 台词说话人、`@char` | `manifest.characters` |
| 台词/角色表情 | 已选角色的 expressions |
| `@bg` | backgrounds |
| `@bgm` | bgm |
| `@sfx` | sfx |
| `@voice` | voices |
| `@showCg` | cgs |
| `@playVideo` | videos |
| `@set` | 故事状态声明 |
| `@unlock` | 当前 unlock kind 对应的登记 ID |
| `@completeEnding` | ending IDs |

行为契约：

- 搜索可匹配 ID 和创作者显示名，接受后只替换当前 token 并写入 ID。
- 不完整行只要上下文可判断，也可显示候选。
- ArrowUp/ArrowDown 移动选择，Enter/Tab 接受，Escape 关闭。
- 没有候选时不伪造资源；只读模式不产生修改。

### 3.3 当前行可视化控件

可视化控件必须贴近当前 Scenario 行显示，右侧属性面板继续作为完整编辑入口。高频字段至少覆盖：

- 台词：角色、表情、自动停顿；
- 背景：资源、转场、时长；
- 角色：资源、表情、位置、时长、退场/清场；
- BGM：资源、淡入、循环；
- SFX、voice、CG、video：资源及已有关键开关；
- wait、effect、transition：类型、时长、强度；
- set：现有 `StateChangeEditor`。

全文有语法诊断，或当前行不能唯一映射到真实指令时，控件不得猜测编辑目标。

### 3.4 调序

拖拽与键盘“上移当前指令 / 下移当前指令”必须共用 `moveInstruction()`：

- 操作单位是解析后的 instruction，不是原始文本行。
- 空行可能代表隐式 pause，不能被当成无语义文本任意搬动。
- `@continue` 不是可移动指令。
- 调序后通过 formatter 重新生成阻塞帧空行与尾部 `@continue`。
- 一次拖放只产生一个 undo checkpoint。
- 解析失败、无 instruction 映射或越界时不启动调序。

## 4. 节点预览

### 4.1 默认起点

打开节点时 `previewStartIndex = null`，含义固定为“当前节点开头”，而不是标题画面或项目入口节点。不得用 `0` 重复表示相同状态。

### 4.2 跟随光标

- 默认关闭。
- 开启后，当前光标行映射到有效 instruction 时更新预览起点。
- 语法错误、无映射空行、`@continue` 或越界时，保留最后一次有效起点，不突然回到节点开头。
- 手动选择预览起点或点击“从当前行”会关闭跟随，将控制权交给作者。
- JSON 模式不提供跟随；切换后不得继续响应 Scenario selection。

## 5. Studio 级播放控制

剧情播放模式工具条提供：重新开始、上一句、下一句、自动、快进。fixture/snapshot 模式不显示这一组。

- 重新开始：`GraphNovelPlayer.restart()`。
- 上一句：作者工具的 `seekBy(-1)`；准确语义是后退一个 engine instruction step。
- 下一句：`stepOnce()`；准确语义是推进一个 engine instruction step。
- 自动：`setAutoPlay(!state.flags.isAutoPlay)`。
- 快进：`setSkipMode(state.flags.skipMode === "all" ? "off" : "all")`。

“句”是创作者按钮文案，不改写 engine playhead 的 instruction 语义。自动和快进沿用 engine 已有互斥；所有活动态从 `NovelState.flags` 推导，不建立第二份 React 布尔状态，也不建立第二个 timer loop。全文快进仍在 choice 停止。

## 6. 图画布创作者表达

### 6.1 边标签

- choice edge 保留作者写的选项文案。
- 带条件的 auto edge 使用 `collectStateSources(...)` + `describeCondition(...)` 输出句子。
- 默认 auto edge 显示“否则”。
- 无法解析的表达式原样显示，不能隐藏真实条件。
- linear edge 没有现有语义要求时不加标签。

### 6.2 节点摘要

节点卡从 `NodeEntry.data` 和 manifest 派生：

- `say` 指令数量：`N 句台词`；
- 是否含 `set`：`改变故事状态`；
- 是否存在 `ending.nodeId === node.id`：`正式结局`。

文件名和 `↑/↓` 入出度不再显示。内部仍可保留 file ID 和 degree 用于查找、布局与状态判断。起点、分支、图终点、缺失文件和已登记结局等结构/错误徽章可以保留，但创作者摘要是主要内容。

## 7. 资产总览

### 7.1 导入

总览提供“导入资产”按钮和拖放，两者必须把路径交给同一个 `planAssetDrop()`：

- image → background；
- audio → BGM；
- video → video；
- font → font；
- 未知扩展名跳过并显示反馈。

按钮使用允许上述全部扩展名的通用多文件 picker，不得继续把总览选择全部强制登记为 background。

### 7.2 批量清理

- 只保留一个全局 bulk cleanup 入口。
- proposal 不受当前分类、搜索或过滤条件截断。
- 确认前展示将清理的登记条目。
- 文案使用“清理”，并明确只移除资源登记表条目，不删除磁盘文件。
- 单张 dangling card 可以继续提供“移除引用”；它不是第二个 bulk 入口。

### 7.3 引用计数

可发现且无障碍的说明必须解释：

- “登记”：资源登记表中指向该磁盘文件的条目数；
- “剧本”：故事内容实际使用该资源的次数；
- “未使用”：资源已登记，但故事内容没有引用。

## 8. 空白与示例模板

### 8.1 Contract

前端和 Rust 共享序列化值：

```ts
export type ProjectTemplate = "blank" | "example";
```

`createProject(parentDir, name, template)` 必传；未知值由 backend 拒绝。创建表单默认空白，并说明“带示例”包含可运行的分流、故事状态、结局与资源。

### 8.2 空白模板

保持现有 blank initializer：一个章节、一个 `start` 节点、一句“新的故事从这里开始。”、空故事状态、默认界面风格和当前支持文件。

### 8.3 示例模板

示例内容来自打包的 `examples/sample-novel/content` 受控镜像，包含 graph、nodes、variables、manifest、fixtures 与 assets。

- `gal.project.json.name` 和 `content/meta.json.title` 都使用作者输入的项目名。
- 默认 renderer 从 canonical `resources/default-renderer` 复制。
- schemas/types/self-description 继续从现有权威源生成或复制。
- 不复制 sample 的 `gal.project.json`、renderer 和 `.galstudio`。
- 若引入物理镜像，必须有 drift check 阻止其与 sample content 静默分叉。
- 新建后的示例项目必须可通过 schema/CLI validation 并正常打开。

## 9. 三步引导与空态

### 9.1 触发边界

引导只由“刚通过创建表单建立的 blank 子项目”触发：

- 普通打开：不触发。
- example 创建：不触发 blank 引导。
- `initializeProject()`：不触发。
- 不根据节点数、资源数或项目是否稀疏猜测新项目。

完成/跳过信息存于 localStorage，以 canonical `project.path` 为 key；存储损坏或不可用时必须降级，不阻止项目打开。

### 9.2 三步

1. **写第一个节点**：打开 graph entry/start 节点的 Scenario 编辑器。starter node 不再等于原始一行模板时自动完成。
2. **导入一张背景**：打开资产工作台并聚焦背景导入；`manifest.backgrounds` 非空时自动完成。
3. **试演**：打开预览；实际进入/确认试演后在本地记录完成。

引导可关闭/跳过，不修改项目内容。

### 9.3 可行动空态

空态必须说明“这里能做什么”，并在有安全动作时提供一个主操作：

- 资产分类为空：导入对应资产；搜索无结果：清除搜索。
- 无角色：新建第一个角色。
- 空章节/大纲：新建节点。
- 工作区目录没有项目：新建项目。

结构错误不是空态：缺失 node 文件、无效 manifest、界面风格加载/信任错误、validation failure 保持错误或修复流程，不显示误导性创建按钮。

## 10. 验收与测试矩阵

| 能力 | 必须验证 |
|---|---|
| Scenario 高亮 | speaker/command/state-change/invalid token；不完整行不崩溃 |
| 参数补全 | 每类上下文来源、显示名搜索、稳定 ID 插入、键盘操作、无候选 |
| 行内控件 | 高频字段回写、格式可逆、ID 保持、单次 undo、诊断时禁用 |
| 调序 | 重复文本不同 ID、隐式 pause、阻塞帧、首尾边界、undo/redo、保存 payload |
| 节点预览 | 默认节点开头、有效跟随、错误时保留、手动接管、JSON 模式 |
| 播放控制 | story-only、五按钮 callback、auto/skip pressed state 与互斥 |
| 图画布 | 句子条件、否则、raw fallback、台词/状态/结局摘要、缺失数据 |
| 资产 | 总览混合导入分类、未知扩展反馈、一个全局 cleanup、计数说明与空态 |
| 模板 | 两种 shape、项目名/title、资源、未知 enum、全量 preflight/no-overwrite、drift、CLI validation |
| 引导 | 只触发 new blank、按路径持久化、三步动作/派生完成、跳过、坏 storage |
| 空态 | 每个安全 actionable state 一个主操作；错误态不被替换 |
| 发布 | 所有版本为 0.2.0；schema/types/template/doc/vocabulary/version gates 全绿 |

## 11. 提交边界

P1 必须按以下顺序独立提交，提交之间保持干净工作区：

1. P1 实施 spec；
2. 节点预览跟随光标；
3. Studio 播放控制；
4. Scenario 高亮与补全；
5. Scenario 行内控件与结构化更新；
6. Scenario 安全调序；
7. 图画布句子化与节点摘要；
8. 资产总览工作流；
9. 空白/示例模板；
10. 新项目引导与其余可行动空态；
11. `0.2.0` 文档/版本/全量门禁。

每批先补 focused tests，再实现，运行相关测试和 `git diff --check` 后提交。最后运行：

```text
pnpm test
pnpm build
pnpm check:schemas
pnpm check:engine-types
pnpm check:renderer-template
pnpm check:doc-contract
pnpm check:vocabulary
pnpm check:versions
cargo test --manifest-path packages/studio/src-tauri/Cargo.toml
```

示例模板新增的 drift check、sample engine test 和 CLI validation 也属于最终必跑门禁。
