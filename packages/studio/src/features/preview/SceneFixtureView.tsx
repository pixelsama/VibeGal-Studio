/**
 * 场景刷视图 —— 把渲染层挂载到一个 fixture 场景（Spec 17 步骤 1）。
 *
 * 与剧情播放不同：没有 player，场景是静态 NovelState 快照；controls 全部
 * no-op，runtime 用 createInMemoryRuntimeServices 注入 fixture 的
 * persistent / backlog 瘦身快照，面板类场景（存档/历史/设置/画廊…）
 * 因此有确定性的真实内容。场景来源与 CLI renderer-snapshot 单源
 * （同一 snapshotScenes 模块），用户与外部 Agent 看到同一组画面。
 *
 * uiHint 时序（Spec 17 §4.1 + Spec 21 修订）：渲染层只在挂载初始化期读一次
 * window.__VIBEGAL_FIXTURE_UI__。父组件在切换场景的事件处理器里先
 * setFixtureUiHintGlobal 再 setState（单场景路径的双保险）；本组件另外在
 * 渲染体中 stash/覆盖本场景 hint（宫格多棵渲染层子树共存时，每棵挂载读到
 * 的都是自己场景的 hint），卸载时恢复旧值。以 key={scene.id} 强制渲染层随
 * 场景切换重挂载。
 */
import { useEffect, useMemo, useRef } from "react";
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

/** uiHint 全局的快照（stash/restore 成对使用）。 */
interface FixtureUiHintStash {
  present: boolean;
  value: unknown;
}

/**
 * 写入本场景 uiHint 并返回旧值快照；非浏览器环境（SSR 测试无 window）退化为空快照。
 */
function stashFixtureUiHintGlobal(uiHint: FixtureScene["uiHint"] | undefined): FixtureUiHintStash {
  if (typeof window === "undefined") return { present: false, value: undefined };
  const target = window as { __VIBEGAL_FIXTURE_UI__?: unknown };
  const stash: FixtureUiHintStash = {
    present: "__VIBEGAL_FIXTURE_UI__" in target,
    value: target.__VIBEGAL_FIXTURE_UI__,
  };
  setFixtureUiHintGlobal(uiHint);
  return stash;
}

/** 恢复 stashFixtureUiHintGlobal 保存的旧值。 */
function restoreFixtureUiHintGlobal(stash: FixtureUiHintStash): void {
  if (typeof window === "undefined") return;
  const target = window as { __VIBEGAL_FIXTURE_UI__?: unknown };
  if (stash.present) target.__VIBEGAL_FIXTURE_UI__ = stash.value;
  else delete target.__VIBEGAL_FIXTURE_UI__;
}

/** setFixtureUiHintGlobal 的浏览器守卫版（SSR 渲染体中安全调用）。 */
function setFixtureUiHintGlobalIfBrowser(uiHint: FixtureScene["uiHint"] | undefined): void {
  if (typeof window === "undefined") return;
  setFixtureUiHintGlobal(uiHint);
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
        variables: project.content.variables,
        initialGlobalPersistent: fixturePersistentToGlobal(scene.persistent),
        initialBacklog: scene.backlog,
      }),
    [scene, manifest, project.content.variables],
  );

  // uiHint 注入（Spec 21：标题门使"无注入"从"面板不预开"升级为"卡标题页"）：
  // 本组件在渲染体中保证全局 = 本场景 hint —— 父组件渲染体先于子渲染层的
  // useState 初始化执行，宫格 12 棵子树按顺序各自覆盖，每棵树挂载时读到的
  // 都是自己的 hint；卸载时恢复 stash 的旧值。父组件事件处理器的注入
  // （Preview / AppearanceWorkspace）因此变成冗余但无害的双保险。
  const stashRef = useRef<FixtureUiHintStash | null>(null);
  if (stashRef.current === null) {
    stashRef.current = stashFixtureUiHintGlobal(scene.uiHint);
  } else {
    // 场景 prop 变化（key 强制子渲染层重挂载）：覆盖为新场景 hint；
    // stash 保持首次挂载的旧值，卸载时统一恢复。
    setFixtureUiHintGlobalIfBrowser(scene.uiHint);
  }
  useEffect(
    () => () => {
      const stash = stashRef.current;
      stashRef.current = null;
      if (stash) restoreFixtureUiHintGlobal(stash);
    },
    [],
  );

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
