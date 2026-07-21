# Spec 22 — Branch, Ending, and Variable Runtime Completion（分支、结局与变量完整化）

> 状态：规划中，待按阶段实施与主审。
> 基线：`7d6eae6`。
> 前置：[Spec 06 — Persistent Runtime Save And Restore](./archive/06-persistent-runtime-save-and-restore.spec.md)、[Spec 08 — Studio Authoring Analysis UX](./archive/08-studio-authoring-analysis-ux.spec.md)、[Spec 09 — Unlock Media Replay Runtime](./archive/09-unlock-media-replay-runtime.spec.md)、[Spec 12 — Contract-Driven Rust Validation And Backend Modularization](./archive/12-contract-driven-rust-validation-and-backend-modularization.spec.md)、[Spec 21 — Title Screen](./archive/21-title-screen.spec.md)。
> 目标：在不引入节点类型、插件节点或通用脚本 VM 的前提下，把现有 graph-first 架构扩展为可可靠创作、调试和发布多分支、多结局、变量驱动及多周目 Galgame 的完整闭环。

## 1. 背景与问题

当前项目已经具备可工作的基础能力：

- `content/graph.json` 用 `linear`、`choice`、`auto` 边表达剧情流；
- `GraphNovelPlayer` 执行图、显示选择并按 `state.vars` 判断自动分支；
- `set` 指令写入字符串、数字、布尔或 `null`；
- save slot 保存变量和决策日志，global persistent 保存已读与解锁数据；
- `manifest.unlocks.endings`、`unlock endings <id>` 和默认 Renderer 的结局列表已经可用；
- Studio 已有流程图编辑、变量静态分析、路线覆盖摘要和 Runtime Inspector。

但这些能力尚未形成可靠的作者闭环：

1. 非法条件只在 Studio 分析面板中部分可见，CLI/后端不校验；运行时会把解析失败静默当作“不命中”。
2. `auto` 分支依赖边顺序，但默认边可以排在条件边之前，Studio 也没有明确的排序交互。
3. 结局/回想注册表中的 `nodeId` 没有跨文件引用校验；“无出边终点”和“正式登记结局”容易混淆。
4. 结局登记、节点关联和解锁指令分散在不同文件，没有安全、可发现的 Studio 工作流。
5. 变量只有散落的写入与读取，没有声明、默认值、类型、说明或作用域。
6. 变量只能字面量覆盖，无法表达好感度增减或有限计算。
7. `playthroughCount` 虽已存在，但当前持久化写回会固定为 `0`；运行时没有“一周目完成”的明确、幂等语义。
8. 现有路线覆盖只做结构遍历，不能解释条件、变量赋值和正式结局收集状态。

本 spec 将这些问题按 P0、P1、P2 拆成可独立验收的阶段，而不是一次性引入复杂节点系统。

## 2. 产品与架构边界

### 2.1 必须保持的架构

1. **节点继续统一**：Graph node 仍指向一个 `Instruction[]` 文件，不新增 `story`、`ending`、`custom` 等节点类型。
2. **图结构角色继续派生**：入口、选择分支、自动分支、无出边终点、循环、孤立均由图结构计算，不写入重复的节点类型字段。
3. **正式结局继续使用注册表**：作品层面的结局身份仍由 `manifest.unlocks.endings` 表达；图终点不自动等于正式结局。
4. **Contracts 是数据契约唯一来源**：新增 schema 从 `packages/contracts` 生成，Rust backend/CLI 使用内嵌生成物，不读取项目本地 schema 作为校验依据。
5. **条件源码仍在边上**：`GraphEdge.condition` 保持字符串；可视化条件构建器只是编辑器，不增加第二份 AST 持久化源。
6. **Renderer 只消费语义**：变量运算、结局结算、周目计数由 Engine/runtime 负责；Renderer 决定提示、结局列表和最终视觉。
7. **无 In-App AI**：所有能力均通过稳定文件契约、CLI 校验、结构化问题和普通编辑 UI 提供。

### 2.2 本 spec 明确不做

- 节点类型、插件节点、自定义执行器或插件权限模型；
- 任意 JavaScript、函数调用、文件/网络访问或通用脚本 VM；
- 动态 `jump`、`call/return`、协程或并行剧情；
- 完整 SAT/SMT 求解；
- 自动把所有图终点登记为正式结局；
- 结局专属 Staff 表、片尾动画或自动回标题演出协议；这些可在后续独立 spec 中基于本 spec 的结局结算事件扩展。

## 3. 术语与最终语义

| 术语 | 定义 |
| --- | --- |
| 图终点（terminal） | 从入口可达且没有出边的节点；播放器执行完后自然停止。 |
| 正式结局（registered ending） | `manifest.unlocks.endings` 中有稳定 ID 的作品结局。 |
| 结局解锁（unlock） | 让结局出现在玩家结局列表；不代表完成一周目。 |
| 结局结算（complete ending） | 显式达成一个结局：解锁结局，并让该 run lineage 下这个 ending 首次达成时把 `playthroughCount` 增加一次。 |
| run 变量 | 属于当前 playthrough/save slot；新游戏重置，读档恢复。 |
| global 变量 | 属于项目全局进度；新游戏和读档均不回滚。 |
| 系统变量 | Runtime 提供的只读值，例如 `system.playthroughCount`。 |
| 条件顺序 | 同一节点 `auto` 出边在 `graph.edges` 中的相对顺序；第一个命中者胜出。 |

关键关系如下：

```text
graph terminal             manifest ending              completeEnding
（结构事实）               （作品登记）                  （运行时结算事件）
      │                           │                            │
      └──── 可以关联但不等同 ────┴──── 解锁 + 周目计数 ──────┘
```

一个正式结局可以关联非终点节点，一个终点也可以只是未完成占位。Studio 应提示异常组合，但不得擅自改图。

## 4. 需求—测试矩阵

以下 ID 是本 spec 的稳定验收索引。实施时测试名可以按项目惯例调整，但每项需求必须有可执行验证。

| ID | 优先级 | 受保护需求 | 最小可执行验证 |
| --- | --- | --- | --- |
| P0-R1 | P0 | TS Engine、Rust backend 和 CLI 对条件语法的接受/拒绝结果一致 | 共享 condition corpus 同时跑 TS/Rust；CLI JSON 返回 `invalid_edge_condition` |
| P0-R2 | P0 | 非法条件在运行时成为显式 route error，不再静默 false | `graphPlayerStopsOnInvalidAutoCondition` |
| P0-R3 | P0 | `auto` 默认边至多一条且必须最后 | backend/CLI + graph editor tests |
| P0-R4 | P0 | replay/ending `nodeId` 必须引用现存 graph node | manifest cross-reference tests |
| P0-R5 | P0 | 条件错误可在对应边输入框就地显示并定位 | `nodeInspectorShowsConditionDiagnostic` |
| P0-R6 | P0 | Studio 能登记、修改、取消正式结局，且不静默覆盖 manifest/node 外部修改 | revision conflict + partial failure tests |
| P0-R7 | P0 | UI 明确区分图终点和正式结局 | graph mapping/render tests |
| P0-R8 | P0 | 路线分析以正式结局 ID 为主，并单列未登记终点 | route coverage tests |
| P1-R1 | P1 | 项目可声明变量类型、默认值和说明；旧项目缺文件仍可打开 | variables schema/load compatibility tests |
| P1-R2 | P1 | 新 run 在进入入口前得到 run 变量默认值 | `graphPlayerInitializesDeclaredRunVariables` |
| P1-R3 | P1 | 变量写入表单保留明确类型，不再猜测字符串 | scenario inspector tests |
| P1-R4 | P1 | 条件构建器提供变量补全、类型约束和 raw fallback | builder parser/formatter/component tests |
| P1-R5 | P1 | 作者可调整同一节点分支顺序，键盘操作与拖拽结果一致 | outgoing edge reorder tests |
| P1-R6 | P1 | 给定模拟变量时显示每条 auto 边的 true/false/error、实际胜出边和被遮蔽边 | condition preview tests |
| P1-R7 | P1 | 可从指定节点以临时变量启动预览；调试值不写项目和玩家持久化 | preview/debug isolation tests |
| P1-R8 | P1 | Runtime Inspector 用类型化表格显示变量并可临时改值/重置 | inspector interaction tests |
| P2-R1 | P2 | `set` 支持有限、安全、确定性的表达式赋值 | expression parse/eval corpus + interpreter tests |
| P2-R2 | P2 | 表达式类型错误、缺变量和除零产生结构化 runtime error | assignment failure tests |
| P2-R3 | P2 | run/global 变量遵循各自的新游戏、存档、读档语义 | persistence matrix tests |
| P2-R4 | P2 | global 写入在同一 playthrough 内按稳定 effect ID 幂等 | load-before-effect replay test |
| P2-R5 | P2 | `completeEnding` 对同一 playthrough + ending 只结算一次；读取分歧前存档仍可结算另一 ending | completion idempotency + branch-save tests |
| P2-R6 | P2 | 新游戏产生新 playthrough ID，读档恢复原 ID，replay 不产生结算 | run identity + replay tests |
| P2-R7 | P2 | `playthroughCount`、last ending 和 global vars 正确迁移、保存且不会被固定归零 | runtime record migration tests |
| P2-R8 | P2 | 路线矩阵对每个正式结局输出 reachable/unreachable/unknown，预算耗尽不得误报 unreachable | abstract route analysis tests |
| P2-R9 | P2 | CLI 对所有确定性错误给机器可读 issue；高级不确定分析不阻断 validate | CLI exit-code/JSON tests |

## 5. 交付阶段与依赖顺序

### 阶段 A — P0 路由可靠性

- 条件 grammar parity；
- Runtime 显式条件错误；
- 默认边顺序校验；
- Node Inspector 就地诊断；
- 分支相对顺序成为稳定编辑契约。

### 阶段 B — P0 结局创作闭环

- 结局/回想 node 引用校验；
- “登记为结局”工作流；
- 图终点/正式结局的多徽标展示；
- 路线覆盖按正式结局 ID 展示。

### 阶段 C — P1 变量契约与工作台

- `content/variables.json`；
- run 默认值初始化；
- 变量工作台和类型化编辑；
- 条件构建器、分支排序和模拟预览；
- 从指定节点注入变量的调试启动。

### 阶段 D — P2 赋值表达式与作用域

- 有限表达式赋值；
- global 作用域；
- Runtime record v2 与持久副作用幂等；
- 系统变量。

### 阶段 E — P2 结局结算与周目

- `completeEnding`；
- playthrough identity；
- 周目计数、last ending、ending auto-save；
- replay/debug 对结算副作用隔离。

### 阶段 F — P2 路线矩阵与收集覆盖

- 有预算的抽象解释；
- 正式结局矩阵；
- 条件可达性与 `unknown`；
- Studio 分析 UX 和确定性 CLI diagnostics。

阶段必须按依赖顺序合入，但每个阶段内部应拆为小 PR。不得在 P0/P1 尚未可靠时先开放 global 表达式写入。

## 6. 数据契约演进

### 6.1 新增 `content/variables.json`

变量声明独立于资源 manifest 和图结构。以下是 P2 完整目标形状；阶段 C（P1）只开放 `scope: "run"`，阶段 D 才开放 `"global"`：

```json
{
  "version": 1,
  "variables": {
    "affection": {
      "type": "number",
      "default": 0,
      "scope": "run",
      "description": "女主角好感度"
    },
    "has_key": {
      "type": "boolean",
      "default": false,
      "scope": "run",
      "description": "是否取得旧校舍钥匙"
    },
    "route_completed": {
      "type": "boolean",
      "default": false,
      "scope": "global",
      "description": "是否至少完成过一次角色路线"
    },
    "nickname": {
      "type": "string",
      "default": null,
      "nullable": true,
      "scope": "run"
    }
  }
}
```

契约：

- `type`: `"string" | "number" | "boolean"`；
- `default`: 必须匹配 `type`，仅 `nullable: true` 时可为 `null`；
- `scope`: P1 先支持 `"run"`；P2 扩为 `"run" | "global"`，默认 `"run"`；
- `description`: 可选作者说明，不进入运行时计算；
- 声明名必须匹配 `[A-Za-z_][A-Za-z0-9_.]*`；`system.` 前缀保留给 Runtime；
- 声明表内名称唯一；不增加隐式别名。

兼容策略：

- 旧项目缺少该文件时，Loader 返回内存中的空 registry，绝不自动写盘；
- 新建项目初始化该文件，但不得覆盖已有同名文件；
- 未声明的旧变量继续按 run 变量运行，并报告 `undeclared_variable` warning，而不是阻断项目；
- Studio 提供“登记推断变量”操作，把现有静态分析结果显式写入 registry；不得自动登记；
- `.galstudio/schemas/variables.json`、生成 contracts、模板、示例项目和项目自描述文档同步更新。

后端 DTO 增加：

- `ProjectContent.variables: VariableRegistry`；
- `ProjectData.variablesRevision`；
- `save_variables` typed command，带 `expectedRevision`；
- `vibegal-cli validate` 读取并校验该文件。

### 6.2 `set` 指令的兼容扩展

现有字面量形式保持不变：

```json
{ "t": "set", "key": "has_key", "value": true }
```

P2 新增表达式形式；`value` 与 `expr` 必须且只能出现一个：

```json
{ "t": "set", "key": "affection", "expr": "affection + 1" }
{ "t": "set", "key": "score", "expr": "base_score + bonus * 2" }
```

当目标是 global 变量时，指令必须带稳定副作用 ID：

```json
{
  "t": "set",
  "id": "mark_route_completed",
  "key": "route_completed",
  "value": true
}
```

Scenario DSL：

```text
@set has_key true
@set affection = affection + 1
@set score = base_score + bonus * 2
```

`@set key literal` 保持旧语义；只有显式 `=` 才进入表达式解析。

global `set` 的 `id` 是非阻塞、可恢复的 post-effect story point：持久化成功后，Player 把 current story point 更新到该 ID，并让 instruction pointer 指向下一条；restore/jump 只恢复“已执行之后”的位置和当前 global 有效视图，不重放持久副作用。

### 6.3 有限表达式语法

P2 在现有条件 grammar 上增加“求值为标量”的统一能力：

- literals：string、number、boolean、`null`；
- variable reference；
- parentheses；
- unary：`!`、数值负号；
- arithmetic：`+ - * / %`，只接受 number；
- comparison：`== != > < >= <=`；
- logical：`&& ||`；
- 条件把最终值按现有 truthy 规则转换为 boolean；赋值直接使用最终标量。

约束：

- 不做字符串隐式拼接；
- 不做类型转换、函数、数组、对象、随机数或时间；
- `/ 0`、`% 0`、真正未知的变量和非数字算术均为结构化求值错误；
- 声明目标变量时，结果必须匹配声明类型/nullability；
- 为兼容旧条件中的连字符变量名，历史标识符继续可解析；新声明禁止 `-`，二元减号由 formatter 输出带空格的 `a - b`；
- Engine 与 Rust parser 必须使用共享 conformance corpus 验证接受/拒绝和变量读取集合；Rust validate 不执行剧情，但必须理解同一 grammar。

### 6.4 新增 `completeEnding` 指令

```json
{
  "t": "completeEnding",
  "id": "complete_true_end",
  "endingId": "true_end"
}
```

Scenario DSL：

```text
@completeEnding true_end
```

语义：

1. `endingId` 必须存在于 `manifest.unlocks.endings`；
2. `id` 是稳定持久副作用 ID，不能为空且在同一节点内唯一；不同节点可复用同一局部 ID，因为持久 effect key 同时包含 node ID；
3. 在正常 story playback 中，Runtime 对当前 `playthroughId` 做幂等结算；
4. 当前 `playthroughId + endingId` 第一次结算时解锁该 ending、增加 `playthroughCount`、记录 `lastEndingId` 并写 ending auto-save；
5. 同一 playthrough 再次结算同一 ending 不重复计数，并返回 already-settled；从分歧前存档走到另一 ending 可以单独结算并增加计数；
6. replay、seek、rollback rebuild、snapshot restore 和 Studio 静态预览不得重放结算副作用；
7. 指令本身不强制返回标题、不改变图路由，后续仍由节点内容和 Renderer 决定。

`completeEnding.id` 同样是非阻塞、可恢复的 post-effect story point：结算成功后才推进 checkpoint；结算失败时不得越过该点。

原有：

```json
{ "t": "unlock", "kind": "endings", "id": "true_end" }
```

继续只表示图鉴解锁，不增加周目计数。Studio 在 P2 后把“达成正式结局”的推荐操作升级为插入 `completeEnding`，并把只存在 `unlock endings` 的情况标成“仅解锁，未结算”。

### 6.5 Runtime record v2

P2 将 `RUNTIME_RECORD_SCHEMA_VERSION` 升为 `2`。

`RuntimeSnapshot` 新增：

```ts
interface RuntimeSnapshotV2 {
  playthroughId: string;
  vars: Record<string, VariableValue>; // 只保存 run/legacy-run 变量
  // 其余现有字段保持
}
```

`GlobalPersistentRecord` 新增：

```ts
interface GlobalPersistentRecordV2 {
  globalVars: Record<string, VariableValue>;
  playthroughCount: number;
  lastEndingId: string | null;
  settledEndings: Record<string, Record<string, { // playthroughId -> endingId -> settlement
    completedAt: string;
  }>>;
  appliedGlobalEffects: Record<string, string[]>; // playthroughId -> effect keys
  // readText / unlocked* 保持
}
```

语义：

- `playthroughId` 在“开始新游戏/重新开始”时创建，读档恢复原值；
- persistent effect key 至少包含 `playthroughId + nodeId + instruction.id`；同节点内重复 ID 为 error；
- global `set` 在同一 playthrough 对同一 effect key 至多生效一次，避免读取较早存档后重复累计；
- 若同一 run 通过循环再次访问该 global effect，它仍只执行一次；需要循环累计的值必须使用 run scope；
- `currentGlobalRecord()` 必须保留现有计数，禁止再次写死为 `0`；
- global variables 不进入 save slot，load 不回滚；
- `resetGlobalProgress()` 清空 global vars/effect ledger/ending settlements，并恢复声明默认值；
- future schema version 继续以 structured error 拒绝。

迁移：

- v1 save 的 `vars` 全部迁为 run vars；
- v1 global 的解锁、已读和原 `playthroughCount` 原样保留；
- 缺少 `globalVars` 时按当前 registry 的 global defaults 初始化；
- v1 slot 的 playthrough ID 必须由 `projectId + createdAt` 等稳定 slot 元数据派生，不能每次读取随机生成；
- registry 改名或类型变化导致旧值不兼容时，返回 load warning，使用声明默认值；不得崩溃或静默强制转换。

### 6.6 系统只读变量

条件和赋值表达式可读取：

- `system.playthroughCount: number`；
- `system.lastEndingId: string | null`。

约束：

- `system.` 不进入 `content/variables.json`；
- `set` 不得写入 `system.*`；
- Runtime Inspector 单独显示系统变量；
- save/load 从 GlobalPersistentRecord 重建，不把它们复制进 run vars。

### 6.7 稳定身份工具扩展

Spec 20 的稳定指令身份工作流扩展到持久副作用：

- `vibegal-cli instruction-ids assign` 为缺失 ID 的 global `set` 和 `completeEnding` 分配稳定 ID；
- Studio scenario/JSON 编辑器保存时沿用现有 missing-ID assignment 与 draft reconciliation；
- run-scope `set` 不强制 ID；global scope 根据 variables registry 判断；
- 同一节点内持久副作用 ID 重复是 `duplicate_persistent_effect_id` error；
- 这些 ID 是恢复和幂等合同，修改它们可能使旧存档无法识别原 effect，文档与 UI 必须提示。

## 7. P0 — 路由可靠性详细规格

### 7.1 条件 grammar 单源与跨语言一致性

由于安装版 `vibegal-cli validate` 必须无 Node，Rust 不能直接调用 TypeScript parser。本期采用“明确 grammar + 共享 conformance corpus”的一致性策略：

- TypeScript Engine 保持运行时 parser/evaluator；
- Rust backend 实现只用于 parse、结构校验和变量读取收集的 parser；
- `packages/contracts/fixtures/expression-corpus.json`（或等价共享 fixture）记录 valid/invalid、规范 AST/reads/evaluation cases；
- TS 与 Rust 都必须跑同一 corpus；新增语法先改 corpus，再改两个实现；
- 条件诊断统一返回边的 `file`、`jsonPath`、`nodeId`、`edgeId`。

Runtime 新增结果式 API，避免吞错：

```ts
type ConditionEvaluationResult =
  | { ok: true; value: boolean }
  | { ok: false; code: "invalid_condition"; message: string };
```

`decideGraphRoute()` 遇到无效条件时返回 route error；Renderer/runtime status 能展示错误。旧的 boolean helper 可作为兼容包装保留，但 GraphNovelPlayer 不得继续使用吞错包装。

### 7.2 自动分支顺序

稳定规则：

- 同一 `from` 的 auto 边按其在 `graph.edges` 的相对顺序执行；
- 默认边是 `condition == null` 或 trim 后为空；
- 默认边最多一条；存在时必须是该节点最后一条 auto 边；
- 多条默认边是 error；默认边不在最后也是 error；多分支没有默认边保持 warning；
- Studio 新增边或切换到 auto 时，将默认边自动放在最后，但不会无提示删除作者条件；
- reorder 只改变同一 source 的相对顺序，不改变 edge ID。

### 7.3 跨文件引用校验

`validate` 增加：

- `manifest.unlocks.replay.*.nodeId` 必须存在；
- `manifest.unlocks.endings.*.nodeId` 若存在必须指向现存 node；
- 登记 ending 的 node 有出边时给 warning，不给 error；
- ending 没有 `nodeId` 可以合法存在，P2 可由 completion instruction 定位；
- node 删除前 Studio 显示受影响 replay/ending 引用，确认后不得静默删除注册表数据。

### 7.4 条件输入就地诊断

Node Inspector 的每条 auto 边显示：

- 条件输入；
- parse 状态图标；
- 错误位置和短消息；
- 引用变量 chips；
- 默认边标签；
- 当前顺序编号。

保存策略：

- 输入草稿可暂时无效；
- 无效草稿不得自动持久化；
- 显式修复或取消后才离开；
- 外部文件刷新时沿用现有 revision conflict 语义，不覆盖本地草稿。

## 8. P0 — 结局创作闭环详细规格

### 8.1 节点菜单与 Inspector

节点右键菜单新增：

- 未登记：`登记为结局…`；
- 已关联一个 ending：`编辑结局登记…`；
- 关联多个 ending：`管理关联结局…`。

面板字段：

- ending ID；
- 标题；
- 关联节点（默认当前节点，可清空）；
- 当前节点是否图终点；
- 已检测到的 `unlock endings` / P2 `completeEnding` 位置；
- 插入位置：节点末尾、节点开头、指定 stable instruction 之后；
- 预览将发生的 manifest/node 两份改动。

写入规则：

- “保存登记”只调用 `save_manifest`；
- “插入解锁/结算指令”是单独确认动作，调用 `save_node`；
- 两步都带各自 revision，不伪装为跨文件原子事务；
- 第二步失败时保留已成功登记，明确报告 partial completion 并提供重试；
- 取消登记只删 manifest entry，不自动删剧情指令；留下的指令由 validation 报 `missing_unlock_ref` / `missing_ending_ref`；
- 不覆盖已有相同 ending ID，除非用户明确进入编辑流程。

### 8.2 多徽标而非单节点类型

Graph node 可以同时显示：

```text
[起点] [选择分支]
[图终点] [正式结局：true_end]
[循环] [警告]
```

现有单一优先级 `GraphNodeStatus` 应拆为：

- 一个严重性/边框状态；
- 多个非互斥 semantic badges。

正式结局徽标来自 manifest registry，图终点仍由出边推导。不得新增 `node.kind`。

### 8.3 按正式结局分析路线

Route Coverage 改为同时展示：

- 登记结局总数；
- 有效关联节点数；
- 各 choice/auto 分支可达的 ending ID + title；
- 可达但未登记的图终点；
- 登记但 node 缺失/不可达的结局；
- P2 后：有 `completeEnding` 的达成点和仅 unlock 的位置。

P0 的 ending reachability 以 registry `nodeId` 为主；P2 上线后以 `completeEnding` 位置为 canonical completion site，`nodeId` 继续作为导航和展示元数据。

## 9. P1 — 条件构建器与变量工作台

### 9.1 条件构建器

每条 auto 边提供 `可视化` / `源码` 两种编辑视图：

- 可视化视图只编辑 parser 能完整往返的 AST；
- 遇到暂不支持的合法源码时自动回退源码视图，不丢字符；
- 从源码切换可视化不自动格式化；只有用户确认应用才写 canonical string；
- 变量选择器优先显示 declarations，再显示推断的 legacy 变量；
- 类型决定运算符：boolean 提供 `is true/false`，number 提供数值比较，string 提供相等/不等；
- `&&`、`||` 和嵌套组可添加/删除；
- 键盘和屏幕阅读器可以完成所有操作。

### 9.2 分支排序

Node Inspector 的 outgoing 列表支持：

- 拖拽 handle；
- 上移/下移按钮；
- 默认边固定提示“最后兜底”；
- reorder 后即时更新图草稿，显式保存/现有即时保存机制按实现阶段选择；
- undo/redo 记录 reorder 为单个 graph command；
- edge ID、from、to、condition 不因排序变化。

### 9.3 变量工作台

Studio Script 工作区增加“变量”页面或右侧独立 tab：

- 声明列表、搜索、类型、默认值、scope、说明；
- 写入/读取次数和所有定位点；
- read-before-write、write-without-read、type conflict、undeclared warning；
- “从推断结果登记”操作；
- 安全重命名本期不做，避免字符串替换误伤条件；
- 删除声明前展示引用，删除后不自动删除指令。

类型化值编辑器：

- string 使用文本框并始终保持 string，输入 `true`/`123` 不自动转换；
- number 使用受控数值输入；
- boolean 使用明确选择；
- nullable 单独用“空值”切换；
- 未声明变量在编辑 `set` 时要求作者明确选择 literal 类型，不再靠 trim 后猜测。

### 9.4 条件命中预览

对选中 auto 节点提供模拟变量表：

- 初始值来自 declarations defaults；
- 作者可临时覆盖；
- 每条边显示 `true`、`false`、`error`；
- 明确标出实际第一个胜出边；
- 胜出边之后即使条件为 true，也标为“被前序分支遮蔽”；
- 没有命中且无默认边显示 route error；
- 预览不写 graph、variables 文件或 Runtime persistence。

### 9.5 从指定节点调试

完整图预览新增启动配置：

- 起点 node；
- 可选 stable instruction；
- run/global/system 的模拟值；
- reset to declarations defaults；
- 保存为 Studio 本地临时 preset 可以后续考虑，本期不写项目文件。

阶段 C（P1）只开放 run 变量；阶段 D/E 合入后同一 UI 再显示 global/system 模拟值，不提前实现假的 global 行为。

Engine 提供明确 debug launch API，而不是宿主改私有状态：

```ts
player.startDebugSession({
  nodeId,
  instructionId?,
  variableOverrides,
  suppressPersistentEffects: true,
});
```

Runtime Inspector：

- 变量表按 run/global/system 分组；
- 显示 name/type/current/default/source；
- Studio debug 模式允许临时修改与重置；
- 正式 Web/desktop Renderer 不获得任意改变量的 debug API；
- debug session 一律禁止 unlock、global set、completeEnding 等持久副作用。

阶段 C 先交付 run 分组与调试覆盖；global/system 分组在对应 P2 Runtime 能力上线后启用。

## 10. P2 — 运行时变量与持久化

### 10.1 初始化与求值顺序

正常新 run：

```text
读取 variables registry
  → run defaults
  → global persistent values/defaults
  → 注入 system read-only values
  → 进入 graph.entryNodeId
  → 执行节点指令
```

`NovelState.vars` 继续作为向后兼容的扁平“有效变量视图”，包含 run、global 和 system 的当前值，现有 Renderer 无需改读取方式。Engine 内部必须分开保存各 scope；创建 `RuntimeSnapshot` 时只提取 run/legacy-run 值，绝不能把 global/system 值复制进 save slot。global 值变化后应发布新的有效视图，使条件与 Renderer 同步更新。

条件读取统一的只读视图；同名冲突按以下规则处理：

- registry 不允许 run/global 重名；
- `system.*` 永远保留；
- legacy 未声明变量只要在任一 `set` 中存在写入点，就加入 run namespace；首次写入前保持旧行为 `null`；
- 条件/表达式引用一个既未声明、也没有任何写入点的名字时，validate 报 `undeclared_variable`，P2 Runtime 求值报 unknown-variable error；
- 缺失声明变量使用 default，不使用隐式 `undefined`。

### 10.2 赋值执行

P2 把变量赋值从简单 interpreter case 抽为可测试的纯求值步骤：

```text
state + instruction + registry + systemVars
  → resolved value / structured error
  → run state update 或 persistent global effect
```

- run set 同步更新 `NovelState.vars`；
- global set 先生成 persistent effect key，通过串行 mutation queue 写 GlobalPersistentRecord；
- global 写入和 `completeEnding` 是持久化 barrier：完成前 player 进入 waiting，失败时停止并报告结构化错误，不能假装成功；
- seek/rebuild/restore 不执行 barrier effect；
- preview/replay context 抑制 barrier effect；
- expression evaluation 完全确定，相同输入得到相同输出。

### 10.3 新游戏、重开和读档矩阵

| 操作 | playthroughId | run vars | global vars | ending/unlocks |
| --- | --- | --- | --- | --- |
| 首次开始 | 新建 | defaults | persistent/defaults | 保留 global |
| `restart()` / 从头开始 | 新建 | reset defaults | 保留 | 保留 |
| load save | 恢复 slot 中 ID | 恢复 slot | 不回滚 | 不回滚 |
| quick/auto load | 恢复 slot 中 ID | 恢复 slot | 不回滚 | 不回滚 |
| replay | 不创建正式 run | 临时隔离 | 只读 | 不写 |
| Studio debug | debug-only ID | overrides | 模拟 overlay | 不写 |
| reset global progress | 当前 run 由 UI 决定是否重开 | 不隐式修改 | reset defaults | 清空 |

### 10.4 Runtime/Renderer 合同

Renderer-facing `RuntimeServices` 增加只读进度服务：

```ts
interface ProgressService {
  getSummary(): {
    playthroughCount: number;
    lastEndingId: string | null;
    currentPlaythroughEndingIds: string[];
  };
  subscribe(listener: () => void): () => void;
}
```

Renderer 不获得直接增加周目或任意写 global variable 的 API。合同变化后必须：

- 更新 `rendererPublic.ts`；
- 运行 `generate-engine-types.mjs`；
- 通过 `pnpm check:engine-types`；
- 更新 renderer contract 文档和 default renderer 测试。

## 11. P2 — 结局结算与周目

### 11.1 结算事务

`completeEnding` 的 runtime transaction：

```text
验证 playback context = story
  → 构造 playthroughId + endingId completion key
  → 若已结算：返回 already-settled
  → unlock ending
  → 写 settledEndings
  → playthroughCount += 1
  → lastEndingId = endingId
  → 写 GlobalPersistentRecord
  → 写 auto:ending save
  → 发布 progress/gallery update
```

GlobalPersistentRecord 写入必须先成功；ending auto-save 失败时结局仍已结算，但 Runtime status 报 `ending_auto_save_failed` 并允许重试保存，不得回滚已成功的 global transaction。

`completeEnding` 虽不暂停画面，但它的 `id` 同时是可恢复 checkpoint identity。ending auto-save 必须记录“该指令已经成功执行之后”的位置；读档从其后继续，不能依赖重放结算副作用来恢复位置。

### 11.2 作者校验

P2 增加：

- `completeEnding.endingId` 缺失注册表：error；
- 稳定 `id` 缺失/重复：error 或迁移期 warning，发布前必须可自动补齐；
- 登记结局没有任何 reachable completion site：warning；
- completion site 从入口不可达：warning；
- 同一 ending 有多个 completion site：允许并展示；
- 同一 playthrough 可从分歧前存档到达并分别结算不同 ending；同一 ending 在该 playthrough 内仍保持幂等；
- 仅有 `unlock endings`：显示“可解锁但不结算”。

### 11.3 默认 Renderer 最小行为

- 结局列表继续以 gallery unlock 状态展示；
- 可选显示已完成周目总数；
- 结算成功/失败通过现有 notice/status 区域展示；
- 本 spec 不强制 Staff 表或自动回标题；
- 首次启动由 Runtime 创建初始 playthrough；显式“重新开始/新游戏”创建新 playthrough；“继续游戏/读取存档”恢复存档中的 playthrough。Spec 21 现有“回到标题 → 开始游戏”只切换 Renderer 屏幕、不 reset player 的行为保持不变，除非用户明确选择重新开始。

## 12. P2 — 路线矩阵与条件可达性

### 12.1 分析结果必须是三态

```ts
type Reachability = "reachable" | "unreachable" | "unknown";
```

- `reachable`：分析找到了至少一条满足当前抽象状态的路径；
- `unreachable`：在受支持语义和完整分析预算内证明无路径；
- `unknown`：条件、循环、状态合并或预算使结果无法证明。

任何预算耗尽、未支持表达式或类型不确定都必须升级为 `unknown`，不得误报 `unreachable`。

### 12.2 有界抽象解释

Studio analysis 使用 worklist：

1. 从 declarations defaults 或作者指定场景开始；
2. 对 literal/expression set 做常量传播；
3. 对 boolean、已知常量和简单 number interval 做抽象求值；
4. choice 边分别探索；
5. auto 边遵循 first-match：true 只走当前边，false 继续，unknown 同时探索“命中”和“继续”；
6. 到节点按变量抽象状态去重/合并；
7. 循环求 fixpoint；超过每节点状态数、全局 transition 数或时间预算时合并为 unknown；
8. 以 reachable `completeEnding` 为正式结局达成点；无 completion 时退化展示 registry node reachability，但标“未结算”。

首版只要求：

- constant propagation；
- boolean 三态；
- number constant/interval 的基础比较；
- string equality；
- unknown 合并；
- 明确预算统计。

不要求通用约束求解。

### 12.3 Studio 路线矩阵

矩阵：

- 行：正式 ending ID/title；
- 列：入口、每个 choice branch、可选作者模拟配置；
- 单元格：reachable/unreachable/unknown；
- 点击单元格显示一条 witness path 或 unknown 原因；
- 另有 collection coverage：已登记、有关联、可达、有 completion、已在玩家 global progress 解锁（调试数据可选）。

静态项目分析与玩家实际持久化数据默认分离；Studio 不读取正式导出游戏的玩家 localStorage 作为项目真相。

### 12.4 CLI 边界

`vibegal-cli validate` 必须报告所有确定性错误：

- schema/type/reference；
- condition/assignment parse；
- 默认边顺序；
- 未声明/类型不匹配；
- completion 引用/identity；
- 明确的 unreachable graph node 和 missing completion warning。

首版高级抽象路线矩阵可以仅在 Studio/TypeScript analysis 中提供；它的 `unknown` 不改变 CLI validate 退出码。若未来新增 `vibegal-cli analyze-routes`，必须另行定义稳定 JSON 输出，不得把不确定结果伪装成 validate error。

## 13. 结构化诊断代码

实施时至少稳定以下 code；文案可本地化，code 不得随 UI 文案变化：

| Code | Severity | 含义 |
| --- | --- | --- |
| `invalid_edge_condition` | error | auto 条件无法解析 |
| `auto_default_edge_not_last` | error | 默认边遮蔽后续条件 |
| `missing_replay_node_ref` | error | replay nodeId 不存在 |
| `missing_ending_node_ref` | error | ending nodeId 不存在 |
| `ending_node_has_outgoing` | warn | 登记结局关联节点不是图终点 |
| `variables_invalid` | error | variables.json 结构非法 |
| `reserved_variable_name` | error | 声明或写入 `system.*` |
| `variable_default_type_mismatch` | error | default 与声明类型不符 |
| `undeclared_variable` | warn | 条件/写入使用未声明变量 |
| `variable_write_type_mismatch` | error | 可确定的写入类型不匹配 |
| `invalid_assignment_expression` | error | set expr 无法解析 |
| `global_effect_missing_id` | error | global set 缺稳定 ID |
| `missing_ending_completion` | warn | 正式结局没有 completion site |
| `missing_ending_ref` | error | completeEnding 引用不存在 |
| `duplicate_persistent_effect_id` | error | 同一节点内持久副作用 ID 冲突 |
| `runtime_assignment_failed` | runtime error | 缺变量、类型错误或除零 |
| `runtime_persistent_effect_failed` | runtime error | global/ending 持久化失败 |
| `ending_auto_save_failed` | runtime warning | 结算已成功但 auto-save 失败 |
| `route_analysis_budget_exceeded` | analysis info | 结果降级 unknown |

所有项目问题尽量携带 `file`、`jsonPath`、`nodeId`、`edgeId`；变量问题可扩展 `variableName`，但新增 DTO 字段必须保持可选和向后兼容。

## 14. 分层实施清单

### 14.1 `packages/contracts`

- `VariableRegistrySchema` 和导出类型；
- `SetInstruction` literal/expression union；
- `CompleteEndingInstruction`；
- diagnostics metadata：registry ref、persistent effect identity；
- JSON schema 生成和 drift tests；
- expression conformance corpus。

### 14.2 `packages/engine`

- expression parser/evaluator result API；
- assignment evaluator；
- registry defaults 与 scope-aware variable store；
- GraphNovelPlayer debug start、playthrough context 和 persistent barrier；
- Runtime record v2 migration；
- `completeEnding` transaction service；
- `RuntimeServices.progress`；
- replay/seek/restore side-effect suppression。

### 14.3 Rust backend / CLI

- variables file safe load/save/revision；
- embedded variables schema；
- Rust expression parser + shared corpus；
- graph condition/default ordering diagnostics；
- ending/replay/variable/completion cross-reference validation；
- CLI JSON/exit code tests；
- initializer、项目 `.galstudio` schema 和 Agent 文档更新。

### 14.4 Studio

- Node Inspector 条件草稿、诊断、排序和模拟；
- ending registry editor + node context action + planned multi-file operation；
- graph semantic badges；
- variable workbench；
- typed set editor；
- preview launch config、debug variable overlay、Runtime Inspector table；
- registered-ending route coverage 和 bounded route matrix；
- hot reload 后保留合法 selection/draft，revision conflict 不覆盖外部修改。

### 14.5 Web/Desktop runtime 与默认 Renderer

- Web storage adapter v2 migration；
- Studio preview in-memory/project preview adapter parity；
- title/restart/load 的 playthrough ID 语义；
- progress service notice；
- engine types 和三份 default Renderer 镜像 drift；
- smoke 覆盖 choice、auto、complete ending、reload 后周目计数。

## 15. TDD 实施顺序

每一小步遵守：先确定需求 ID，增加失败测试，再改生产代码。

推荐测试切片：

1. condition corpus → TS/Rust parser → CLI issue → Studio inline error；
2. default-last backend test → graph command/reorder test → Inspector interaction；
3. registry node ref backend test → ending editor model → UI；
4. variables schema/load missing-file compatibility → initializer → save revision；
5. defaults initialization → typed editor → debug preview isolation；
6. expression corpus → evaluator → set runtime → runtime error；
7. global record v2 migration → global effect idempotence → Web reload；
8. completeEnding transaction → replay suppression → default Renderer notice；
9. abstract analysis unit tests → matrix model → UI。

禁止以源码字符串断言代替行为测试；条件构建器、结局写入和变量持久化必须测试数据结果与冲突行为。

## 16. 验收命令与发布门槛

每阶段至少执行最窄测试，再按风险运行：

```text
pnpm --filter @vibegal/contracts test
pnpm --filter @vibegal/engine test
pnpm --filter @vibegal/studio test
cargo test --manifest-path packages/studio/src-tauri/Cargo.toml
pnpm check:schemas
pnpm check:engine-types
pnpm check:renderer-template
pnpm check:doc-contract
pnpm -r build
```

阶段 E/F 发布前还必须：

- Web export smoke：选择分支、条件分支、结局结算、reload 后计数不丢；
- Desktop export smoke：同一行为；
- 安装版 `vibegal-cli validate <project> --format json` 在无 Node PATH 下返回一致 diagnostics；
- v1 save/global fixtures 迁移到 v2；
- 缺 `variables.json` 的真实旧项目可打开、预览和导出；
- default Renderer 三份镜像和项目 engine.d.ts 无漂移。

## 17. 完成定义

本 spec 只有在以下条件全部满足后才能归档：

1. P0-R1 至 P2-R9 全部映射到已通过测试；
2. CLI 不再漏报非法条件、默认边遮蔽和注册表 node 引用；
3. Studio 能在不手改 JSON 的情况下登记正式结局、配置解锁/结算点并定位问题；
4. 项目可以声明并调试 run/global 变量，旧项目仍兼容；
5. 好感度增减等有限表达式赋值在 save/load 后行为确定；
6. 同一 playthrough 反复读档不会重复结算同一 ending 或重复应用同一 global effect，但允许从分歧前存档收集不同 ending；
7. `completeEnding`、普通 unlock 和图终点三种语义在数据、Runtime 和 UI 中均清楚区分；
8. 路线矩阵对无法证明的结果诚实返回 `unknown`；
9. 项目自描述 schema/文档、CLI、Studio、Web 与 Desktop export 对同一契约达成一致。
