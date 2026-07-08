# Spec 02 — Renderer Runtime API

> 状态：草案。
> 前置：[01-runtime-contract-foundation.spec.md](./01-runtime-contract-foundation.spec.md)。
> 目标：定义 renderer 可调用的正规 galgame runtime API，让 renderer 能实现正式 UI，而 Studio 不内置正式 UI。

## 1. 背景

当前 `RendererProps` 只提供：

- 当前 `NovelState`；
- `manifest`；
- `contentBase`；
- `stage`；
- `onAdvance`；
- `onChoose`；
- 自动播放/录制切换；
- 少量调试回调。

这足够默认预览，但不足以让项目 renderer 实现正式 galgame UI，例如：

- save/load；
- quick save/load；
- backlog；
- rollback；
- 已读跳过；
- 设置菜单；
- 音量控制；
- CG/音乐/结局解锁展示。

本 spec 定义 renderer 应获得哪些 runtime 数据和回调。

## 2. 产品边界

引擎/宿主提供能力；renderer 提供界面。

Studio 不实现：

- 正式 save/load 菜单；
- 正式 backlog 菜单；
- 正式 settings 菜单；
- 正式 CG gallery；
- 正式 title screen。

renderer 可以实现这些 UI，并调用 runtime API。

## 3. API 组织原则

不要把所有回调平铺在 `RendererProps` 顶层。

建议新增一个命名空间对象：

```ts
interface RendererProps {
  state: NovelState;
  manifest: Manifest;
  contentBase: string;
  stage: Meta["stage"];
  controls: RuntimeControls;
  runtime?: RuntimeServices;
}
```

兼容策略：

- 旧 renderer 仍可收到旧字段，或通过 adapter 转换。
- 新 renderer 使用 `runtime`。
- contract version 决定哪些字段可用。

## 4. RuntimeControls

负责播放控制。

候选接口：

```ts
interface RuntimeControls {
  advance(): void;
  choose(toNodeId: string): void;
  setAutoPlay(on: boolean): void;
  setSkipMode(mode: "off" | "read" | "all"): void;
  rollbackTo(point: StoryPointId): void;
  restart(): void;
}
```

要求：

- `advance` 保持点击/空格语义。
- `choose` 只能接受当前 choice 中合法目标。
- `skipMode: "read"` 依赖已读状态。
- `rollbackTo` 只能跳到可恢复的 backlog point。

## 5. Save Service

候选接口：

```ts
interface SaveService {
  listSlots(): Promise<SaveSlotSummary[]>;
  save(slotId: string, options?: SaveOptions): Promise<SaveSlotSummary>;
  load(slotId: string): Promise<void>;
  delete(slotId: string): Promise<void>;
  quickSave(): Promise<void>;
  quickLoad(): Promise<void>;
  autoSave(reason: "node" | "choice" | "manual"): Promise<void>;
}
```

renderer 负责：

- 存档列表 UI；
- 存档卡片 UI；
- 确认弹窗；
- 快捷键提示。

engine/host 负责：

- save slot schema；
- 序列化和恢复；
- 写入存储；
- 错误报告。

## 6. History and Backlog Service

候选接口：

```ts
interface HistoryService {
  getBacklog(): BacklogEntry[];
  replayVoice(entryId: string): void;
  rollbackTo(entryId: string): void;
}
```

候选 `BacklogEntry`：

```ts
interface BacklogEntry {
  id: string;
  storyPoint: StoryPointId;
  speakerName?: string;
  text: string;
  voiceId?: string;
  readKey?: ReadTextKey;
}
```

要求：

- backlog 数据来自运行时历史，不来自 renderer DOM。
- renderer 可自由展示。
- voice replay 只重播该条语音，不推进剧情。

## 7. Persistent Service

候选接口：

```ts
interface PersistentService {
  getReadStatus(key: ReadTextKey): boolean;
  markRead(key: ReadTextKey): Promise<void>;
  getUnlocks(): UnlockState;
  unlock(kind: UnlockKind, id: string): Promise<void>;
  resetGlobalProgress(): Promise<void>;
}
```

要求：

- 已读、解锁、结局不属于 save slot。
- 新开游戏不能清除 global persistent。
- 读档不能回滚 global persistent，除非用户明确清除全局进度。

## 8. Settings Service

候选接口：

```ts
interface RuntimeSettingsService {
  getSettings(): RuntimeSettingsRecord;
  updateSettings(patch: Partial<RuntimeSettingsRecord>): Promise<void>;
}
```

至少支持：

- master volume；
- bgm volume；
- sfx volume；
- voice volume；
- text speed；
- auto speed；
- fullscreen/windowed host preference。

settings 是用户/设备级数据，不属于 save slot。

## 9. Audio Service

候选接口：

```ts
interface AudioService {
  replayVoice(): void;
  stopBgm(fadeMs?: number): void;
  pauseBgm(): void;
  resumeBgm(): void;
  stopVoice(): void;
  stopAllSfx(): void;
}
```

指令层也需要配套扩展：

- BGM stop；
- BGM pause/resume；
- voice stop；
- maybe ambient/channel support in later specs。

## 10. Debug Service

Studio preview 可以额外提供 debug-only API：

```ts
interface DebugService {
  inspectState(): NovelState;
  inspectRuntimeSnapshot(): RuntimeSnapshot;
  jumpTo(point: StoryPointId): void;
}
```

导出 runtime 可以不暴露 debug service，或仅开发模式暴露。

## 11. 非目标

- 不定义菜单 UI。
- 不定义键位布局。
- 不定义 renderer visual components。
- 不要求所有 renderer 必须实现所有正式 UI。
- 不把 Studio 的 debug controls 当成最终游戏 UI。

## 12. 验收标准

- `RendererProps` 有扩展方案且兼容旧 renderer。
- 新 runtime API 分组清晰。
- save/global/settings 三层不会互相覆盖。
- renderer 能通过 API 实现正式 UI。
- Studio 默认 renderer 可作为参考实现，但不是唯一实现。
- 文档更新 `renderer-contract.md`。

## 13. TDD 清单

| 测试名 | 断言 |
| --- | --- |
| `rendererPropsKeepsLegacyAdvanceCallback` | 旧 renderer 仍可使用旧推进回调 |
| `saveServiceDoesNotMutateGlobalPersistentOnLoad` | load save slot 不回滚全局解锁/已读 |
| `settingsServicePersistsVolumeIndependentlyFromSaveSlot` | 读档不覆盖音量设置 |
| `historyServiceReturnsBacklogEntriesWithStoryPoint` | backlog entry 可定位回故事点 |
| `audioServiceAppliesTrackVolumes` | 分轨音量影响对应音频类型 |

## 14. 开放问题

- 旧 renderer 兼容期持续多久？
- `runtime` 是否必须存在，还是按 `capabilities` 可选？
- 导出 Web runtime 的 storage adapter 用 localStorage、IndexedDB，还是可插拔？
- debug service 是否应该在 production export 中完全剔除？
