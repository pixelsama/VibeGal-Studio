# Spec 27 — Exit Effects & Sample Story（出口效果与示例故事）

> 状态：已实施（2026-07-26 定稿并当日落地）。
> 来源：Spec 24 §9 / Spec 26 §9 的两项遗留。

## 1. 为什么做出口效果

作者想表达「玩家选了这个选项，好感度 +3」。此前唯一的办法是在**目标节点**里放一条 `set`。

问题在于目标节点常常是多个选项汇入的共通场景（「第二天早上」）：

```text
天台 ──「陪她留下」──┐
                     ├──▶ 第二天早上   ← set affection + 3 放在这里
天台 ──「先回去」────┘                    两条路都会加分
```

放在节点里的 `set` 对**所有入口**生效，作者却以为只有选了某个选项的人才加。这不是「不够
方便」，而是会静默产出错误剧情 —— 所以它值得做，而不只是锦上添花。

## 2. 契约变更（additive）

`GraphEdgeSchema` 增加可选的 `effects`：

```json
{
  "id": "awakening__approach",
  "from": "awakening", "to": "approach",
  "mode": "choice", "label": "去看看那片火光",
  "effects": [
    { "t": "set", "key": "resolve", "expr": "resolve + 4" },
    { "t": "set", "key": "route", "value": "protector" }
  ]
}
```

**直接复用 `SetInstruction`**，因此：

- 作者面对的句子与节点内完全一致（「把 X 增加 / 减少 / 设为」）；
- Rust validator、CLI、外部 Agent 不需要学任何新词汇；
- 表达式仍走同一套文法与同一个 parser。

字段可选，缺省即没有效果，旧项目文件零改动。

## 3. 运行时语义

- **在离开来源节点、进入目标节点之前生效。** 因此目标节点自己的指令与后续条件看到的已经是
  新值（测试锁定了这个顺序：出口 `+4` 后节点内 `*2` 得 8）。
- **choice 与 auto 两条路径共用** `applyEdgeEffects()`，不会只有一边生效。
- **遵守声明范围**：与节点内 `set` 走同一个 `resolveSetValue()`，所以 `min`/`max` 钳制一致。
- **赋值失败即停在错误上**，不会带着半套状态继续推进。
- **计入状态写入 trace，且归属到出口**（`edgeId` 有值、`instructionIndex` 为空），于是剧情
  检查能说「因为选了这个选项」而不是指向某条指令。回滚同样按 `decisionIndex` 丢弃。

## 4. 必须同步的四处

一个新的引用位置意味着所有「扫描 `set`」的代码都要跟上，否则会静默错：

| 位置 | 不改会怎样 |
| --- | --- |
| `rename_variable`（Rust） | 改名后出口效果仍写向旧名字，指向一个不存在的状态 |
| `analyzeGraphVariables` | 只被出口效果改变的状态会被误报「没有任何地方改变它」 |
| `routeAnalysis` 静态推演 | 结局可达矩阵漏掉「靠选项加分才够格」的路线 |
| `normalizeBranchEdge` | 切换「玩家选择 / 自动分流」时把作者写好的效果丢掉 |

前三处已改并各有测试；第四处经检查本来就正确（spread 保留字段），补测试锁定。

重命名的返回值把出口效果单独计数（`updatedEdgeEffects`），而不是混进
`updatedConditions` —— 向作者交代「改了什么」时两者不是一回事。

## 5. 界面

`EdgeEffectsEditor` 挂在分流规则表的每一行下方，空态是一个按钮：**「走这条之后…」**。
展开后复用 `StateChangeEditor`，所以句子与节点内的状态改变完全一致。

新建效果的初值按用途给：数值/次数 → `+1`（最常见的动作），旗标 → 标记为已发生，
枚举/文本 → 该状态的初始值。这样一插入就是合法且有意义的。

项目还没有任何故事状态时按钮禁用，提示「先在「故事状态」里建一个状态」—— 而不是让作者
先造出一条指向空 key 的效果。

## 6. 示例项目

`examples/sample-novel` 从两个线性节点扩成一个能展示全部新功能的小故事：

```text
序章 ──▶ 苏醒 ──┬─「去看看那片火光」（决心+4，走向→护卫）──▶ 靠近火光 ──┬─ 决心≥3 且看清了 ──▶ 挡在船前（护卫结局）
                │                                                        └─ 否则 ─────────────▶ 随波而去（随波结局）
                └─「留在原地」（决心-1）─────────────────────────────────▶ 留在浅滩 ──▶ 随波而去
```

覆盖到：带分段的数值（决心：漂着/动摇/笃定）、旗标（看清了那场战斗）、枚举状态（当前走向）、
出口效果、自动分流 + 兜底、两个登记结局、CG 解锁。

**空白新项目仍然不塞任何示例数据** —— 新建项目后第一件事是删示例，体验很差。示例只活在
示例项目里。

`examples/sample-novel` 同时是一份端到端回归测试（`engine/src/__tests__/sampleNovel.test.ts`）：
它直接读真实项目文件，把两条路线都走到结局，并断言出口效果、钳制与 trace 归属。示例项目
坏了会让测试失败，不会等到用户打开才发现。

## 7. 验收

| ID | 验收点 | 覆盖测试 |
| --- | --- | --- |
| R1 | 只有实际走过的那条出口的效果生效 | `engine/variables.test.ts` |
| R2 | 效果先于目标节点的指令生效 | `engine/variables.test.ts` |
| R3 | 效果遵守声明范围 | `engine/variables.test.ts` |
| R4 | choice 与 auto 两条路径都应用效果 | `engine/variables.test.ts` |
| R5 | trace 归属到出口而非指令；回滚丢弃 | `engine/variables.test.ts` |
| R6 | 重命名改写出口效果，且不碰同前缀状态 | `backend/tests/variable_rename.rs` |
| R7 | 静态分析把出口效果算作写入点 | 由示例项目端到端测试间接覆盖 |
| R8 | 切换分流方式不丢效果 | `EdgeEffectsEditor.test.tsx` |
| R9 | 新建效果按用途给出合法初值 | `EdgeEffectsEditor.test.tsx` |
| R10 | 示例项目两条路线都能走到结局 | `engine/__tests__/sampleNovel.test.ts` |
| R11 | 示例项目通过 CLI validate | `vibegal-cli validate`（ok: true） |

## 8. 未做

- **内联样式向原语层的收敛**：纯机械迁移，394 处内联 `CSSProperties` 改成 class 不会带来任何
  用户可感知的变化，且会淹没 review。按既有节奏随手改即可，不单独排期。
