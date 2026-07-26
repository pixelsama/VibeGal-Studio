# Spec 24 — Story State Authoring（故事状态创作面）

> 状态：已实施（2026-07-26 定稿并当日落地）。本 spec 源于 2026-07-26 与用户的复盘：
> 「目前的变量系统太程序员思维，不太适合当前产品给用户使用」「我自己用都觉得难受」。
> 目标：把变量系统从「声明类型、写布尔表达式、靠边的顺序分流」的编译器心智模型，
> 改成「记录故事里发生了什么、按故事状态分流」的创作者心智模型，同时不动引擎表达式
> 文法、`.galstudio` 契约与 CLI —— 那是外部 Agent 的接口。

## 1. 背景与动机

Spec 22 把变量系统做完整了：声明、类型、作用域、表达式、静态分析、结局可达矩阵，
技术上正确且自洽。问题不在实现，在于**它把编译器的心智模型原样搬到了界面上**。

复盘时确认的九处具体表现（均可在改动前的代码中定位）：

1. **新建变量永远叫 `variable_1`，且在 Studio 里改不掉。** `VariableWorkbench` 只能编辑
   `label`/`description`/`default`/`type`/`nullable`/`scope`，没有任何重命名入口。真实项目里
   的条件因此长成 `variable_1 >= 50`。这是最致命的一处：**没有安全重命名，等于变量一旦
   建错就永久带着**。
2. **建变量的第一个问题问错了。** 问的是「类型是文本/数值/开关」「允许未设置吗」「存储方式」；
   作者想回答的是「我要记录什么」。且 `nullable` 是纯实现概念，作者永远不需要知道。
3. **条件构建器只是把表达式换了个控件。** 下拉框直出 `==` `!=` `>=`，按钮字面写 `+ AND`/`+ OR`，
   变量下拉显示内部 key 而非 label。且极其脆弱：只接受 `变量 运算符 字面量` 的与或树，
   `has_key`（最自然的写法）、`!has_key`、`a > b` 全部掉回源码模式；没有删除子句、没有切换与/或。
4. **分流规则暴露成 if / else-if / else。** 一行一个自由文本框（placeholder「条件；留空为默认」），
   靠拖拽排序，空条件被强制钉到最后。作者必须自己理解「顺序即优先级」和「空 = 兜底」。
   诊断文案「默认边 · 最后兜底」「命中但被前序分支遮蔽」描述的是求值过程，不是该怎么办。
5. **分析面板直出编译器内部标识。** `Route Coverage` / `Variable Workbench` / `Variable Table` /
   `Auto Branches` / `Condition Parse Errors`；问题徽章直接渲染 `read_before_write` /
   `write_without_read` / `type_conflict`；分支状态直出 `default|unknown|invalid|always|never`；
   结局矩阵直出 `reachable|unreachable|unknown`。Spec 19 清过一轮词汇，唯独漏掉变量这块。
6. **缺「枚举」，导致路线状态只能用魔法字符串。** 「当前路线 = 雪线」只能声明成 string，
   再在自由文本框里手打 `"yuki"`。**打错一个字母就是永远不命中，且没有任何提示** —— 全系统
   唯一会静默出错的地方。
7. **系统变量在条件编辑器里选不到，还会误报。** `system.playthroughCount`（二周目解锁，Galgame
   标配）由运行时注入但不在 registry 里，条件下拉框没有；更糟的是 Inspector 试算与结局矩阵
   构造默认值时也只取声明变量，于是**任何用到通关次数的条件都被报成「未知变量」**。
8. **若干细节 bug 加重观感。** 布尔变量的模拟输入是文本框，要手打 `true`；`changeVariableType`
   改类型时只重置默认值，不同步已有的 `set` 和条件，静默把项目改成校验失败状态；
   `write_without_read` 对每个只做界面显示的好感度报警告，纯噪音。
9. **入口太深、且有两份重复列表。** 变量在「脚本 → 右侧 Inspector → 分析 tab → 往下滚」；
   同一面板里 `Variable Workbench`（声明）和 `Variable Table`（用量）列的是同一批变量。

另有一处独立于概念、但同样致命的观感成因：**这块界面从来没有被设计过**。项目的 token 层
（`index.css`，692 行，深浅双主题）和 `gs-*` class 层（按钮/tab/卡片/空态/骨架屏…）是齐的，
但**表单原语一个都没有**，全局也没有 `input`/`select` 样式（只加了过渡与焦点环）。而
`VariableWorkbench` 与 `ConditionBuilder` 恰恰是全 app 仅有的两个完全没手写内联样式的界面
——裸 `<input>`、裸 `<select>`、裸 `<details>`、裸 `<fieldset>/<legend>`。所以「难受」是
**概念上的程序员心智 + 观感上的未设计** 两个独立原因叠加。

## 2. 产品边界

**不动**（外部 Agent 与运行时的公共接口）：

- 引擎表达式文法（`packages/engine/src/expression.ts`）与 Rust 侧共享 parser、conformance corpus；
- `set` 指令形态（`value` 或 `expr` 二选一）；
- `.galstudio/` 契约文档、CLI 命令与退出码；
- `type` 字段：仍然必填且权威，Rust validator 与外部 Agent 的行为零变化。

**动**：

- `variables.json` 增加可选的创作意图字段（additive，见 §4）；
- 引擎增加只读派生命名空间与写入钳制；
- Studio 前端的变量/条件/分流/试算四个面，以及缺失的表单原语层。

**不做**：不引入节点类型、插件节点、通用脚本 VM；不引入 in-app AI；不引入 Tailwind 或
第三方 UI 库（token 层已完备，394 处内联样式的大迁移会淹没本次改造且不解决用户可感知的问题）。

## 3. 词汇定稿

面板名定为**「故事状态」**。作者-facing 词汇表（内部标识符、契约名、CLI 一律不变）：

| 旧文案 | 新文案 |
| --- | --- |
| Variable Workbench / Variable Table（两份） | 「故事状态」（合并为一份卡片列表） |
| 变量 | 故事状态 |
| 类型：文本 / 数值 / 开关 | 用途：是否发生 / 数值 / 状态 / 次数 / 文本 |
| 结束方式：玩家选择 / 自动判断 | 离开这个节点：让玩家选择 / 按故事状态自动分流 |
| 默认边 · 最后兜底 | 否则 |
| `affection >= 60` | 雪 · 好感度 达到 喜欢 |
| `+ AND` / `+ OR` | 全部满足 / 任一满足；行首「如果 / 并且 / 或者」 |
| 赋值方式：类型化值 / 表达式 | 把 X 增加 / 减少 / 设为 N |
| Route Coverage | 剧情覆盖 |
| reachable / unreachable / unknown | 能走到 / 走不到 / 不确定 |
| `read_before_write` | 分流用到了「X」，但整个故事里没有任何地方改变它 |
| `write_without_read` | 「X」会被改变，但没有任何分流用到它 |
| `type_conflict` | 「X」在不同地方被写成了不一样的东西 |
| 本轮变量 / 跨周目变量 / 未声明变量 | 本轮状态 / 跨周目状态 / 未登记的状态 |

原则：作者面对的一律是「用户意图词」，实现术语收进各卡片的「技术详情」折叠区。

## 4. 数据契约变更（additive）

### 4.1 `VariableDeclaration` 新增字段

```json
{
  "kind": "meter",
  "label": "好感度",
  "of": "yuki",
  "type": "number",
  "default": 0,
  "min": 0, "max": 100,
  "bands": [{ "id": "cold", "label": "冷淡", "upTo": 29 }, { "id": "love", "label": "喜欢" }],
  "scope": "run"
}
```

| 字段 | 含义 |
| --- | --- |
| `kind` | `flag` / `meter` / `state` / `counter` / `text`。**可选**，缺省时由 `type` 推断。 |
| `of` | 关联的 `manifest.characters` key，用于「雪 · 好感度」这类显示名。 |
| `min` / `max` | 写入时钳制。**缺省即无界**。 |
| `bands` | 数值分段命名。条件里存的仍是数字。 |
| `options` | `state` 的合法取值表。 |
| `displayOnly` | 只给渲染层读、不参与分流，用于消掉「没人读」的噪音警告。 |

三条约束保证零迁移成本：**`kind` 可选**（旧项目按 `type` 推断，文件不重写）、
**`type` 保留且权威**（Rust validator 与外部 Agent 零改动）、**范围缺省即无界**
（早于该字段的项目运行结果完全不变）。

`kind` 与 `type` 的对应关系由 schema 强制（`flag`↔`boolean`，`meter`/`counter`↔`number`，
`state`/`text`↔`string`），避免两者漂移。

### 4.2 决定记录

复盘中三个待定问题的结论：

1. **`kind` 落盘**，而非仅在 UI 推断。不落盘则枚举魔法字符串问题无解（唯一会静默出错的地方），
   也无处存分段命名与选项表。代价是 schema/契约/生成物的机械改动。
2. **`min`/`max` 运行时钳制**，而非仅作建议值。最初倾向「仅建议」的理由是「会静默改变已有
   项目行为」，但该理由不成立：这是全新字段，现有项目里一个都没有，不存在可被改变的既有行为。
   而表达式文法里没有 `min`/`max` 函数，不钳制等于把一个作者无法自行解决的问题留给他。
3. **`chose.*` / `seen.*` 值得动引擎**，且提到 P0。这是整套改动里唯一**减少**作者工作量的部分，
   其余都只是让同样的工作量变好看。

### 4.3 只读命名空间

`variables.json` 的变量名正则由 `^(?!system\.)` 扩为 `^(?!(?:system|chose|seen)\.)`，
占住三个由运行时拥有的前缀：

| 前缀 | 含义 |
| --- | --- |
| `system.` | 运行时事实：`playthroughCount`、`lastEndingId` |
| `chose.<edgeId>` | 玩家选过这个选项 |
| `seen.<nodeId>` | 玩家到过这个节点 |

**向前兼容说明**：`variables.json` 是 `additionalProperties: false`，新增字段意味着旧版
Studio 打不开新项目文件。0.1.0-alpha 阶段接受，需在 release note 中写明。

## 5. 引擎变更

### 5.1 用途推断与钳制（`packages/engine/src/variables.ts`）

- `variableKind(declaration)`：优先取 `kind`，否则按 `type` 推断；带 `options` 的旧 string 视为 `state`。
- `clampVariableValue(value, declaration)`：按显式范围钳制，缺省不动。
- `variableBandAt` / `variableBandLowerBound`：分段解析，供界面与条件门槛换算共用。

钳制在 `GraphNovelPlayer.resolveSetValue()` 中统一应用，run 与 global 两条写入路径共用，
避免只有一边遵守范围。

### 5.2 剧情经历（`storyExperienceVariables`）

由决策日志派生，**不落盘**：

- 图里每条 choice 边和每个节点先落一个 `false`，因此条件引用一个尚未发生的经历时是
  「不成立」，而不是求值报 `unknown_variable` 把玩家卡住；
- 只有玩家自己做的选择计入 `chose.*`；auto 分支由条件本身表达，不重复记账；
- `createSnapshot()` 排除所有只读命名空间 —— 派生值存进档只会与实际路径漂移。

### 5.3 回滚一致性

`jumpToStoryPoint()` 现在做两件事：

1. `truncateDecisionLogToNode()` 把决策日志裁剪回该节点最后一次出现处，于是回滚会自动
   un-set 之后做出的选择；
2. `stateForRollback()` 保留已积累的变量，只重算派生的经历变量。此前实现从空状态起步，
   回滚会把好感度之类的累积值一并清空，后续 auto 分支条件也会因此求值失败。

`setDebugVariable` 放开对只读命名空间的限制：调试会话里「假设玩家已经通关一周目并且选过
这个选项」正是试算要问的问题，`startDebugSession` 的 `variableOverrides` 本就允许。
非调试会话仍完全不可写。

## 6. 前端变更

### 6.1 表单原语层（新增 `features/common/Form.tsx`）

补齐项目此前缺失的一层，并由本次的句子化 UI 倒推出所需清单：

`Field`（label + 提示 + 错误 + aria 关联）、`TextInput`、`NumberInput`、`Select`（分组 +
失效值标记）、`Switch`、`SegmentedControl`、`Slider`（带分段刻度）、`Stepper`、
`SentenceRow` / `SentenceWord`（把控件排成一句可读的话）。

配套 `gs-field` / `gs-input` / `gs-switch` / `gs-segmented` / `gs-slider` / `gs-stepper` /
`gs-sentence` 系列 class。其余 394 处内联样式按既有节奏继续收敛，不为本次改造停下来做大迁移。

### 6.2 领域模型（新增 `features/script/storyState.ts`）

面板、条件编辑器、分流表共用：

- `collectStateSources()`：汇总声明变量 + 剧情经历 + 系统状态，带分组与显示名；
- `stateSourceDefaults()`：试算默认值，**覆盖只读命名空间**（修掉 §1.7 的误报）；
- `parseConditionSentence()` / `formatConditionSentence()`：表达式 ⇄ 句子的双向翻译。
  只接受扁平的同构与或链；混用 `&&`/`||`、算术、变量间比较一律返回 `null` 落回表达式模式，
  不做半吊子可视化。**新支持 `has_key` 与 `!has_key`**，并把 `== true` / `!= false` 归一
  到同一套「已发生 / 还没发生」词汇；
- `describeVariableIssue()`：issue code → 作者能照做的一句话 + 修复建议。

### 6.3 四个界面

| 组件 | 取代 | 要点 |
| --- | --- | --- |
| `StoryStatePanel` | `VariableWorkbench` + Variable Table | 一个状态一张卡，声明与用量合一，按用途分组；新建先问用途、由名称生成标识；旗标用开关、有范围的数值用带分段的滑块 |
| `ConditionEditor` | `ConditionBuilder` | 句子化；显 label；扁平「全部/任一」；按用途换控件（分段下拉 / 状态下拉 / 开关 / 数字）；可删子句 |
| `BranchRules` | `NodeInspector.ExitSection` | 「如果…否则」规则表；兜底行渲染成「否则」并固定末位；缺兜底时明确警告「玩家会卡住」；遮蔽写成人话 + 修复建议 |
| `StateChangeEditor` | `scenarioEditor` 的 `set` 分支 | 「把 X 增加/减少/设为 N」；底层仍写 `expr: "x + 3"`；手写表达式降级为「用表达式计算」折叠入口 |

`StateTrial` 统一试算面板：此前 Node Inspector 的「模拟变量」与预览页的「注入值」是两套
互不相通的实现，作者在一边调好的值到另一边就消失；现在共用同一份模型与控件。

### 6.4 遮蔽判定的修正

分流表最初实现把「按当前试算值没轮到它」也报成「永远走不到」，那样每换一组试算值就会冒出
一片假警告。最终实现区分两个独立结论：

- `winner`：按这组试算值实际会走哪条，随试算值变化；
- `problem`：与试算值无关的结构问题。只有当**前面某条恒真**（空条件，或不引用任何状态且
  求值为真）时，后面的分支才真的永远走不到。

## 7. 安全重命名（后端原子命令）

`rename_variable` 一次性改写三类文件：注册表键、图中所有 auto 边条件、所有节点文件里的
`set.key` 与 `set.expr`。

**必须在后端做**：`save_variables` / `save_graph` / `save_node` 各带独立 revision 守卫，
前端串行调用中途失败会留下半改状态 —— 条件指向一个已不存在的变量。实现上先全部读入、
改写、逐份契约校验，全部通过后才落盘。

改写用 `validation::expression::rename_identifier()`，**token 感知**而非字符串替换：

- `affection` → `love_points` 不会碰 `affection_yuki`（仅是前缀相同的另一个变量）；
- 不会碰字符串字面量 `route == "affection"`（那是数据，不是引用）；
- 保留 `!has_key`、`a.b` 等形态；改写结果仍可被 parser 接受。

## 8. 验收

| ID | 验收点 | 覆盖测试 |
| --- | --- | --- |
| R1 | 旧 registry 无 `kind` 时按 type 推断，文件不需重写 | `engine/variables.test.ts` |
| R2 | 显式范围钳制写入；无范围时行为与改动前完全一致 | `engine/variables.test.ts` |
| R3 | `chose.*`/`seen.*` 无需声明即可用于条件；auto 分支不计入 `chose` | `engine/variables.test.ts` |
| R4 | 派生经历不进存档；回滚 un-set 选择且保留累积变量 | `engine/variables.test.ts` |
| R5 | 条件句子往返：裸旗标、取反、分段门槛、状态枚举、全部/任一 | `storyState.test.ts` |
| R6 | 混用与或、算术、变量间比较落回表达式模式而非被改写 | `storyState.test.ts` |
| R7 | 试算默认值覆盖只读命名空间，不再误报「未知变量」 | `storyState.test.ts`、`BranchRules.test.tsx` |
| R8 | 兜底渲染成「否则」；缺兜底时警告；遮蔽仅在前序恒真时报 | `BranchRules.test.tsx` |
| R9 | 面板正文只出现意图词，实现术语在「技术详情」内 | `StoryStatePanel.test.tsx` |
| R10 | 重命名同时改注册表、条件与指令；冲突/未知名不留部分改动 | `backend/tests/variable_rename.rs` |
| R11 | 重命名不碰同前缀变量与字符串字面量 | `expression.rs`、`variable_rename.rs` |
| R12 | 表单原语的 aria 关联、错误播报、边界禁用 | `Form.test.tsx` |

门禁结果：`pnpm test` 1000 通过（contracts 40 / engine 155 / studio 805）、
`cargo test --lib` 213 通过、`pnpm build`、`check:schemas`、`check:engine-types`、
`check:doc-contract` 全绿。

## 9. 后续

信息架构、只读剧情检查与悬空引用报告已在
[Spec 26 — Story State IA & Story Inspection](./26-story-state-ia-and-inspection.spec.md) 落地。

仍未做：

- 边上的 `effects`：让选项直接挂「选择后：好感度 +3」，不必污染目标节点 —— 目标节点有多个
  入口时，现在的做法会误伤所有进入者；
- 其余内联样式向原语层的渐进收敛。
