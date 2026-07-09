# Spec 04 — Data Contract Expansion

> 状态：已归档。
> 目标：扩展 VibeGal-Studio 项目的数据表达能力，让正规 galgame 所需资源和解锁项有稳定 schema，同时不把展示方式写进 Studio。

## 1. 背景

当前 `manifest.json` 只有：

- characters；
- backgrounds；
- audio.bgm；
- audio.sfx；
- audio.voice。

这足够基础预览，但不足以描述完整 galgame 项目。正规项目通常需要：

- CG；
- 视频；
- 字体；
- UI skin；
- gallery；
- replay scene；
- ending；
- unlock metadata；
- resource display names/tags/thumbnails。

本 spec 只扩展数据契约，不定义正式 UI。

## 2. 产品边界

Studio 应：

- 管理资源注册表；
- 校验资源引用；
- 展示资源预览；
- 帮助作者维护 manifest。

renderer 应：

- 决定 CG 如何展示；
- 决定视频如何播放；
- 决定字体如何加载和使用；
- 决定 UI skin 如何呈现；
- 决定 gallery/replay/ending 菜单长什么样。

## 3. Manifest 扩展

### 3.1 Asset Metadata

V1 从纯 `id -> path` 逐步升级到可带元数据的形式。

兼容策略：

- V1 支持旧字符串形式；
- 新形式支持对象；
- schema parse 后归一化。

V1 输入与归一化类型：

```ts
type AssetRefInput = string | AssetRef;

interface AssetRef {
  path: string;
  name?: string;
  tags?: string[];
  thumbnail?: string;
}
```

schema 允许旧的字符串形式，但 engine / Studio 读取后应归一化为 `AssetRef` 对象，避免后续分析逻辑到处判断 string/object。

### 3.2 CG Registry

V1 registry：

```ts
interface CgRegistry {
  [id: string]: AssetRefInput | (AssetRef & {
    group?: string;
    unlockId?: string;
  });
}
```

用途：

- 供 `showCg` 或 renderer gallery 使用；
- 供 unlock system 标记解锁。

不定义：

- CG gallery UI；
- CG 转场动画；
- CG 缩放手势。

### 3.3 Video Registry

V1 registry：

```ts
interface VideoRegistry {
  [id: string]: AssetRefInput | (AssetRef & {
    poster?: string;
    skippable?: boolean;
  });
}
```

用途：

- OP/ED；
- 过场动画；
- 剧情视频。

不定义：

- 视频播放器 UI；
- 字幕样式；
- 平台 codec 策略。

### 3.4 Font Registry

V1 registry：

```ts
interface FontRegistry {
  [id: string]: {
    path: string;
    family: string;
    weight?: string;
    style?: string;
  };
}
```

用途：

- renderer 可加载项目字体；
- Studio 可检查缺失字体文件。

### 3.5 UI Skin Registry

V1 registry：

```ts
interface UiSkinRegistry {
  [id: string]: {
    name?: string;
    assets: Record<string, string>;
    tokens?: Record<string, string | number>;
  };
}
```

注意：UI skin 是 renderer 可消费的数据，不是 Studio 内置 UI。

### 3.6 Animation Atlas Registry

V1 registry：

```ts
interface AnimationAtlasRegistry {
  [id: string]: {
    image: string;
    json?: string;
    frameWidth?: number;
    frameHeight?: number;
  };
}
```

不在本阶段定义通用 timeline，只注册资源。

## 4. Unlock and Ending Contracts

### 4.1 Unlock Registry

V1 registry：

```ts
interface UnlockRegistry {
  cg: Record<string, { assetId: string; title?: string }>;
  music: Record<string, { audioId: string; title?: string }>;
  replay: Record<string, { nodeId: string; title?: string }>;
  endings: Record<string, { title: string; nodeId?: string }>;
}
```

### 4.2 Unlock Instructions

V1 新增显式指令：

```json
{ "t": "unlock", "kind": "cg", "id": "cg_001" }
```

原则：

- unlock 改写 global persistent；
- 不属于 save slot；
- renderer 显示解锁结果。

## 5. Expression Contract Expansion

当前 condition DSL 很轻。

未来可增加：

- `&&`
- `||`
- parentheses
- numeric arithmetic for `set`
- `+=` / `-=`

但必须保持：

- 可静态解析；
- 可静态分析变量读写；
- 不允许任意 JS；
- 不允许 renderer 自定义条件脚本；
- CLI 可给机器可读错误。

V1 先设计 AST：

```ts
type Expr =
  | { type: "var"; name: string }
  | { type: "literal"; value: string | number | boolean | null }
  | { type: "binary"; op: "==" | "!=" | ">" | "<" | ">=" | "<=" | "&&" | "||"; left: Expr; right: Expr };
```

## 6. Schema and Migration

要求：

- 更新 engine Zod schema。
- 导出 `.galstudio/schemas/*.json`。
- `check:schemas` 能检测漂移。
- CLI validate 覆盖新增字段。
- 旧 manifest 字符串形式保持兼容。
- 新项目模板可逐步引入空 registry。

## 7. 非目标

- 不做 gallery UI。
- 不做 video player UI。
- 不做 UI skin visual editor。
- 不做 Live2D/Spine 专用 runtime。
- 不做 shader/particle contract。
- 不做通用脚本语言。

## 8. 验收标准

- manifest 支持 CG/video/font/UI skin 等 registry。
- 新 registry 能被 schema 校验。
- 缺失资源能进入 asset report。
- 未使用资源能被 asset usage 分析发现。
- unlock registry 与 global persistent 有清晰关系。
- renderer contract 文档说明如何消费扩展数据。

## 9. TDD 清单

| 测试名 | 断言 |
| --- | --- |
| `manifestAcceptsLegacyStringAssetRefs` | 旧 `id -> path` 形式仍合法 |
| `manifestAcceptsObjectAssetRefs` | 新对象形式合法并保留 metadata |
| `validateAssetsReportsMissingCgFile` | CG 文件缺失进入 asset report |
| `validateAssetsReportsMissingVideoFile` | video 文件缺失进入 asset report |
| `unlockInstructionReferencesKnownUnlockId` | unlock 指令引用不存在 id 报错 |
| `expressionParserRejectsArbitraryJs` | 条件表达式不能执行任意 JS |
| `expressionAnalyzerCollectsVariableReads` | 表达式 AST 可提取变量读点 |

## 10. V1 决策

- 新 registry 放在 `manifest.json` 顶层，延续现有 `characters`、`backgrounds`、`audio` 的项目级 manifest 模型。V1 字段名为 `cg`、`videos`、`fonts`、`uiSkins`、`animationAtlases`、`unlocks`，不新增 `assets` 包裹层。
- 解锁采用显式 `unlock` 指令。node/edge metadata 不在 V1 中改写全局进度；这样解锁发生点可被 interpreter、backlog、回放和测试明确捕捉。
- Replay scene V1 引用 `nodeId` 作为回想入口。稳定 story range 依赖 Spec 01 后续扩展，暂不阻塞 replay registry。
- `uiSkins` 是全局 manifest 中的项目级资源注册表，Studio 只校验路径和 metadata；renderer-local 的私有配置仍可放在 `renderers/<id>/` 内，但不替代 manifest 中可被导出和分析的资源声明。
- 资源显示名 V1 只支持单一 `name` 字段，不做本地化 map。未来多语言项目再扩展为 `names: Record<locale, string>`，但不提前增加复杂度。
- Expression V1 只实现可静态解析的比较、`&&`、`||` 和括号；`set` 的算术、`+=`、`-=` 延后。所有表达式分析基于 AST，禁止任意 JS。

## 11. 实际实现记录（2026-07-08）

- engine `ManifestSchema` 已扩展 `cg`、`videos`、`fonts`、`uiSkins`、`animationAtlases`、`unlocks`，并保持旧字符串资产引用兼容；`cg` / `videos` 在 parse 后归一化为对象形式。
- engine / backend 节点校验均支持 `{"t":"unlock","kind","id"}`，并会对不存在的 unlock id 报错。
- backend asset report 已覆盖 `cg`、`videos`、`fonts`、`uiSkins`、`animationAtlases` 以及 `thumbnail` / `poster` / atlas `json` 等缺失路径。
- engine 已新增静态表达式 AST / parser / evaluator / variable-read extraction，支持比较、`&&`、`||`、括号，并拒绝任意 JS、赋值、`+=`、`-=`。
- JSON Schema 快照已同步导出，`renderer-contract.md` 已补充扩展 manifest registry 的消费说明。
- 本次按可归档 V1 收束，不扩张到 gallery / video player / UI skin editor / 通用脚本语言；未新增独立的“未使用 manifest 资源”分析入口，只扩展了现有 missing/orphan 资产校验面。
