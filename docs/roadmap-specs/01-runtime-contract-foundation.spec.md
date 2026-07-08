# Spec 01 — Runtime Contract Foundation

> 状态：已决策，待开发。
> 来源：[project-wiki.md](../project-wiki.md) 的 Phase C、Fable 审阅意见，以及当前 `@galstudio/engine` 的 graph-aware player 架构。
> 目标：先建立存档、已读、回滚、backlog、settings、renderer 契约扩展都依赖的运行时地基。

## 1. 背景

当前 GalStudio 已有：

- graph-first 项目结构；
- `Instruction[]` 节点文件；
- 纯函数 `interpreter`；
- `GraphNovelPlayer`；
- renderer contract；
- CLI validation。

但正规 galgame runtime 需要的存档、已读跳过、backlog、回滚、全局解锁、音量设置等能力，都依赖四个尚未正式定义的基础契约：

1. 稳定剧情位置标识。
2. 可重放的运行时状态模型。
3. 三层持久化模型。
4. renderer contract 版本化。

本 spec 只定义这些地基，不实现任何正式 UI。

## 2. 产品边界

GalStudio 不实现正式存档菜单、backlog 菜单、设置菜单或标题画面。

本 spec 负责：

- 定义数据身份；
- 定义可序列化状态；
- 定义持久化层级；
- 定义恢复策略；
- 定义 renderer contract 版本约束。

项目 renderer 负责：

- 存档列表如何显示；
- 已读/未读如何提示；
- backlog 如何排版；
- 设置菜单如何设计；
- 标题菜单如何调用这些 API。

## 3. 核心要求

### 3.1 稳定剧情位置标识

存档和已读不能只依赖 `nodeId + instructionIndex`。

原因：节点文件由作者和外部 Agent 高频编辑。若在某条台词前插入新指令，旧下标会错位。

需要定义一个稳定剧情点身份：

```ts
interface StoryPointId {
  nodeId: string;
  instructionId: string;
}
```

V1 先给“可停留、可恢复、可统计已读”的指令增加稳定 id：

- `say`
- `narrate`
- `pause`
- `wait`

舞台指令如 `bg`、`char`、`sfx` 可以暂不强制拥有 id，因为它们通常随剧情帧重放恢复。

#### 3.1.1 指令 id 字段

V1 schema：

```json
{ "t": "say", "id": "line_01hxyz", "who": "hero", "text": "..." }
```

约束：

- `id` 在同一节点内唯一。
- 编辑器插入新停点指令时自动生成 id。
- 外部 Agent 应保留既有 id。
- 复制指令时必须生成新 id。
- 手写 JSON 缺 id 时，validation 应给 warning 或可修复 issue。

#### 3.1.2 文本已读身份

已读状态不能只靠 `instructionId`。

若一条台词 id 不变但文本变了，旧已读不应自动覆盖新文本。

V1 已读 key 使用：

```ts
interface ReadTextKey {
  nodeId: string;
  instructionId: string;
  textHash: string;
}
```

其中 `textHash` 基于标准化后的 `say.text` 或 `narrate.text` 生成。

### 3.2 可重放运行时模型

当前 `interpreter` 是纯函数，这是回滚和恢复的基础。

存档不应简单序列化完整 `NovelState`。`NovelState` 包含一些瞬时字段：

- animation/event seq；
- effects；
- transitions；
- one-shot audio cues；
- sprite change ids；
- typing progress。

这些字段适合实时渲染，不适合作为长期存档格式。

需要新增语义化快照类型：

```ts
interface RuntimeSnapshot {
  currentNodeId: string;
  currentStoryPoint: StoryPointId | null;
  vars: Record<string, string | number | boolean | null>;
  background: string | null;
  sprites: SerializableSprite[];
  bgm: SerializableBgm | null;
}
```

实际字段以后由实现细化，但原则是：

- 保存语义状态；
- 不保存一次性视觉事件；
- 不保存 DOM/audio 实例；
- 不保存 renderer 私有 UI 状态。

### 3.3 决策日志

重放模型需要记录玩家决策。

V1 事件：

```ts
type DecisionLogEvent =
  | { type: "start"; nodeId: string }
  | { type: "choice"; fromNodeId: string; toNodeId: string; edgeId: string }
  | { type: "auto"; fromNodeId: string; toNodeId: string; edgeId: string }
  | { type: "checkpoint"; snapshot: RuntimeSnapshot };
```

原则：

- 玩家选择必须记录。
- 自动分支记录实际命中的 edge，便于脚本改动后尽力恢复。
- 随机数进入引擎后，随机结果也必须记录。
- `checkpoint` 用于避免从项目开头重放太久。

### 3.4 三层持久化

必须拆成三层，不能混在一个对象里。

| 层 | 内容 | 生命周期 | 清理时机 |
| --- | --- | --- | --- |
| Save Slot | 位置、vars、决策历史、checkpoint | 单周目，玩家显式管理 | 删除存档 |
| Global Persistent | 已读、CG/音乐/结局解锁、周目计数 | 跨周目，自动累积 | 清除全局进度 |
| Runtime Settings | 音量、文字速度、自动播放速度、全屏等 | 用户/设备级 | 重置设置 |

#### 3.4.1 Save Slot

V1 字段：

```ts
interface SaveSlotRecord {
  schemaVersion: number;
  projectId: string;
  createdAt: string;
  updatedAt: string;
  label?: string;
  preview?: SavePreview;
  position: StoryPointId | null;
  vars: Record<string, string | number | boolean | null>;
  decisions: DecisionLogEvent[];
  checkpoint: RuntimeSnapshot;
}
```

#### 3.4.2 Global Persistent

V1 字段：

```ts
interface GlobalPersistentRecord {
  schemaVersion: number;
  projectId: string;
  readText: ReadTextKey[];
  unlockedCg: string[];
  unlockedMusic: string[];
  unlockedEndings: string[];
  playthroughCount: number;
}
```

#### 3.4.3 Runtime Settings

V1 字段：

```ts
interface RuntimeSettingsRecord {
  schemaVersion: number;
  textSpeedCps?: number;
  autoAdvanceMs?: number;
  volumes: {
    master: number;
    bgm: number;
    sfx: number;
    voice: number;
  };
  fullscreen?: boolean;
}
```

### 3.5 Renderer Contract Version

`RendererManifest` 需要声明契约版本或能力。

V1 字段：

```ts
interface RendererManifest {
  id: string;
  name: string;
  contractVersion: 1;
  capabilities?: string[];
  Component: ComponentType<RendererProps>;
}
```

原则：

- Studio 支持旧 renderer 的兼容加载。
- 新 runtime API 不应突然破坏旧 renderer。
- validation 应能发现明显不兼容的 renderer。
- 完整 TSX 编译校验可以由 Studio 或后续 CLI renderer-check 完成，不强求立刻塞进现有 Rust validate。

## 4. 非目标

- 不做正式存档 UI。
- 不做正式 backlog UI。
- 不做正式设置 UI。
- 不做标题画面。
- 不做导出。
- 不做复杂脚本语言。
- 不做 timeline/camera/particle 演出系统。

## 5. 验收标准

- 有正式 schema 或 TypeScript 类型描述 StoryPoint、ReadTextKey、DecisionLog、SaveSlot、GlobalPersistent、RuntimeSettings。
- `Instruction[]` schema 明确哪些指令需要稳定 id。
- 缺失或重复 instruction id 可被 validation 报告。
- 已读标识包含文本 hash。
- 存档恢复不直接依赖裸下标。
- `RendererManifest` 有 contract version 或能力探测方案。
- 文档更新 `renderer-contract.md` 和项目 Wiki。

## 6. TDD 清单

| 测试名 | 断言 |
| --- | --- |
| `instructionIdentityWarnsMissingBlockingInstructionId` | `say`/`narrate` 缺 id 时给可定位 warning |
| `instructionIdentityRejectsDuplicateIdsInNode` | 同一节点重复 id 报错 |
| `readTextKeyChangesWhenTextChanges` | 同一 line id 文本变化后 text hash 变化 |
| `saveSlotDoesNotSerializeTransientEffects` | save slot 不包含一次性 effect/transition/seq 字段 |
| `decisionLogRestoresChoiceRoute` | 通过决策日志能恢复 choice 路径 |
| `rendererManifestAcceptsCurrentContractVersion` | 当前版本 renderer 校验通过 |
| `rendererManifestWarnsUnsupportedContractVersion` | 超前版本给明确错误或 warning |

## 7. V1 决策

- 指令稳定字段统一使用 `id`。`StoryPointId.instructionId` 指向指令对象的 `id`，不再引入 `sid` 或 `lineId`。
- 历史节点缺 `id` 时，CLI / Studio validation 给 machine-readable warning，并提供可修复 issue；打开项目或运行 validate 不静默改写文件。编辑器中新建、复制、粘贴停点指令必须生成新 `id`；用户保存被编辑器接管的节点草稿时，可由节点 normalizer 为缺失停点指令补齐 `id`。
- Save slot 的持久 checkpoint 在显式 save、quick save、auto save 时生成；运行时可额外按每 25 个可恢复 story point 或每次 route decision 建立内存 checkpoint，用于降低回滚/恢复重放成本。
- 旧 decision log 中的 `edgeId` 不存在时，恢复顺序为：先查找同 `fromNodeId -> toNodeId` 的现存 edge；若不存在，则按当前 graph 和 vars 重新计算自动分支；仍无法确定时停在 `fromNodeId`，返回可展示的 load warning，不静默跳到未知位置。
- `textHash` 只做稳定化规范化：Unicode NFC、CRLF/LF 统一、移除每行行尾空白。不折叠正文中的空白，不转换全角/半角，不忽略标点差异；文本含义变化应产生新的未读状态。
