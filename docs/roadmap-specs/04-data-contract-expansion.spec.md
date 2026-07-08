# Spec 04 — Data Contract Expansion

> 状态：草案。
> 目标：扩展 GalStudio 项目的数据表达能力，让正规 galgame 所需资源和解锁项有稳定 schema，同时不把展示方式写进 Studio。

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

建议从纯 `id -> path` 逐步升级到可带元数据的形式。

兼容策略：

- V1 支持旧字符串形式；
- 新形式支持对象；
- schema parse 后归一化。

候选：

```ts
type AssetRef = string | {
  path: string;
  name?: string;
  tags?: string[];
  thumbnail?: string;
};
```

### 3.2 CG Registry

候选：

```ts
interface CgRegistry {
  [id: string]: AssetRef & {
    group?: string;
    unlockId?: string;
  };
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

候选：

```ts
interface VideoRegistry {
  [id: string]: AssetRef & {
    poster?: string;
    skippable?: boolean;
  };
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

候选：

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

候选：

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

候选：

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

候选：

```ts
interface UnlockRegistry {
  cg: Record<string, { assetId: string; title?: string }>;
  music: Record<string, { audioId: string; title?: string }>;
  replay: Record<string, { nodeId: string; title?: string }>;
  endings: Record<string, { title: string; nodeId?: string }>;
}
```

### 4.2 Unlock Instructions

可新增指令：

```json
{ "t": "unlock", "kind": "cg", "id": "cg_001" }
```

或将 unlock 作为 edge/node metadata，需在设计时决定。

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

建议先设计 AST：

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

## 10. 开放问题

- CG/video/font registry 放在 `manifest.json` 顶层，还是 `assets` 子对象下？
- `unlock` 是指令、node metadata，还是 edge metadata？
- replay scene 是否引用 nodeId，还是引用稳定 story range？
- UI skin 是否应该属于 renderer-local config 而不是 global manifest？
- 资源 display name 是否要本地化？
