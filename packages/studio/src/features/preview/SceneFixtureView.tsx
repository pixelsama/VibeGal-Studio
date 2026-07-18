/**
 * 场景刷视图 —— 把渲染层挂载到一个 fixture 场景（Spec 17 步骤 1）。
 *
 * 与剧情播放不同：没有 player，场景是静态 NovelState 快照；controls 全部
 * no-op，runtime 用 createInMemoryRuntimeServices 注入 fixture 的
 * persistent / backlog 瘦身快照，面板类场景（存档/历史/设置/画廊…）
 * 因此有确定性的真实内容。场景来源与 CLI renderer-snapshot 单源
 * （同一 snapshotScenes 模块），用户与外部 Agent 看到同一组画面。
 *
 * uiHint 时序（Spec 17 §4.1）：渲染层只在挂载初始化期读一次
 * window.__VIBEGAL_FIXTURE_UI__，因此注入必须发生在挂载之前 —— 由父组件
 * 在切换场景的事件处理器里先 setFixtureUiHintGlobal 再 setState；本组件
 * 以 key={scene.id} 强制渲染层随场景切换重挂载；自身卸载时清除该全局，
 * 避免污染剧情播放。
 */
import { useEffect, useMemo } from "react";
import {
  createInMemoryRuntimeServices,
  type RendererManifest,
  type RendererProps,
  type RuntimeControls,
} from "@vibegal/engine";
import type { ProjectData } from "../../lib/types";
import { EMPTY_MANIFEST } from "../../lib/types";
import { readStageResolution } from "../../lib/projectMeta";
import {
  buildSnapshotScenes,
  customSceneFromFixture,
  fixturePersistentToGlobal,
  type FixtureScene,
} from "../../export/snapshotScenes";
import { StageFrame } from "./StageFrame";

export interface SceneFixtureViewProps {
  project: ProjectData;
  renderer: RendererManifest;
  scene: FixtureScene;
}

/** 设置/清除 uiHint 全局：渲染层把它当作初始 UI 状态读一次（无 uiHint 时删除）。 */
export function setFixtureUiHintGlobal(uiHint: FixtureScene["uiHint"] | undefined): void {
  const target = window as { __VIBEGAL_FIXTURE_UI__?: unknown };
  if (uiHint) {
    target.__VIBEGAL_FIXTURE_UI__ = uiHint;
  } else {
    delete target.__VIBEGAL_FIXTURE_UI__;
  }
}

/** fixture 路径 → 场景 id：取文件名去掉 .json（与 CLI worker 的命名一致）。 */
export function fixtureSceneIdFromPath(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  return name.replace(/\.json$/i, "");
}

/**
 * 预览场景列表 = 内置快照场景（4 剧情 + 7 面板）+ 项目自定义 fixtures
 * （content/fixtures/*.json，排在内置之后）。坏 fixture 跳过 —— loader
 * 加载时已记过项目 issue，这里不再重复告警。
 */
export function fixtureScenesForPreview(project: ProjectData): FixtureScene[] {
  const builtin = buildSnapshotScenes(project.content.manifest ?? EMPTY_MANIFEST);
  const custom = (project.fixtures ?? []).flatMap((fixture) => {
    try {
      return [customSceneFromFixture(fixture.value, fixtureSceneIdFromPath(fixture.path))];
    } catch {
      return [];
    }
  });
  return [...builtin, ...custom];
}

/** 静态场景不需要播放控制：全部 no-op。 */
const FIXTURE_CONTROLS: RuntimeControls = {
  advance: () => {},
  choose: () => {},
  setAutoPlay: () => {},
  setSkipMode: () => {},
  rollbackTo: () => {},
  restart: () => {},
};

export function SceneFixtureView({ project, renderer, scene }: SceneFixtureViewProps) {
  const manifest = project.content.manifest ?? EMPTY_MANIFEST;
  // 每个场景一份独立的内存 runtime：unlock/backlog 来自 fixture 瘦身快照。
  const runtime = useMemo(
    () =>
      createInMemoryRuntimeServices({
        getState: () => scene.state,
        manifest,
        initialGlobalPersistent: fixturePersistentToGlobal(scene.persistent),
        initialBacklog: scene.backlog,
      }),
    [scene, manifest],
  );

  // 卸载（退出场景刷 / 关闭预览）时清除 uiHint 全局；注入本身由父组件的
  // 事件处理器在 setState 之前完成，保证重挂载的渲染层读到正确值。
  useEffect(() => () => setFixtureUiHintGlobal(undefined), []);

  const stage = readStageResolution(project.content.meta);
  const props: RendererProps = {
    state: scene.state,
    manifest,
    contentBase: `${project.path}/content`,
    stage,
    controls: FIXTURE_CONTROLS,
    runtime,
  };
  const Renderer = renderer.Component;

  return (
    <StageFrame stage={stage}>
      {/* key 强制渲染层随场景切换重挂载（uiHint 只在挂载初始化期读取） */}
      <Renderer key={scene.id} {...props} />
    </StageFrame>
  );
}
