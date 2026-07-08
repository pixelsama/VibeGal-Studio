# Spec 06 — Persistent Runtime Save And Restore

> 状态：已决策，待开发。
> 前置：[Spec 01](../archive/01-runtime-contract-foundation.spec.md)、[Spec 02](../archive/02-renderer-runtime-api.spec.md)、[Spec 05](../archive/05-export-packaging.spec.md)。
> 目标：把 save/load/quick save/auto save 从 V1 的类型与最小服务推进到真实可恢复的 runtime 能力。

## 1. 背景

V1 已经建立：

- `RuntimeSnapshot` / `SaveSlotRecord` / `GlobalPersistentRecord` / `RuntimeSettingsRecord` 类型；
- `RendererProps.runtime.save` service 形状；
- Studio preview 与 Web export 的最小 runtime service；
- Web export 的 storage adapter。

但 V1 仍然没有完整做到：

- 读档后真正恢复 player 到指定剧情点；
- decision log 与 checkpoint 的恢复策略；
- save slot/global/settings 的 schema migration；
- Studio preview 与 Web export 的持久化行为一致；
- save/load 错误能被 renderer 稳定展示。

本 spec 补齐这些 runtime 能力，不实现正式存档菜单 UI。

## 2. 产品边界

engine/runtime/host 负责：

- save slot/global/settings 的持久化 adapter；
- save/load/quick/auto 的 service 行为；
- snapshot 与 decision log 的恢复；
- schema version 与 migration；
- structured load warning/error。

renderer 负责：

- 存档菜单长什么样；
- 存档卡片、确认弹窗、缩略图展示；
- 错误提示如何排版。

Studio 只提供 preview/debug 入口，不实现最终游戏存档菜单。

## 3. V1.1 决策

- Save slot 恢复以 `checkpoint` 为主，`decision log` 为辅助。能直接恢复 snapshot 时直接应用 snapshot；snapshot 无法匹配当前内容时尝试 decision log replay；仍失败则停在最近可确定 node 并返回 load warning。
- `GraphNovelPlayer` 需要新增明确的 restore API，而不是让 host 直接改私有字段。
- Save slot、global persistent、settings 使用独立 storage key；load save slot 不覆盖 global persistent 或 settings。
- quick save 固定 slot id 为 `quick`；auto save 使用 `auto:<reason>`，同 reason 覆盖旧记录。
- schema migration 从 version 1 开始，所有 record 都必须带 `schemaVersion`；未知未来版本不能静默读取。
- Web export 默认使用 `localStorage` adapter；Studio preview 使用 project-local preview adapter 或 in-memory adapter，但接口必须一致。
- 截图/缩略图 V1.1 仍只保存轻量 `SavePreview` 文本和背景 id，不保存二进制截图。

## 4. 功能范围

### 4.1 Storage Adapter

定义共享接口：

```ts
interface RuntimePersistenceAdapter {
  listSaveSlots(projectId: string): Promise<string[]>;
  readSaveSlot(projectId: string, slotId: string): Promise<SaveSlotRecord | null>;
  writeSaveSlot(projectId: string, slotId: string, record: SaveSlotRecord): Promise<void>;
  deleteSaveSlot(projectId: string, slotId: string): Promise<void>;
  readGlobal(projectId: string): Promise<GlobalPersistentRecord>;
  writeGlobal(projectId: string, record: GlobalPersistentRecord): Promise<void>;
  readSettings(projectId: string): Promise<RuntimeSettingsRecord>;
  writeSettings(projectId: string, record: RuntimeSettingsRecord): Promise<void>;
}
```

### 4.2 Player Restore API

`GraphNovelPlayer` 需要支持：

- `createSnapshot()`;
- `restoreSnapshot(snapshot, options)`;
- `restoreFromSave(record)`;
- `jumpToStoryPoint(point, options)`;
- load warning 返回值。

restore 不应重播 one-shot SFX/voice；BGM 可恢复到 snapshot 中的语义状态。

### 4.3 Migration

新增：

- `migrateSaveSlotRecord(raw)`;
- `migrateGlobalPersistentRecord(raw)`;
- `migrateRuntimeSettingsRecord(raw)`;
- migration error code。

## 5. 非目标

- 不做正式存档菜单。
- 不保存截图二进制。
- 不做云存档。
- 不做加密。
- 不做跨项目导入存档。

## 6. 验收标准

- `runtime.save.save()` 写入 adapter，`listSlots()` 能读回 summary。
- `runtime.save.load()` 能恢复当前 player 状态到 save slot 的 checkpoint。
- load 不覆盖 global persistent 和 settings。
- quick save/load 与 auto save 行为稳定。
- 未知 schema version 给 structured error。
- Web export 与 Studio preview 复用同一 persistence service contract。

## 7. TDD 清单

| 测试名 | 断言 |
| --- | --- |
| `saveServiceWritesSlotToAdapter` | save slot 写入 adapter 且 summary 可读 |
| `loadServiceRestoresCheckpointState` | load 后 player state 恢复到 checkpoint |
| `loadServiceDoesNotRollbackGlobalPersistent` | load 不回滚已读/解锁 |
| `loadServiceDoesNotOverwriteSettings` | load 不覆盖音量/文字速度 |
| `quickSaveOverwritesQuickSlot` | quick save 固定覆盖 quick slot |
| `autoSaveUsesReasonScopedSlot` | auto save 按 reason 写入 auto slot |
| `saveMigrationRejectsFutureVersion` | 未知未来版本给 structured error |
| `webRuntimeSavePersistsAcrossRuntimeInstances` | Web runtime 重建后仍能读到保存记录 |
