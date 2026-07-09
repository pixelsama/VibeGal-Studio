# Spec 02 — Renderer Runtime API

> 状态：已归档。
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

V1 新增一个命名空间对象：

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

迁移策略：

- VibeGal-Studio 尚未发布正式版本，V1 采用 breaking change。
- 旧的 `onAdvance`、`onChoose`、`onToggleAuto`、`onToggleRecording`、`onSeekBy` 等顶层回调从 `RendererProps` 移除。
- 新 renderer 必须使用 `controls` 和 `runtime`。
- 默认 renderer、项目模板、Studio preview host、export runtime host 同步迁移到 `contractVersion: 1`。
- 不提供 v0 adapter；不把旧契约写进新项目模板。

## 4. RuntimeControls

负责播放控制。

V1 接口：

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

V1 接口：

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

V1 接口：

```ts
interface HistoryService {
  getBacklog(): BacklogEntry[];
  replayVoice(entryId: string): void;
  rollbackTo(entryId: string): void;
}
```

V1 `BacklogEntry`：

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

V1 接口：

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

V1 接口：

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

V1 接口：

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

- `RendererProps` 改为 `controls` / `runtime` 分组契约，不保留旧顶层回调。
- 新 runtime API 分组清晰。
- save/global/settings 三层不会互相覆盖。
- renderer 能通过 API 实现正式 UI。
- Studio 默认 renderer 可作为参考实现，但不是唯一实现。
- 文档更新 `renderer-contract.md`。

## 13. TDD 清单

| 测试名 | 断言 |
| --- | --- |
| `rendererPropsRequiresControlsAdvance` | renderer 通过 `controls.advance()` 推进，不再接收 `onAdvance` |
| `saveServiceDoesNotMutateGlobalPersistentOnLoad` | load save slot 不回滚全局解锁/已读 |
| `settingsServicePersistsVolumeIndependentlyFromSaveSlot` | 读档不覆盖音量设置 |
| `historyServiceReturnsBacklogEntriesWithStoryPoint` | backlog entry 可定位回故事点 |
| `audioServiceAppliesTrackVolumes` | 分轨音量影响对应音频类型 |

## 14. V1 决策

- V1 是 breaking renderer contract。旧顶层回调在实现本 spec 时移除；当前项目内已有 renderer 需要随工程迁移。
- `controls` 与 `runtime` 在 v1 host 中必须存在。`runtime.debug` 是唯一可选 debug-only service；save/history/persistent/settings/audio 在完成本 spec 后属于 v1 runtime 的正式服务，若宿主暂未实现，必须返回结构化 unavailable error，而不是让字段缺失。
- Web export V1 使用可插拔 `RuntimeStorageAdapter`，默认实现使用 `localStorage` 存 save slots、global persistent、runtime settings。V1 不把截图二进制塞进 save record；若浏览器禁用 storage，降级为 in-memory adapter 并向 renderer 暴露 warning。
- `debug` service 在 production export 中默认完全剔除。仅 Studio preview 与显式 dev build 可暴露 `runtime.debug`。

## 15. 实现记录

- `RendererProps` 已迁移为 `state` / `manifest` / `contentBase` / `stage` / `controls` / `runtime`。旧顶层 `onAdvance`、`onChoose`、`onToggleAuto`、`onToggleRecording`、`onSeekBy`、`onStepOnce`、`onPrevChapter`、`onNextChapter` 不再属于 V1 类型契约。
- `packages/engine/src/renderer.ts` 定义并导出 `RuntimeControls`、`RuntimeServices`、`SaveService`、`HistoryService`、`PersistentService`、`RuntimeSettingsService`、`AudioService`、`DebugService`、`RuntimeServiceUnavailableError`，并提供 Studio/export 可复用的 `createInMemoryRuntimeServices()` 最小实现。
- Studio project preview 与 node preview 会构造完整 `controls` / `runtime`；未落地的 skip/rollback/jump 能力以 `RuntimeServiceUnavailableError` 失败，字段不缺失。
- 默认 renderer 模板与 Tauri resource default renderer 已改为 `controls.advance()`、`controls.choose()`、`controls.setAutoPlay()`、`controls.restart()`。
- Web export runtime host 已同步生成 V1 `RendererProps`，并继续校验 `contractVersion: 1`。
- `AudioEngine` 提供 runtime audio service 所需的 BGM stop/pause/resume、voice replay/stop、SFX stop，以及 master/bgm/sfx/voice 分轨音量应用。
- `docs/renderer-contract.md` 已同步说明 V1 controls/runtime 契约、服务分组和无 v0 adapter 策略。
- TDD 覆盖：`rendererPropsRequiresControlsAdvance`、`saveServiceDoesNotMutateGlobalPersistentOnLoad`、`settingsServicePersistsVolumeIndependentlyFromSaveSlot`、`historyServiceReturnsBacklogEntriesWithStoryPoint`、`audioServiceAppliesChannelVolumesThroughRuntimeSettings`。
