# Spec 26 — Story State IA & Story Inspection（故事状态信息架构与剧情检查）

> 状态：已实施（2026-07-26 定稿并当日落地）。
> 来源：[Review Brief 25](./25-story-state-and-preview-review-brief.md) 的评审结论。
> 目标：Spec 24 换掉了控件与词汇，却把面板留在了原处，于是故事状态在信息架构上依然是
> 一份「分析报告」而不是创作对象 —— brief §3.1 的原话是「用户实际运行后仍然几乎感受不到
> 产品层面的变化」，这个判断准确。本 spec 修的是位置、任务模型和因果解释。

## 1. 评审结论摘要

判断成立的问题：

- **§3.2 入口过深** —— 成立，且是本轮最重要的一条。故事状态仍挂在「脚本 → Inspector →
  分析 tab → 往下滚」。词汇和控件换了、位置没换，所以体感没变。
- **§4 预览侧栏七条** —— 全部成立。其中「只读事实用输入框」和「舞台被调试器压缩」是
  结构性问题，不是样式问题。
- **§5 两套状态修改机制并存** —— 成立，这是 Spec 24 留下的：`StateTrial`（试演前假设）
  与 `RuntimeStateInspector` 的可编辑控件（运行中直接改内存）并存且无解释。

修改的用户假设：

- **§6.2 的三 tab 方案里「需要处理」被否掉。** 仓库已有全局问题面板
  （`features/common/StatusPanel.tsx` + `graphFocusTargetFromIssue()` 的点击聚焦）。
  再开一个 tab 会让问题散在三处，等于哪个都不权威。改为：**全局问题面板是唯一收件箱**。
- **§7.1 暗示需要给 `set` 发稳定 ID —— 不需要。** `assign_missing_story_point_ids` 只给
  say/narrate/wait/pause 发 ID，`assign_missing_persistent_effect_ids` 只给 global set 发，
  所以多数 `set` 没有 ID。但 `NodeEditor` 的聚焦走 `jsonPath`（`$[index]`）而非 id，而跳转
  发生在同一次预览会话内、项目文件未被改动，下标是稳定的。发 ID 要动 identity 契约、CLI 与
  外部 Agent 预期，代价远大于收益。
- **§5 拆「两种模式」方向对，但不做成模式开关。** 试演前情与运行中检查在时间上本就是先后
  关系，做成需要手动切换的模式是多余的一层。

四个待拍板决策的结论（均按推荐执行）：

1. 故事状态放**脚本工作台内的一级视图**，不做应用级第 7 个 tab —— 状态离开剧情图没有意义，
   且顶栏已有 6 项。
2. 剧情检查**彻底只读**，但配「带着现在这些值重新试演」一键逃生口。
3. run-scope 的 `set` **不发**稳定 ID（理由同上）。
4. 空态教学与独立示例项目**都要**，分工明确：空白项目只给空态教学，示例数据放进独立示例项目。

## 2. 信息架构

```text
应用顶栏（不变，仍 6 项）
[预览] [脚本] [资产] [项目] [外观] [导出]
         │
         └─ 脚本工作台：[剧情流程] [故事状态]      ← 一级切换

预览页默认 = 纯舞台，无侧栏
  ├─ [假设前情] → 开始前设置假设（只影响这次试演）
  ├─ [从这里试演]
  └─ [剧情检查] → 运行中只读解释，可关
```

「分析」tab 消失，一拆为二：

| 原内容 | 去向 |
| --- | --- |
| 诊断类（有东西坏了） | 汇入右下角全局问题面板，复用既有点击聚焦 |
| 全貌类（覆盖率、结局可达矩阵） | `RouteCoveragePanel`，收进剧情流程工具条的「剧情覆盖」按需展开 |

## 3. 故事状态视图（`StoryStateView.tsx`）

主从布局：左列按用途分组的清单（带 ⚠ 标记），右列详情。详情由两块组成：

1. `StateCard`（复用 Spec 24 的卡片，声明编辑）；
2. **「在故事里」** —— 本页面存在的理由。列出「N 处改变它」「N 处分流用到它」，每条可点，
   跳到真正该改的位置。

空态不塞示例数据，只给一句教学：「玩家的选择本身已经可以直接用在分流条件里。只有需要累积
或记住的东西才要在这里建一个。」

## 4. 剧情检查（`StoryInspection.tsx`）

取代常驻的变量监视器。三条原则：

1. **只列变化过的、以及当前分流用到的。** 没被碰过的状态和 `seen.* = false` 一律不列 ——
   全量铺开正是原面板的毛病（brief §7.3 的顾虑）。
2. **每一行都带来源和跳转**：「在「雨夜交谈」增加了 10 →」，这是它区别于变量监视器的地方。
3. **没有输入框。** 要改就去故事里改，或用逃生口带着当前值重新试演。

分流解释逐子句给出 ✓/✗ 与实际值，最后一句「因此会进入「雪线结局」」。求值走
`evaluateGraphConditionResult`（与运行时同源），句子还原复用 `storyState.ts` 的模型，
所以预览与脚本不会各有一套解释器。

一个实现细节：**胜出者是兜底（无条件）时，改为解释第一条带条件的分支**。否则作者只会看到
一片空白，而他真正想知道的是「差哪一条没满足」。

## 5. 运行时状态写入 trace

`StateWriteEvent`（`packages/engine/src/variables.ts`）：

```ts
{ variable, from, to, nodeId, instructionIndex, decisionIndex }
```

四个设计决定：

- **只存内存，不进存档。** 它是创作期调试辅助，玩家永远看不到；进存档会撑大档案并绑住
  `RUNTIME_RECORD_SCHEMA_VERSION`。
- **用数组下标而非稳定 ID**（理由见 §1）。
- **值没变就不记** —— 作者关心「哪里改了它」，不是「哪里碰过它」。
- **回滚按 `decisionIndex` 裁剪**，与 `truncateDecisionLogToNode()` 同款语义；读档时整体清空
  （trace 属于「本次运行」，读档换了一条时间线）。

写入点唯一：`applyRuntimeInstruction` 的 `set` 分支，run/global 两条路径都经过它。
`seekToInstruction` 的节点内重放**不记** trace，否则同一次改变会出现重复条目。

### 5.1 顺带修掉的一个既有 bug

补 trace 测试时发现：`seekToInstruction` 从 `buildInitialState()` 重建状态，**丢掉了变量**，
于是任何「节点内含自引用赋值（`affection + 1`）+ 往回拖播放头」的组合都会抛「未知变量」
把预览卡住。已在干净分支上复现确认为既有缺陷，非本轮引入。

修法：新增 `varsAtNodeEntry`（进入当前节点时的变量快照），重放以它为起点 —— 从空 vars 起步
会抛未知变量，从「当前」vars 起步会把增量重复叠加，两者都错。快照在 `loadGraph` /
`jumpToNode` / `restoreToNodeStart` / `applyStoryPoint` 四个入口维护。

## 6. 悬空剧情经历引用（补 Spec 24 的欠账）

`chose.<edgeId>` / `seen.<nodeId>` 是 Spec 24 新引入的引用形态：边或节点被删掉后，引用它的
条件会**静默失效**（求值恒为 false，玩家永远走不到那条分支），静态分析原本看不出来。

`collectDanglingExperienceIssues()` 补上这个缺口，产出的 issue 与故事状态诊断一起汇入全局
问题面板，点击跳到出问题的那条分流。

## 7. 契约影响

**零。** 不改 `variables.json` schema、不改指令契约、不动 CLI。唯一的类型层改动是
`ProjectIssueSource` 增加 `"variables"` —— 后端本来就在发这个 source（`validation/node.rs`
的 `undeclared_variable`），只是前端的联合类型漏了它，全局面板因此无法给它分组。

## 8. 验收

| ID | 验收点 | 覆盖测试 |
| --- | --- | --- |
| R1 | trace 记录变化位置与前后值，按顺序 | `engine/variables.test.ts` |
| R2 | 值未变不记；节点内重放不重复计数 | `engine/variables.test.ts` |
| R3 | 回滚丢弃被撤销的改变；trace 不进存档 | `engine/variables.test.ts` |
| R4 | 自引用赋值重放不再抛「未知变量」（回归） | `engine/variables.test.ts` |
| R5 | 检查面板解释来源、分段、逐子句 ✓/✗ 与胜出分支 | `StoryInspection.test.tsx` |
| R6 | 只列变化过的状态，不铺 `seen.*` | `StoryInspection.test.tsx` |
| R7 | 面板无输入框、无「重置变量」，有逃生口 | `StoryInspection.test.tsx` |
| R8 | 兜底胜出时仍解释带条件分支差在哪 | `StoryInspection.test.tsx` |
| R9 | 预览默认无侧栏、不预留侧栏列宽 | `Preview.test.tsx` |
| R10 | 故事状态诊断汇入全局面板并可跳转 | `storyStateIssues.test.ts` |
| R11 | 悬空 `chose.`/`seen.` 引用被报出 | `storyStateIssues.test.ts` |

门禁：`pnpm test` 1042 通过（contracts 40 / engine 162 / studio 840）、`cargo test --lib`
213 通过、`pnpm build`、`check:schemas`、`check:engine-types`、`check:doc-contract` 全绿。

## 9. 未做

- **边上的 `effects`**（选项直接挂「选择后：好感度 +3」）：需要新数据契约，属于新功能而非
  本轮的信息架构修复。目标节点有多个入口时，现在把 `set` 放进目标节点的做法会误伤所有
  进入者 —— 这是它值得做的理由。
- **独立示例项目**：空态教学已落地（§3），但示例项目本身是内容工作，不在代码范围内。
- 其余内联样式向原语层的渐进收敛。
