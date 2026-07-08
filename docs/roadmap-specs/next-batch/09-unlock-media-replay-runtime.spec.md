# Spec 09 — Unlock Media Replay Runtime

> 状态：已决策，待开发。
> 前置：[Spec 04](../archive/04-data-contract-expansion.spec.md)、[Spec 06](./06-persistent-runtime-save-and-restore.spec.md)。
> 目标：让 unlock、CG/video、music、replay、ending 从数据契约进入 runtime side-effect 和 renderer-consumable services。

## 1. 背景

V1 已新增：

- manifest 顶层 `cg`、`videos`、`fonts`、`uiSkins`、`animationAtlases`、`unlocks`；
- `unlock` 指令；
- unlock 引用校验；
- missing asset validation。

但 V1 的 `unlock` 指令在 interpreter 中仍是 no-op，尚未写入 global persistent。CG/video/replay/ending 也还只是数据契约，没有 runtime service 行为。

本 spec 补 runtime side-effect，不做正式 gallery UI。

## 2. 产品边界

engine/runtime 负责：

- 执行 `unlock` side-effect；
- 维护 unlock state；
- 提供 gallery/replay/ending 数据查询 service；
- 对 CG/video display 指令提供语义状态或事件。

renderer 负责：

- gallery/replay/music room/ending list 的 UI；
- CG/video 如何展示；
- unlock toast 如何显示；
- 字体和 UI skin 如何应用。

Studio 负责：

- 资源/解锁数据编辑；
- 引用校验；
- 资产预览；
- 不做最终 gallery。

## 3. V1.1 决策

- `unlock` side-effect 由 runtime service 执行，不放进纯 `interpreter` 的副作用里；player 在应用 instruction 后通知 runtime effect handler。
- unlock 写入 `GlobalPersistentRecord`，不进入 save slot。
- 新开游戏不清空 unlock；读档不回滚 unlock。
- Replay registry V1.1 仍引用 `nodeId`，不引入 story range。
- 本批新增 `showCg` / `playVideo` 语义指令，用于剧情中展示媒体；具体 UI/播放器由 renderer 实现。
- Ending 解锁使用 `unlock kind: "endings"`，并可由 ending node 或显式 unlock 指令触发。

## 4. 功能范围

### 4.1 Runtime Unlock Effects

新增 runtime effect event：

```ts
type RuntimeEffect =
  | { type: "unlock"; kind: "cg" | "music" | "replay" | "endings"; id: string }
  | { type: "showCg"; id: string }
  | { type: "playVideo"; id: string };
```

### 4.2 Media Instructions

V1.1 schema：

```json
{ "t": "showCg", "id": "cg_001" }
{ "t": "playVideo", "id": "op", "skippable": true }
```

Validation 检查 id 存在于 manifest。

### 4.3 Renderer Services

扩展 `RuntimeServices`：

- `gallery.listCg()`;
- `gallery.listMusic()`;
- `gallery.listReplays()`;
- `gallery.listEndings()`;
- `gallery.isUnlocked(kind, id)`;
- `media.closeCg()`;
- `media.skipVideo()`;

服务只提供数据和命令，不提供 UI。

## 5. 非目标

- 不做 CG gallery UI。
- 不做 video player UI。
- 不做 music room UI。
- 不做 Live2D/Spine runtime。
- 不做 shader/particle contract。

## 6. 验收标准

- `unlock` 指令写入 global persistent。
- 读档不会回滚 unlock。
- `showCg` / `playVideo` 引用不存在资源时报错。
- renderer 可通过 service 获取已解锁 CG/music/replay/ending。
- Web export 与 Studio preview unlock 行为一致。

## 7. TDD 清单

| 测试名 | 断言 |
| --- | --- |
| `unlockInstructionWritesGlobalPersistent` | unlock 指令写入 global persistent |
| `loadSaveDoesNotRollbackUnlocks` | 读档不回滚解锁 |
| `showCgReferencesKnownCgAsset` | showCg 引用缺失 CG 报错 |
| `playVideoReferencesKnownVideoAsset` | playVideo 引用缺失 video 报错 |
| `galleryServiceListsUnlockedCg` | gallery service 只列出已解锁 CG |
| `replayServiceReturnsKnownReplayEntry` | replay registry 可被 runtime service 查询 |
| `webRuntimePersistsUnlocksAcrossReload` | Web runtime 重建后 unlock 仍存在 |
