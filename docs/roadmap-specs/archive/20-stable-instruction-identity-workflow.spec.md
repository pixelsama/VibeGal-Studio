# Spec 20 — Stable Instruction Identity Workflow（稳定指令身份工作流）

> 状态：已实施并归档（2026-07-19）。阶段 A–E 全部完成并通过主审验证。
> 目标：保留剧情停点稳定 ID 带来的存档、已读与回滚定位能力，同时维持“项目文件是唯一源数据，Studio 与外部 Agent 都可直接管理”的产品模型；通过 Studio 自动管理、可选 CLI 安全操作和强校验反馈，让机器身份不成为创作负担。

## 1. 背景与问题

VibeGal-Studio 的运行时使用 `nodeId + instructionId` 定位剧情停点。当前 `say`、`narrate`、`wait`、`pause` 被标记为 story point；存档恢复、已读记录和回滚历史都依赖这一稳定身份。

现有契约只完成了一半：

- contracts schema 允许上述指令的 `id` 省略；
- TypeScript 与 Rust 校验器会对缺失 ID 报 `instruction_id_missing` warning，对同节点重复 ID 报 `instruction_id_duplicate` error；
- 运行时在 ID 缺失时临时回退到 `index:<n>`，只能保证当前内容版本内的近似定位；
- 新项目模板创建的第一条旁白没有 ID；
- Studio 新增旁白、台词、等待、停顿时没有生成 ID；
- Scenario DSL 解析普通台词和旁白时不产生 ID，带 ID 的指令又会为了无损往返退化成冗长的 `@instruction {...}`；
- CLI 能校验缺失或重复 ID，但不能为无 ID 的创作结果做确定性收尾。

因此，新建项目和正常使用 Studio 编辑剧情就可能持续产生 warning。问题不在于校验过严，而在于产品一方面依赖稳定身份，另一方面没有完整承担身份的生成、保留和修复责任。

## 2. 产品决策

### 2.1 文件仍是基础接口

本 spec 不把 CLI 提升为唯一写入网关。

- `content/graph.json` 与 `content/nodes/*.json` 继续是公开、稳定、自描述的项目源数据；
- Studio、外部 Agent、普通文本编辑器和用户脚本都是合法写入者；
- CLI 是可选的安全操作层和自动化工具，不是权限边界；
- 校验器是所有路径共享的最终安全网；
- watcher 只负责热刷新与报告问题，不因发现缺失 ID 而静默改写文件。

产品定位保持为：

```text
                   ┌─ 直接编辑项目 JSON ────────┐
Agent / Studio ────┤                            ├─ 项目文件（唯一源数据）
                   └─ CLI 安全修改命令（可选） ─┘
                                       ↓
                             watcher + validation
```

### 2.2 ID 是持久化身份，不是创作内容

稳定 ID 应当存在于最终节点数据中，但不要求作者或 LLM 构思其值。

它服务于：

- 存档与读档：内容插入、删除或移动后仍可恢复到原剧情停点；
- 已读记录：稳定识别已播放的台词或旁白；
- 回滚历史：回到确定的剧情停点；
- 预览跳转和外部工具定位：避免依赖易变化的数组下标。

职责分配：

- 程序负责生成不透明唯一值；
- 修改或移动已有指令时保留原 ID；
- 新增或复制停点时分配新 ID；
- Agent 可以在批量创作阶段暂时省略新停点 ID；
- Agent 不应自行重排、重编号或批量替换已有 ID。

### 2.3 Agent 路由规则

项目内说明必须明确推荐路径，不能避而不谈，也不能笼统要求所有修改都经过 CLI：

| 操作 | 推荐路径 | 完成条件 |
| --- | --- | --- |
| 批量编写新剧情 | 直接编辑 JSON；新停点可暂缺 ID | 结束后 assign + validate |
| 修改台词、旁白或参数 | 直接编辑并保留原 ID | validate |
| 新增停点 | 直接写入或使用 CLI；可暂缺 ID | assign + validate |
| 移动、复制、按 ID 删除已有停点 | 优先使用 CLI 安全命令 | validate |
| 大规模结构重排 | 优先使用 CLI 或结构化批处理 | validate |

简化原则是：**创作优先直接编辑，身份敏感操作优先 CLI，最终状态必须经过规范化和校验。**

## 3. 稳定 ID 契约

### 3.1 哪些指令需要 ID

V1 延续当前运行时语义，以下四类指令是 story point：

- `say`
- `narrate`
- `wait`
- `pause`

`wait` 与 `pause` 暂不从 story point 中移除。当前运行时已为二者维护恢复行为，贸然移除会改变存档与回滚语义。如未来决定等待过程不应成为可恢复停点，应另开 runtime contract spec，而不是在本次身份工作流中顺带修改。

### 3.2 唯一性范围

运行时身份是 `nodeId + instructionId`，所以：

- 同一节点内的 story point ID 必须唯一；
- 不同节点可以存在相同 ID；
- 程序生成器仍使用高熵随机值，使跨节点碰撞在实践中不可见；
- 已有人工 ID（例如 `line_01`）继续合法，不强制迁移为新格式。

### 3.3 生成格式

新生成 ID 使用不透明随机格式：

```text
sp_<UUIDv4>
```

例如：

```json
{
  "t": "narrate",
  "id": "sp_550e8400-e29b-41d4-a716-446655440000",
  "text": "风从走廊尽头吹来。"
}
```

生成值不得依赖：

- 数组下标；
- 台词文本或文本哈希；
- 连续编号；
- 当前节点标题或文件名。

这样修改文本、插入台词、重命名节点或移动指令都不会诱发身份重算。

### 3.4 数据状态

节点文件允许存在两个可观察状态：

```text
可编辑但未规范化
  - 新 story point 可以缺少 id
  - Studio / validate 报 warning
          ↓ assign missing IDs
结构完整
  - 所有 story point 有非空 id
  - 同节点 id 唯一
          ↓ validate
可交付
```

contracts schema 中 story point 的 `id` 在 V1 继续保持 optional。这是刻意设计：直接编辑文件的 Agent 可以先提交剧情草稿，之后再统一规范化。最终完整性由语义校验、严格构建和交付流程保证，而不是让结构 schema 拒绝创作阶段数据。

校验等级保持：

- `instruction_id_missing`：warning；
- `instruction_id_duplicate`：error；
- 非字符串、空字符串等违反 schema 的值仍按结构错误处理。

## 4. 共享身份服务

在 Rust backend library 中新增共享的 instruction identity 服务，Studio 保存、项目初始化和 standalone CLI 都调用同一实现，禁止各入口分别生成 ID。

建议职责：

```text
assign_missing_story_point_ids(node, generator)
assign_missing_story_point_ids_in_project(project, scope, options)
```

实现约束：

1. 根据生成的 instruction policy metadata 判断 `storyPoint`，避免在 Rust 多处再次硬编码四种指令类型；
2. 仅将字段缺失或空字符串视为“待分配”；
3. 所有已有非空 ID 原样保留；
4. 已有重复 ID 原样保留，不猜测哪一项是原件；
5. 生成值需避开当前节点已有 ID；
6. 返回结构化变更报告，而不是只返回修改后的 JSON；
7. ID generator 可注入，以便测试使用确定性序列；
8. 对同一输入执行两次，第二次必须为零修改；
9. 服务只处理身份，不顺带修资源引用、未知指令或其他内容问题。

结构化变更项至少包含：

```json
{
  "file": "content/nodes/start.json",
  "nodeId": "start",
  "jsonPath": "$[2].id",
  "id": "sp_550e8400-e29b-41d4-a716-446655440000"
}
```

### 4.1 重复 ID 为什么不自动修复

缺失 ID 是无歧义状态：程序只需创建一个此前不存在的身份。

重复 ID 不同。程序无法可靠判断：

- 第一项是原件、第二项是复制品；
- 第二项才是作者希望旧存档继续指向的内容；
- 两项是否来自一次错误的批量替换。

因此普通 `assign` 不处理重复项。`validate` 继续报告 error，要求 Agent 或用户明确选择需要保留原身份的指令。未来若提供重复 ID 修复命令，必须是独立、显式、可预览的危险操作，不得藏在 missing-only assign 中。

## 5. Studio 身份生命周期

### 5.1 新建项目

项目初始化仍创建一条默认旁白，但必须通过共享身份服务获得 ID。新项目首次打开的目标状态是：

```text
0 error / 0 warn
```

项目模板文档中的 minimal node 示例同步携带合法 ID，避免外部 Agent 从错误示例复制数据。

### 5.2 专用节点保存边界

NodeEditor 不再把 `content/nodes/*.json` 仅作为普通文本交给通用 `save_file`。新增 typed Tauri wrapper 与专用 backend command，例如：

```text
save_node(projectPath, nodeFile, instructions, expectedRevision)
```

保存顺序：

1. 打开并约束 project/content capability；
2. 检查 expected revision，外部修改时返回现有 `write_conflict`；
3. 对收到的 `Instruction[]` 补齐缺失 story point ID；
4. 使用 node schema 校验规范化结果；
5. 原子写入节点 JSON；
6. 返回最终 `Instruction[]`、最终序列化文本、新 revision 与 assigned report；
7. 前端使用后端返回值刷新内存状态，确保 UI 与磁盘完全一致。

保存命令不得自动重写重复 ID。重复 ID 在保存后由现有项目校验链路报告 error。

### 5.3 Scenario 模式隐藏机器身份

Scenario DSL 是创作视图，默认不展示 story point ID。

格式化规则调整为：

- `say`、`narrate`、`wait`、`pause` 的稳定 ID 不参与可读文本输出；
- 因其他不可读字段需要回退到 `@instruction` 时，fallback JSON 也移除机器管理的 story point ID；
- `formatScenarioText` → `parseScenarioText` 的纯函数往返只承诺“除机器 ID 外语义等价”；
- Studio 在身份协调后必须恢复完整、带 ID 的指令数组。

### 5.4 Scenario 身份协调

自由文本解析会产生无 ID 的指令，因此 NodeEditor 需要维护一份“最后有效、带身份的指令序列”，并在每次成功解析后进行保守协调。

V1 协调规则：

1. 比较时忽略 story point ID，其他持久化字段都参与语义比较；
2. 唯一的完全语义匹配可以跨位置继承原 ID，用于保留移动的完整指令；
3. 由稳定匹配锚点包围、数量相等且类型逐项一致的编辑区，可以按原相对顺序继承 ID，用于普通文本或参数修改；
4. 新增、复制或无法无歧义匹配的项保持无 ID，交给保存层生成；
5. 不因相似文本、数组位置接近或文本哈希而猜测身份；
6. 多条完全相同指令发生自由文本重排时，如果身份归属有歧义，不承诺跨重排保留；应使用 Studio 结构化移动或 CLI 安全移动命令。

Studio 自身的结构化操作规则更直接：

- update：保留对象 ID；
- move：移动完整对象，保留 ID；
- duplicate：复制内容，但移除副本的 story point ID；
- insert：新对象不带 story point ID；
- delete：删除对象及其 ID。

这套规则使普通编辑无需作者感知 ID，同时对自由文本中的真正歧义保持保守，不把旧存档悄悄指向错误内容。

### 5.5 JSON 模式

JSON 模式是高级、透明的数据视图：

- 显示完整 ID；
- 允许用户直接编辑 ID；
- 已有合法 ID 默认随对象保留；
- 删除 ID 后保存，backend 会将其视为缺失并生成新身份；
- 手工输入重复 ID 不自动修复，项目校验报告 error；
- UI 在 ID 字段附近或模式说明中提示：修改已有 ID 可能使旧存档、已读与回滚记录失效。

### 5.6 外部文件更新

外部 Agent 写入文件时：

- watcher 触发正常热刷新；
- 缺失 ID 继续显示 warning；
- Studio 不在 watcher 回调中运行 assign，不与 Agent 的连续写入竞争；
- 用户在 Studio 中再次明确保存该节点时，可以按专用保存边界补齐；
- Agent 也可以在自己的工作完成边界显式调用 CLI assign。

## 6. CLI 身份规范化命令

新增嵌套命令：

```bash
vibegal-cli instruction-ids assign <project-path> [--node <node-id>] [--dry-run] [--format text|json]
```

### 6.1 行为

- 默认处理 `content/graph.json` 引用的全部节点；
- `--node` 将范围收窄到单个 graph node ID；
- `--dry-run` 生成计划与候选 ID，但不写盘；
- 正常模式只补缺失或空 ID；
- 不修改已有合法 ID；
- 不修复已有重复 ID；
- 不扫描或写入 graph 未引用的孤立 JSON 文件；孤立文件问题继续由项目校验语义决定；
- 完成后不隐式吞掉其他校验问题，文档要求紧接着运行 `validate`。

命令先对所有目标做预检，至少确认：

- 项目根合法；
- graph 可读取；
- 目标 node ID 与 node file 可安全解析；
- 所有目标文件是 JSON 数组；
- 不存在越界、符号链接或路径穿越。

预检失败时不写任何文件。进入写入阶段后，每个节点文件使用现有 atomic write。文件系统不提供跨多个文件的原子事务；若中途出现 IO 失败，命令必须在结构化错误中报告已修改文件，且允许安全重跑——因为已有 ID 永不重写，操作是幂等的。

### 6.2 JSON 输出

成功输出示例：

```json
{
  "ok": true,
  "projectPath": "C:/project",
  "dryRun": false,
  "assignedCount": 2,
  "changedFiles": [
    {
      "file": "content/nodes/start.json",
      "assigned": [
        { "nodeId": "start", "jsonPath": "$[0].id", "id": "sp_..." },
        { "nodeId": "start", "jsonPath": "$[2].id", "id": "sp_..." }
      ]
    }
  ]
}
```

零修改仍是成功，`assignedCount` 为 `0`。

建议退出码：

- `0`：成功，包括无需修改；
- `1`：预检、生成或写入失败；
- `70`：项目无法打开，与现有 validate 语义一致。

### 6.3 Agent 推荐收尾

项目内 `AGENTS.md` 使用下面的标准流程：

```bash
vibegal-cli instruction-ids assign . --format json
vibegal-cli validate . --format json
```

`assign` 不是每次写一条指令后都要调用的额外步骤，而是一次创作任务结束时的统一规范化收尾。

## 7. CLI 安全修改层

在 missing-ID 闭环稳定后，增加可选的节点修改命令。它们提高身份敏感操作的可靠性，但不取消直接文件编辑能力。

V1 先支持通过已有 story point ID 定位的操作：

```bash
vibegal-cli node insert <project> <node-id> --after <story-point-id> --file <instruction.json> --format json
vibegal-cli node update <project> <node-id> <story-point-id> --patch-file <patch.json> --format json
vibegal-cli node move <project> <node-id> <story-point-id> --before <story-point-id> --format json
vibegal-cli node duplicate <project> <node-id> <story-point-id> --format json
vibegal-cli node delete <project> <node-id> <story-point-id> --format json
```

共同要求：

- 通过 `nodeId + instructionId` 定位，不让 Agent 依赖数组下标；
- update 与 move 保留目标 ID；
- insert 与 duplicate 为新 story point 生成新 ID；
- duplicate 不复制原 story point ID；
- 操作前检查目标 ID 在节点内唯一；存在重复时拒绝执行；
- 使用 revision / 内容哈希做乐观并发检查；
- 原子写入并返回修改前后位置、ID 和新 revision；
- 接受 `--dry-run` 或等价预览能力后再扩展到高风险批处理。

V1 不试图用 story point ID 定位 `bg`、`char`、`voice` 等非停点指令，也不定义“移动整帧”的隐式语义。这些指令常与后续停点组成剧情帧；如要提供 frame-level mutation，应先明确 frame contract，再单独扩展 CLI，避免一个看似简单的 move 命令改变剧情语义。

## 8. 项目自描述与文档

更新新项目模板中的：

- 根 `AGENTS.md`：加入第 2.3 节路由规则、已有 ID 保留规则、assign + validate 收尾命令；
- `.galstudio/README.md`：解释稳定 ID 的用途、生成责任与编辑状态；
- `.galstudio/schemas/nodeFile.json`：继续由 contracts 生成，保留 optional 语义和 stable story-point 描述；
- minimal node 示例：使用带 ID 的合法最终数据；
- CLI help 与仓库级 CLI 文档：记录 assign 和安全 mutation 命令。

对既有项目保持保守：

- 打开项目不覆盖已经存在的 `AGENTS.md`、`.galstudio/README.md` 或 schema；
- 新模板只影响新项目和原本缺失的自描述文件；
- 本 spec 不借身份修复之名静默刷新用户可能定制过的 Agent 指令；
- 如后续需要升级已有自描述文件，应设计显式 diff / refresh 流程，单独评审覆盖策略。

## 9. 实施阶段

### 阶段 A：共享身份核心

1. 先写 Rust 单元测试，覆盖缺失、空值、已有值、重复值、非 story point、碰撞重试和幂等；
2. 新增共享 identity service 与可注入 generator；
3. 通过 library facade 暴露给 standalone CLI；
4. 保持现有 diagnostics contract 不漂移。

阶段验收：给任意合法节点补齐缺失 ID，不改变任何已有非空 ID。

### 阶段 B：初始化与 Studio 保存

1. 先更新项目初始化测试，要求默认旁白含非空唯一 ID；
2. 初始化改用共享服务；
3. 先写 backend `save_node` 测试：revision 冲突、路径安全、missing-only、重复保留、原子 JSON；
4. 增加 Tauri command 与 `src/lib/tauri.ts` typed wrapper；
5. NodeEditor 改用专用保存并消费 authoritative result。

阶段验收：新项目与 Studio 正常新增内容不再产生 missing-ID warning。

### 阶段 C：Scenario 身份保留

1. 先修改 engine scenario 测试，明确“创作投影不显示机器 ID”；
2. 为 identity-stripped projection 和 reconciliation 写纯函数测试；
3. 调整 `formatScenarioText` / fallback `@instruction`；
4. NodeEditor 接入最后有效身份序列；
5. 修正 structured move / duplicate / insert 行为；
6. 补外部 diff、undo/redo、模式切换和保存期间继续编辑的回归测试。

阶段验收：普通 Scenario 编辑、JSON/Scenario 切换和 Studio 结构化重排不会意外丢失已有身份。

### 阶段 D：CLI assign 与 Agent 文档

1. 先写 CLI fixture tests，覆盖全项目、单节点、dry-run、零修改、路径安全、预检失败和部分 IO 失败报告；
2. 实现 `instruction-ids assign`；
3. 更新新项目 `AGENTS.md`、README 与 minimal node；
4. 更新 CLI help 和 doc-contract drift checks；
5. 使用真实 fixture project 跑 assign → validate 闭环。

阶段验收：外部 Agent 可以直接写无 ID 的新增剧情，用一次明确命令完成规范化，并获得机器可读结果。

### 阶段 E：可选安全 mutation 命令

按 insert → update → move → duplicate → delete 顺序逐个 TDD 落地；每个命令独立交付，不阻塞阶段 A-D 形成的核心闭环。

阶段验收：Agent 可以选择通过稳定 ID 完成身份敏感修改，同时直接编辑 JSON 的能力与文档地位不变。

## 10. 测试矩阵

### 10.1 Contracts / validation

- 四类 story point 缺 ID 仍报 warning；
- 同节点重复 ID 仍报 error；
- 不同节点相同 ID 合法；
- 非 story point 的资源 `id` 不被当成 instruction identity；
- TS 与 Rust 对 fixture corpus 的 code、severity、jsonPath 保持一致。

### 10.2 Identity service

- 缺失 ID 被补齐；
- 空 ID 被补齐或在进入 schema 校验前规范化；
- 合法人工 ID 保留；
- 重复 ID 不改写；
- 生成器碰撞后重试；
- 第二次运行零修改；
- 输入对象不被意外原地污染（除非 API 明确声明 mutation）。

### 10.3 Studio

- 新项目打开为 `0 error / 0 warn`；
- 新增 `say` / `narrate` / `wait` / `pause` 后保存均有 ID；
- 修改文本、角色、参数后 ID 不变；
- 移动完整对象后 ID 不变；
- duplicate 获得新 ID；
- 在首部或中间插入内容时，已有前后指令 ID 不变；
- Scenario 不显示机器 ID；
- Scenario → JSON → Scenario 不丢身份；
- 相同文本歧义不被错误猜测；
- revision conflict 保留本地草稿；
- 外部文件更新不会触发自动写回。

### 10.4 CLI

- assign 全项目与 `--node` 范围正确；
- `--dry-run` 不改变任何字节；
- 已有 ID 和重复 ID 保持不变；
- graph 未引用文件不被修改；
- 非法路径、符号链接、损坏 JSON 在预检阶段失败；
- JSON 输出字段稳定且可解析；
- assign 后 validate 不再报告 missing ID；
- 第二次 assign 返回 `assignedCount: 0`；
- Windows 路径与 Unix 路径测试按现有安全测试策略处理，symlink case 继续 `#[cfg(unix)]`。

## 11. 验证命令

实施期间按改动范围运行：

```bash
pnpm --filter @vibegal/contracts test
pnpm --filter @vibegal/engine test
pnpm --filter @vibegal/studio test
pnpm --filter @vibegal/studio build
pnpm run check:schemas
pnpm run check:doc-contract
cd packages/studio/src-tauri && cargo test
```

若修改 renderer-facing `Instruction` 类型或生成入口，还必须运行：

```bash
node packages/studio/scripts/generate-engine-types.mjs
pnpm check:engine-types
```

本 spec 的 V1 预计不需要把 story point ID 从 optional 改为 required，因此不应仅为了“最终完整性”制造 renderer type breaking change。

## 12. 非目标

- 不引入 in-app AI、Agent session 或模型设置；
- 不让 watcher 自动修复外部文件；
- 不把 CLI 变成唯一合法写入入口；
- 不自动重写已有人工 ID；
- 不自动判断重复 ID 的原件；
- 不承诺为任意自由文本大改完美推断旧身份；
- 不在本次修改存档格式、read-key 格式或 graph node identity；
- 不在没有 frame contract 的情况下实现非停点指令的“整帧移动”。

## 13. 总体验收标准

完成阶段 A-D 后，必须满足：

1. 新建项目没有 `instruction_id_missing`；
2. Studio 新增四类 story point 并保存后没有 missing-ID warning；
3. 修改文本、参数或结构化移动后已有 ID 保持不变；
4. 复制 story point 获得新 ID；
5. Scenario 默认不展示机器 ID，模式往返不丢身份；
6. Agent 可直接写入无 ID 的新增剧情，watcher 不静默改写；
7. `instruction-ids assign` 只补缺失项，幂等且支持 dry-run；
8. 重复 ID 不被自动重写，并继续由 validate 报 error；
9. assign + validate 提供完整机器可读闭环；
10. 项目文件仍是唯一源数据，绕过 CLI 直接编辑仍是受支持能力。

## 14. 主要改动范围（实施时复核）

- `packages/contracts/src/diagnostics.ts`
- `packages/contracts/src/schema.ts`
- `packages/engine/src/scenario.ts`
- `packages/engine/src/scenario.test.ts`
- `packages/studio/src/features/script/NodeEditor.tsx`
- `packages/studio/src/features/script/instructionEditing.ts`
- `packages/studio/src/features/script/externalDiff.ts`
- `packages/studio/src/lib/tauri.ts`
- `packages/studio/src-tauri/src/backend/contracts/`
- `packages/studio/src-tauri/src/backend/fs/`
- `packages/studio/src-tauri/src/backend/mutation/`
- `packages/studio/src-tauri/src/backend/project/initialize.rs`
- `packages/studio/src-tauri/src/backend/project/templates.rs`
- `packages/studio/src-tauri/src/bin/cli.rs`
- `packages/studio/src-tauri/src/backend/tests/`
- `docs/roadmap-specs/README.md`

## 15. 修订记录

- 2026-07-19：定稿初版。确认“文件是基础接口、CLI 是可选安全层、校验是最终安全网”；稳定 ID 保留在持久化数据中，由程序生成；定义 Studio 保存边界、Scenario 隐藏身份、missing-only CLI assign、Agent 路由规则与后续安全 mutation 命令。
- 2026-07-19：完成阶段 A–E 并归档。共享 Rust identity service、项目初始化、`save_node`、Scenario/JSON 身份协调、完整 undo/redo 身份快照、native watcher no-repair、`instruction-ids assign` 与五个稳定 ID mutation 命令均已落地；revision 增加 SHA-256 内容校验，并补齐 assign → validate、路径安全、部分写入失败与机器可读输出契约测试。最终验证：contracts 35、engine 107、Studio 652、Rust library 167、CLI 67、backend module contract 9，Studio build、schema/doc drift、Rust format 与 diff checks 均通过。
