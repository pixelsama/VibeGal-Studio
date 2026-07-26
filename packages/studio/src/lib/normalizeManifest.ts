import type { Manifest } from "./types";

/**
 * 归一化 open_project 系命令返回的 manifest。
 *
 * 后端原样返回 manifest.json 原文，不套用 schema 默认值；而前端 Manifest
 * 类型把 characters/audio/unlocks 等注册表标为必填。缺省这些字段的项目
 * （例如手写或旧版 manifest 没有 unlocks）会让信任类型的 UI 代码
 * （如 Object.entries(manifest.unlocks.endings)）在渲染或交互时抛 TypeError，
 * 渲染期抛错在没有 ErrorBoundary 时表现为整个应用白屏。
 *
 * 这里把缺失的注册表补成空表，让类型断言在运行时为真。未知的额外字段
 * 原样保留；结构问题仍由后端校验报告（project_report）呈现，不在此掩盖。
 */
export function normalizeManifest(raw: Manifest): Manifest {
  const partial = (raw ?? {}) as Partial<Manifest>;
  return {
    ...(raw ?? {}),
    characters: partial.characters ?? {},
    backgrounds: partial.backgrounds ?? {},
    audio: { bgm: {}, sfx: {}, voice: {}, ...(partial.audio ?? {}) },
    cg: partial.cg ?? {},
    videos: partial.videos ?? {},
    fonts: partial.fonts ?? {},
    uiSkins: partial.uiSkins ?? {},
    animationAtlases: partial.animationAtlases ?? {},
    unlocks: { cg: {}, music: {}, replay: {}, endings: {}, ...(partial.unlocks ?? {}) },
  };
}
