# Spec 35 — Branch Model Overhaul（分支模型重构）

- 状态：Phase 1 已实施（引擎/契约层完成，编辑器层待续）
- 目标版本：`2.0.0`
- 创建：2026-08-05
- 前置：Spec 27（出口效果）、Spec 33（交互减法）

## 0 一句话结论

当前模型把"选项"和"分支"焊死在 graph edge 的 `mode` 字段上，导致作者必须理解"节点是什么模式"才能工作，且无法表达"选项只改变量不跳转"和"同一场景按状态演出不同内容"这两类最高频需求。

本次重构将选项移入节点指令系统、将条件判断引入指令序列、将出口路由收回 NodeEditor，使每个节点的完整行为自洽于 NodeEditor 内部，图视图回归纯结构编辑器。

## 1 问题陈述

### 1.1 概念负担：mode 互斥规则

当前 `GraphEdge.mode` 有三个值（`linear` / `choice` / `auto`），同一节点的出口不能混用。作者必须先理解"这个节点是 choice 类型还是 auto 类型"才能编辑分支——这个概念在剧情创作中是不自然的。

作者的心智模型是"节点有多个出口"，不是"节点是什么模式"。

### 1.2 选项被绑定为分支

choice 模式下每条 edge 必须有 `to`（目标节点）。如果作者想做一个"只是改个变量、故事继续走同一条路"的选项——这在 galgame 里是最频繁的选项类型（选了之后 NPC 回应几句，合流回主线）——只能造多余的中间节点，或让多条 choice 边指向同一个 `to`（语义怪异）。

### 1.3 无法表达局部条件演出

当前指令序列是纯线性的，中间不能有任何条件判断。所以要实现"好感度高时台词不同、甚至有 CG"这类场景，只能拆成不同节点——但差异可能只有几句话，用图级分支让画布变得不可读。

### 1.4 节点行为被劈成两半

一个节点的完整行为被分在两处：指令序列在 NodeEditor 里，出口路由在属性面板（NodeInspector）里。作者写一个节点要在两个地方来回跳。

## 2 设计目标

1. **消除 mode 概念**：节点有多个出口就是有多个出口，不需要声明模式。
2. **选项成为演出内容**：选项是指令序列的一部分，不是图结构的属性。
3. **局部条件判断**：指令序列中可以按变量状态走不同的演出分支，然后合流。
4. **节点行为自洽**：一个节点的完整描述（从开头演出到结尾路由）全部在 NodeEditor 内。
5. **图视图回归纯结构**：画布只表示节点和出口连线，不再承载路由逻辑。

## 3 数据模型变更

### 3.1 新增指令类型

#### 3.1.1 `choice` — 选项指令

```typescript
export const ChoiceInstruction = z.strictObject({
  t: z.literal("choice"),
  id: StableInstructionIdSchema.optional(),
  prompt: z.string().nullable().optional(),       // 选项前的引导文案，可空
  options: z.array(z.object({
    text: z.string(),                               // 选项文案
    effects: z.array(SetInstruction).optional(),    // 选了之后的变量改变
    body: z.array(Instruction).optional(),          // 选了之后的局部反应演出
    to: z.string().optional(),                      // 选了之后的跳转目标（可选）
                                                     // 不填 = 不跳转，继续往下走指令序列
  })).min(1),
});
```

`body` 内的指令是嵌套的 `Instruction[]`，可以包含任何指令类型（包括嵌套 `if` 和 `choice`）。执行完 `body` 后：
- 如果 `to` 存在：跳转到目标节点（跳过出口路由求值）。
- 如果 `to` 不存在：回到 choice 指令之后，继续往下走指令序列。

`effects` 在 `body` 之前执行，因此 `body` 内的指令能看到已更新的变量值。

#### 3.1.2 `if` — 条件块指令

```typescript
export const IfInstruction = z.strictObject({
  t: z.literal("if"),
  id: StableInstructionIdSchema.optional(),
  condition: z.string(),                            // 条件表达式
  then: z.array(Instruction),                       // 条件成立时执行
  else: z.array(Instruction).optional(),            // 条件不成立时执行（可选）
});
```

执行完 `then` 或 `else` 后，继续往下走指令序列（合流）。

`then` 和 `else` 内的指令是嵌套的 `Instruction[]`，可以嵌套 `if` 和 `choice`。

#### 3.1.3 加入判别联合

`InstructionSchema` 新增两个成员：

```typescript
export const InstructionSchema = z.discriminatedUnion("t", [
  // ... 现有 17 种 ...
  ChoiceInstruction,
  IfInstruction,
]);
```

### 3.2 Edge 模型简化

#### 3.2.1 去掉 `mode` 字段

```typescript
// 重构后
export const GraphEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  condition: z.string().nullable().default(null),   // 保留
  effects: z.array(SetInstruction).optional(),      // 保留
});
```

移除 `mode`、`label`：
- `mode` — 不再需要。路由由出口数量 + condition 决定。
- `label` — 选项文案迁移到 `choice` 指令的 `options[].text`。

#### 3.2.2 路由规则简化

一个节点的出口路由规则变为：

| 出口数量 | 路由行为 |
|---------|---------|
| 0 条 | 节点结束（end） |
| 1 条 | 直接走（当前 linear 行为） |
| 多条 | 按顺序求值 `condition`，首个命中者走；无条件边（`condition: null`）= 兜底 |

不需要 mode，不需要互斥检查。

兜底规则：多条出口时至多一条 `condition: null`，引擎在求值时将其排到最后。

### 3.3 去掉图级 choice 路由

`decideGraphRoute()` 的返回值去掉 `kind: "choice"` 分支。图路由只返回 `end` / `target` / `error`。玩家选择由 `choice` 指令在节点内部处理，不再经过图路由。

`GraphRouteDecision` 变为：

```typescript
export type GraphRouteDecision =
  | { kind: "end" }
  | { kind: "target"; edge: GraphEdgeData }
  | { kind: "error"; message: string };
```

### 3.4 `chose.*` 追踪迁移

当前：`chose.<edgeId>` — 从 choice edge 派生。

重构后：`chose.<choiceInstructionId>.<optionIndex>` — 从 `choice` 指令的 `id` 和选项位置派生。`choice` 指令如果没有 `id`，不参与 `chose.*` 追踪（这对"不关心是否选过"的简单选项是合理的）。

## 4 运行时语义

### 4.1 指令执行循环

引擎的指令指针（IP）遍历指令序列。遇到 `choice`：

```
1. 收集 choice.options，构造玩家可选项
2. 呈现选项，等待玩家选择
3. 玩家选了 option[i]：
   a. 执行 option[i].effects（改变量）
   b. 记录决策日志：chose.<choiceId>.<i>（如果有 id）
   c. 执行 option[i].body（反应演出）
   d. 如果 option[i].to 存在 → 跳转到目标节点
      如果 option[i].to 不存在 → IP 继续往下（choice 指令之后）
```

遇到 `if`：

```
1. 求值 condition
2. 为真 → 依次执行 then 中的指令
   为假 → 如果有 else，依次执行 else 中的指令
3. IP 继续往下（if 指令之后）
```

### 4.2 出口路由时机

指令序列执行完毕后（IP 到达末尾），引擎看该节点的 outgoing edges：

```
0 条出口 → 节点结束（end）
1 条出口 → 直接走
多条出口 → 按顺序求值 condition，首个命中者走
          如果都没命中且无兜底边 → 报错
```

注意：如果 choice 指令的选项指定了 `to`，跳转发生在指令序列内部，出口路由不会被执行。

### 4.3 `effects` 时机不变

`edge.effects` 的执行时机保持 Spec 27 的语义：在离开来源节点、进入目标节点之前生效。条件求值和目标节点指令看到的都是新值。

## 5 编辑器交互

### 5.1 NodeEditor 中的缩进树

指令编辑器以缩进树呈现嵌套结构。受 VS Code 启发的键盘交互：

| 操作 | 行为 |
|------|------|
| 在 choice 行按回车 | 自动进入选项层级（缩进 +1） |
| 在选项标题行按回车 | 进入选项内容层级（缩进 +2） |
| 在选项内容行按回车 | 继续同一选项内加指令 |
| 退格（在选项层级的空行） | 退出 choice 块，回到主线（缩进归零） |
| Tab | 手动增加缩进层级 |
| Shift+Tab | 手动减少缩进层级 |

辅助可视化：
- **缩进辅助线**：编辑区左侧淡色竖线，标示块边界。
- **折叠**：choice / if 块可折叠，只显示标题行。
- **颜色标注**：choice 行、option 行、if/else 行用不同色调区分。

### 5.2 示例：缩进树视图

```
narrate  光照进来时，你睁开了眼。
char     protagonist center default
say      protagonist "从这里开始？"
sfx      boom

choice
    去看看那片火光
        say   NPC "你很有勇气！"
        char  NPC happy
        set   resolve + 4
        sfx   approval_ding
    留在原地
        say   NPC "也是稳妥的选择。"
        char  NPC thinking
        set   resolve - 1

narrate  不管选了什么，远处传来呼救声。
say      protagonist "得赶紧过去。"

if   affection_yuki >= 60
    char   yuki smile
    say    yuki "我也一起去！"
    showCg yuki_resolved
else
    char   yuki neutral
    say    yuki "小心点。"

narrate  你跑向了火光的方向。
```

### 5.3 NodeEditor 出口路由区块

指令序列之后，NodeEditor 底部显示"出口路由"区块（只读列出图视图中该节点的出口线）：

- **一条出口**：显示"直接前往 [目标节点名]"，无需编辑。
- **多条出口**：列出每条出口及其条件，可编辑 condition。
  - 条件为空 = 兜底，标记为"否则"。
  - 条件编辑器复用现有的 ConditionEditor / 句子化翻译。
- **零条出口**：显示"节点结束"。

出口的增删（连线 / 断线）在图视图中操作，NodeEditor 只编辑条件。

### 5.4 图视图简化

图视图变为纯结构编辑器：
- 节点卡片只显示标题 + 状态指示（内容有无）。
- 边只表示"可以通往"，不带 mode/label 标注。
- 边的 `condition` 和 `effects` 不在图视图编辑（移到 NodeEditor 出口区块 / 右键菜单）。
- 双击边 → 跳到 NodeEditor 的出口路由区块。

### 5.5 属性面板（NodeInspector）移除

属性面板的全部能力重新分配：

| 原能力 | 新位置 |
|--------|--------|
| 节点重命名 | 右键菜单 → 重命名（已有） |
| 章节分配 | 右键菜单 → 移动到章节（新增） |
| 分支规则编辑 | NodeEditor 出口区块 + choice 指令 |
| 注册结局 | 右键菜单 → 管理结局（已有） |
| 编辑结局标题 | 右键菜单 → 编辑结局标题（新增） |
| 注销结局 | 右键菜单 → 注销结局（新增） |
| 插入结局完成指令 | 右键菜单 → 插入完成指令（新增） |
| 进入编辑器 | 双击节点（已有） |
| 设为入口 | 右键菜单 → 设为入口（已有） |

三列网格布局（outline | canvas | inspector）变为两列（outline | canvas）。画布获得完整的剩余宽度。

## 6 现有数据更新

软件尚未对外发布，无需迁移逻辑、无需向后兼容。直接修改数据格式：

1. `examples/sample-novel/content/graph.json` — 手动更新为新格式：choice 边的 label/effects 迁移为节点内 choice 指令，所有 edge 去掉 `mode` 字段。
2. `examples/sample-novel/content/nodes/*.json` — 在有 choice 出口的节点中插入 choice 指令。
3. `.galstudio/schemas/*.json` — 更新 schema 文件。
4. `chose.*` 引用 — 直接改为新格式 `chose.<choiceInstructionId>.<optionIndex>`。

## 7 影响范围

### 7.1 必须修改的包

| 包/目录 | 改动 |
|---------|------|
| `packages/contracts/src/schema.ts` | 新增 `ChoiceInstruction`、`IfInstruction`；`GraphEdgeSchema` 去掉 `mode`、`label` |
| `packages/engine/src/graphRouting.ts` | `decideGraphRoute` 简化为 end/target/error；去掉 mode 检查 |
| `packages/engine/src/graphPlayer.ts` | 新增 choice 指令执行流程、if 指令执行流程；`choose()` 改为内部方法 |
| `packages/engine/src/state.ts` | `chose.*` 追踪键改为 `chose.<id>.<index>` |
| `packages/engine/src/executor.ts` | 指令执行器支持嵌套指令序列（递归执行 body/then/else） |
| `packages/studio/src/features/script/scenarioEditor.tsx` | 新增 choice / if 指令的结构化编辑 UI |
| `packages/studio/src/features/script/NodeEditor.tsx` | 底部新增出口路由区块 |
| `packages/studio/src/features/script/ScriptWorkspace.tsx` | 删除 NodeInspector 三列布局→两列 |
| `packages/studio/src/features/script/NodeInspector.tsx` | 删除 |
| `packages/studio/src/features/script/BranchRules.tsx` | 拆解：条件编辑移入 NodeEditor 出口区块，选项编辑移入 choice 指令编辑器 |
| `packages/studio/src/features/script/GraphCanvas.tsx` | 右键菜单新增章节分配、结局管理细节项；边上不再标注 mode/label |
| `packages/studio/src/index.css` | 删除 `.gs-graph-layout__inspector` 相关规则；新增缩进树样式 |
| `packages/cli/src/` | validate 更新 |

### 7.2 可保留复用的组件

以下组件不受影响，可在新位置复用：
- `ConditionEditor.tsx` — 句子化条件编辑器，移入 NodeEditor 出口区块。
- `EdgeEffectsEditor.tsx` / `StateChangeEditor.tsx` — 改变编辑器，移入 choice 选项编辑器。
- `StateTrial.tsx` — 试算组件，移入出口路由区块。
- `storyState.ts` — 条件解析 / 状态收集逻辑，`chose.*` 来源需更新。

### 7.3 必须删除的文件

- `packages/studio/src/features/script/NodeInspector.tsx`
- `packages/studio/src/features/script/NodeInspector.test.tsx`

### 7.4 必须更新的测试

- `ScriptWorkspace.test.tsx` — 移除 NodeInspector 相关断言，更新布局断言（两列）。
- `BranchRules.test.tsx` — 拆解为选项编辑器测试 + 出口条件测试。
- 引擎路由测试 — 更新 `decideGraphRoute` 测试（去掉 choice 分支）。
- 新增 `choice` 指令执行测试、`if` 指令执行测试。

## 8 执行计划

### Phase 1 — 引擎层：新增指令 + 简化路由

- 新增 `ChoiceInstruction`、`IfInstruction` schema。
- 引擎执行器支持嵌套指令序列。
- `decideGraphRoute` 重写（去掉 mode，支持无 condition 的兜底路由）。
- `GraphEdgeSchema` 直接去掉 `mode`、`label`。
- 新增测试：choice 指令执行、if 指令执行、嵌套执行。
- 更新示例故事数据。
- `chose.*` 追踪键迁移到 `chose.<choiceInstructionId>.<optionIndex>`（原计划放在 Phase 4，实际在 Phase 1 一并完成）。

> **Phase 1 实施时的妥协（务必在对应 Phase 清理，勿忘）**
>
> Phase 1 严格只动引擎/契约层，为了让前端能继续编译、把高风险编辑器子系统推迟到后续 Phase，留下了以下过渡状态。每一条都标了清理 Phase：
>
> 1. **Studio 手写 `GraphEdge` interface 仍保留可选 `mode?`/`label?`**（`packages/studio/src/lib/types.ts`）。契约的 `GraphEdgeData`（z.infer）已去字段，但 Studio 用自己的手写 interface；前端各处 `edge.mode`/`edge.label` 读取点（`BranchRules`、`graphEditing`、`graphMapping`、`graphCreatorLanguage`、`projectSearch`、`routeAnalysis`、`variableAnalysis`、`storyState`、`StoryInspection`、`useProjectPlayer` 等）暂未清理。→ **Phase 3 清理**（与「移除 BranchRules / 图视图去 mode」一并做）。
> 2. **choice/if 在场景文本编辑器里走 `@instruction {json}` 逃生路径**，没有可读缩进树（`scenario.ts` 的 `formatReadableScenarioInstruction` 对 choice/if 直接回退到 JSON）。→ **Phase 2 清理**（缩进树渲染 + VS Code 式键盘交互）。
> 3. **`seekToInstruction` / checkpoint 恢复只覆盖节点根帧**：嵌套在 `if.then`/`choice.options[].body` 里的停点（say/narrate/wait/pause/inputName/choice）目前不能被 save/restore 精确定位回嵌套帧；`isStoryPointInstruction`（contracts `validation.ts`）与 `seekToInstruction`（`graphPlayer.ts`）只扫节点顶层。→ **Phase 4 清理**（与「choice 中断点 save/restore 完整化」一并做）。当前降级表现：嵌套帧内可正常演出，但调试/预览的 playhead 与 checkpoint 不深入嵌套。
> 4. **`ScenarioInlineControls` / `ScenarioInspector` 对 choice/if 回退到原始 `t` 标题**（`scenarioEditor.tsx` 的 `inlineInstructionTitle` 给 choice/if 返回 `undefined` → 退回原始 `t`）。→ **Phase 2 清理**（结构化 choice/if 编辑器）。

### Phase 2 — 编辑器层：NodeEditor 出口区块 + choice/if 编辑器

- NodeEditor 底部新增出口路由区块。
- 场景编辑器（scenarioEditor）新增 choice / if 指令的插入和结构化编辑。
- 缩进树渲染 + VS Code 式键盘交互。
- 出口条件的 ConditionEditor 移入 NodeEditor。
- **清理 Phase 1 妥协 2、4**：choice/if 的可读缩进树文本格式（重写 `parseScenarioText` 为缩进感知、`ScenarioSelection` 携带 `path`、`formatScenarioText` 输出缩进）；`ScenarioInlineControls`/`ScenarioInspector` 补 choice/if 结构化字段编辑器。

### Phase 3 — 属性面板移除 + 图视图简化

- 移除 NodeInspector、BranchRules。
- 图视图简化（去 mode/label 标注，右键菜单补全）。
- 三列布局改两列。
- 更新所有测试。
- **清理 Phase 1 妥协 1**：删除 Studio 手写 `GraphEdge` 的 `mode?`/`label?`，清理所有 `edge.mode`/`edge.label` 读取点（改从 choice 指令 / 出口 condition 派生）。

### Phase 4 — 收尾

- 图视图从节点指令中提取 choice 选项的 `to` 连线做可视化标注。
- 文档更新（AGENTS.md、.galstudio/ schemas、创作者文档）。
- **清理 Phase 1 妥协 3**：让 `seekToInstruction`/checkpoint 恢复递归进入 `if.then`/`choice.body`，使嵌套帧内的停点可被 save/restore 精确定位（`isStoryPointInstruction` 与 `getInstructionStoryPointId` 改为递归扫描节点指令树）。

## 9 非目标

- 不改变现有 17 种指令的 schema 和行为。
- 不改变 expression 引擎的语法和求值规则。
- 不改变 renderer 运行时 API。
- 不改变存档 / 回滚 / 跳过的核心机制。
- 不引入可视化流程编排（节点仍然是原子单位，不支持子图 / 宏节点）。

## 10 后续打磨项

- **if 嵌套深度提示**：if 指令支持嵌套，过深的嵌套会让节点难以维护。后续可考虑在嵌套超过一定层数时给作者一个轻量提醒（不拦截保存）。
