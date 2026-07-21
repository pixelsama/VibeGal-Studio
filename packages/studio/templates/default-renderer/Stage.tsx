import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { resolveAsset, type BacklogEntry, type RendererProps, type RuntimeSettingsRecord, type SaveSlotSummary } from "@vibegal/engine";
import { BackgroundLayer } from "./BackgroundLayer";
import { SpriteLayer } from "./SpriteLayer";
import { DialogueBox } from "./DialogueBox";
import { Effects } from "./Effects";
import { EndingsPanel, GalleryPanel, MusicRoomPanel, ReplayPanel } from "./GalleryPanels";
import { HistoryPanel } from "./HistoryPanel";
import { PlayerHud } from "./PlayerHud";
import { ConfirmDialog, PlayerMenu, SystemPanel, type PlayerNotice } from "./PlayerMenu";
import { RuntimeSettingsPanel } from "./RuntimeSettingsPanel";
import { SaveLoadPanel } from "./SaveLoadPanel";
import { TitleScreen } from "./TitleScreen";
import {
  PlayerUiController,
  buildPlayerSlots,
  isPlayerShortcutTarget,
  pickContinueSlot,
  readFixtureUiHintMenuPage,
  readFixtureUiHintScreen,
  runtimeErrorDetails,
  type PlayerMenuPage,
  type PlayerSlotView,
  type TitleGateScreen,
} from "./playerUiModel";
import { useShake } from "./useShake";
import { resolveUiSkinAssets, useUiTokens, type ChoiceBoxTokens, type ChoiceButtonTokens } from "./useUiTokens";
import { palette } from "./uiTheme";

type ConfirmAction =
  | { kind: "overwrite"; slot: PlayerSlotView }
  | { kind: "delete"; slot: PlayerSlotView }
  | { kind: "rollback"; entry: BacklogEntry }
  | { kind: "restart" };

const fallbackSettings: RuntimeSettingsRecord = {
  schemaVersion: 1,
  textSpeedCps: 30,
  autoAdvanceMs: 1_200,
  volumes: { master: 1, bgm: 0.8, sfx: 1, voice: 1 },
};

export function Stage({ state, manifest, contentBase, controls, runtime }: RendererProps) {
  // uiHint（fixture 场景宿主，Spec 17 第 4.1 节）：挂载前若存在
  // window.__VIBEGAL_FIXTURE_UI__ = { panel }，把它当作初始 UI 状态读一次；
  // 无该全局时初始 menuPage = null，与现状完全一致。
  const [menuPage, setMenuPage] = useState<PlayerMenuPage | null>(() => readFixtureUiHintMenuPage());
  // 标题门（Spec 21）：渲染层内部 React state，不进 NovelState。挂载读一次
  // uiHint.screen（语义表见 playerUiModel.readFixtureUiHintScreen）；真实启动
  // （无 uiHint 全局）= 标题画面，{ screen: "story" } 或携带 panel = 直进剧情。
  const [screen, setScreen] = useState<TitleGateScreen>(() => readFixtureUiHintScreen());
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<PlayerNotice | null>(null);
  const [slots, setSlots] = useState(() => buildPlayerSlots([]));
  const [settings, setSettings] = useState<RuntimeSettingsRecord>(() => runtime?.settings.getSettings() ?? fallbackSettings);
  const [choiceHint, setChoiceHint] = useState<string | null>(null);
  // 标题页「继续游戏」的槽位数据（进入标题屏时拉取一次）。
  const [titleSlots, setTitleSlots] = useState<SaveSlotSummary[]>([]);
  const stateRef = useRef(state);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 「开始游戏」只在第一次进入故事时推进首行；「回到标题」后再点开始直接回到剧情。
  const hasEnteredStoryRef = useRef(false);
  // 标题 BGM 是否由本组件启动（进入故事/卸载时只停自己起的）。
  const titleBgmPlayingRef = useRef(false);
  const hideControls = state.flags.isRecording;
  const { containerStyle: shakeStyle, keyframes: shakeKeyframes } = useShake(state);
  const uiTokens = useUiTokens(manifest);
  // uiSkin assets 槽位（Spec 21 §6）：titleBackground / titleBgm → manifest 注册表资产 id。
  const skinAssets = useMemo(() => resolveUiSkinAssets(manifest), [manifest]);
  const titleBackgroundUrl = useMemo(() => {
    const assetId = skinAssets.titleBackground;
    const path = assetId ? manifest.backgrounds?.[assetId] : undefined;
    return path ? resolveAsset(contentBase, path) : null;
  }, [skinAssets, manifest, contentBase]);
  const titleBgmId = useMemo(() => {
    const assetId = skinAssets.titleBgm;
    return assetId && manifest.audio?.bgm?.[assetId] ? assetId : null;
  }, [skinAssets, manifest]);

  stateRef.current = state;
  const controller = useMemo(
    () => runtime ? new PlayerUiController(runtime, () => stateRef.current, setBusy) : null,
    [runtime],
  );

  useEffect(() => {
    setChoiceHint(null);
  }, [state.choice]);

  useEffect(() => {
    if (!hideControls) return;
    setMenuPage(null);
    setConfirmAction(null);
  }, [hideControls]);

  // 标题屏可见时拉取槽位列表：「继续游戏」取 updatedAt 最新槽（含 auto/quick），
  // 无存档时「继续/读档」禁用。
  useEffect(() => {
    if (screen !== "title" || !runtime) return;
    let cancelled = false;
    runtime.save.listSlots()
      .then((summaries) => {
        if (!cancelled) setTitleSlots(summaries);
      })
      .catch((error) => {
        if (!cancelled) showError(error);
      });
    return () => {
      cancelled = true;
    };
  }, [screen, runtime]);

  // 标题 BGM（Spec 21 §6）：titleBgm 资产 id 可解析时循环播放；进入故事或
  // 卸载时停止（剧情 bgm 指令接管）。音频桥不可用时静默降级为无 BGM。
  useEffect(() => {
    if (screen !== "title" || !titleBgmId || !runtime) return;
    try {
      runtime.audio.playMusic(titleBgmId, { loop: true });
      titleBgmPlayingRef.current = true;
    } catch {
      titleBgmPlayingRef.current = false;
    }
    return () => {
      if (!titleBgmPlayingRef.current) return;
      titleBgmPlayingRef.current = false;
      try {
        runtime.audio.stopMusic(300);
      } catch {
        // 音频桥不可用：忽略
      }
    };
  }, [screen, titleBgmId, runtime]);

  // uiHint：挂载时若带初始面板，补齐该面板的数据加载副作用（等价 openMenu 的数据面），
  // 但不触碰播放控制。只跑一次；无 hint（menuPage 初始为 null）时什么都不做。
  useEffect(() => {
    if (menuPage === "save") void refreshSlots();
    if (menuPage === "settings" && runtime) setSettings(runtime.settings.getSettings());
    // 仅在挂载时执行一次，故意留空依赖
  }, []);

  useEffect(() => () => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
  }, []);

  const showNotice = (next: PlayerNotice, transient = false) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setNotice(next);
    if (transient) {
      noticeTimerRef.current = setTimeout(() => {
        setNotice(null);
        noticeTimerRef.current = null;
      }, 2_200);
    }
  };

  const showError = (error: unknown) => {
    const details = runtimeErrorDetails(error);
    showNotice({ tone: "error", code: details.code, message: details.message });
  };

  useEffect(() => {
    const status = runtime?.status;
    if (!status) return;
    const showLatest = () => {
      const latest = status.getNotices().at(-1);
      if (!latest) return;
      showNotice({
        tone: latest.level,
        code: latest.code,
        message: latest.message,
      });
    };
    showLatest();
    return status.subscribe(showLatest);
  }, [runtime]);

  const showWarnings = (warnings: Array<{ code: string; message: string }>) => {
    if (warnings.length === 0) return false;
    showNotice({
      tone: "warning",
      code: warnings[0].code,
      message: warnings.map((warning) => warning.message).join(" "),
    });
    return true;
  };

  const refreshSlots = async () => {
    if (!controller) return;
    try {
      setSlots(await controller.listSlots());
    } catch (error) {
      showError(error);
    }
  };

  const stopAutomatedPlayback = () => {
    if (stateRef.current.flags.isAutoPlay) controls.setAutoPlay(false);
    if (stateRef.current.flags.skipMode !== "off") controls.setSkipMode("off");
  };

  const openMenu = (page: PlayerMenuPage) => {
    if (!runtime || hideControls) return;
    stopAutomatedPlayback();
    setNotice(null);
    setMenuPage(page);
    setConfirmAction(null);
    if (page === "save") void refreshSlots();
    if (page === "settings") setSettings(runtime.settings.getSettings());
  };

  const changeMenuPage = (page: PlayerMenuPage) => {
    if (!runtime || hideControls || busy || confirmAction) return;
    setNotice(null);
    setMenuPage(page);
    if (page === "save") void refreshSlots();
    if (page === "settings") setSettings(runtime.settings.getSettings());
  };

  const closeMenu = () => {
    if (busy || confirmAction) return;
    setMenuPage(null);
    setNotice(null);
  };

  const performSave = async (slot: PlayerSlotView) => {
    if (!controller) return;
    try {
      await controller.save(slot.slotId, slot.label);
      showNotice({ tone: "success", message: `${slot.label}已保存。` }, true);
      await refreshSlots();
    } catch (error) {
      showError(error);
    }
  };

  const requestSave = (slot: PlayerSlotView) => {
    if (!slot.empty && slot.kind === "manual") {
      setConfirmAction({ kind: "overwrite", slot });
      return;
    }
    void performSave(slot);
  };

  const performQuickSave = async () => {
    if (!controller) return;
    try {
      await controller.quickSave();
      showNotice({ tone: "success", message: "快速存档完成。" }, true);
      if (menuPage === "save") await refreshSlots();
    } catch (error) {
      setMenuPage("save");
      void refreshSlots();
      showError(error);
    }
  };

  const handleRestoreResult = (warnings: Array<{ code: string; message: string }>) => {
    if (showWarnings(warnings)) return;
    setConfirmAction(null);
    setMenuPage(null);
    // 标题屏上的读档/继续成功后直进剧情（剧情位置已被 runtime 恢复）。
    hasEnteredStoryRef.current = true;
    setScreen("story");
    showNotice({ tone: "success", message: "剧情位置已恢复。" }, true);
  };

  const performQuickLoad = async () => {
    if (!controller) return;
    stopAutomatedPlayback();
    try {
      const result = await controller.quickLoad();
      if (result.warnings.length > 0 && menuPage == null) {
        setMenuPage("save");
        void refreshSlots();
      }
      handleRestoreResult(result.warnings);
    } catch (error) {
      setMenuPage("save");
      void refreshSlots();
      showError(error);
    }
  };

  const performLoad = async (slot: PlayerSlotView) => {
    if (!controller) return;
    try {
      const result = await controller.load(slot.slotId);
      handleRestoreResult(result.warnings);
    } catch (error) {
      showError(error);
    }
  };

  // ── 标题门动作（Spec 21 §5） ──

  /** 进入故事：停标题 BGM（剧情 bgm 指令接管），切屏；firstEntry 时推进首行。 */
  const enterStory = (firstEntry: boolean) => {
    if (titleBgmPlayingRef.current) {
      titleBgmPlayingRef.current = false;
      try {
        runtime?.audio.stopMusic(300);
      } catch {
        // 音频桥不可用：忽略
      }
    }
    setNotice(null);
    setScreen("story");
    if (firstEntry) controls.advance();
  };

  /** 开始游戏：首次进入推进到首行；「回到标题」后再点开始直接回到当前剧情。 */
  const handleTitleStart = () => {
    const firstEntry = !hasEnteredStoryRef.current;
    hasEnteredStoryRef.current = true;
    enterStory(firstEntry);
  };

  /** 继续游戏（定点）：updatedAt 最新槽（含 auto/quick）直进。 */
  const performTitleContinue = async () => {
    if (!controller) return;
    const latest = pickContinueSlot(titleSlots);
    if (!latest) return;
    try {
      const result = await controller.load(latest.slotId);
      handleRestoreResult(result.warnings);
    } catch (error) {
      showError(error);
    }
  };

  /** 回到标题（定点最小版）：渲染层内部切回标题屏，不 reset player。 */
  const returnToTitle = () => {
    setMenuPage(null);
    setConfirmAction(null);
    setNotice(null);
    setScreen("title");
  };

  const performDelete = async (slot: PlayerSlotView) => {
    if (!controller) return;
    try {
      await controller.delete(slot.slotId);
      setConfirmAction(null);
      showNotice({ tone: "success", message: `${slot.label}已删除。` }, true);
      await refreshSlots();
    } catch (error) {
      showError(error);
    }
  };

  const performRollback = async (entry: BacklogEntry) => {
    if (!controller) return;
    try {
      const result = await controller.rollback(entry.id);
      if (showWarnings(result.warnings)) return;
      setConfirmAction(null);
      setMenuPage(null);
      showNotice({ tone: "success", message: "已回滚到所选历史位置。" }, true);
    } catch (error) {
      showError(error);
    }
  };

  const replayVoice = (entry: BacklogEntry) => {
    try {
      runtime?.history.replayVoice(entry.id);
    } catch (error) {
      showError(error);
    }
  };

  const saveSettings = async (patch: Partial<RuntimeSettingsRecord>): Promise<boolean> => {
    if (!controller || !runtime) return false;
    try {
      const saved = await controller.updateSettings(patch);
      setSettings(saved);
      showNotice({ tone: "success", message: "运行时设置已保存。" }, true);
      return true;
    } catch (error) {
      setSettings(runtime.settings.getSettings());
      showError(error);
      return false;
    }
  };

  const performStartReplay = async (replayId: string) => {
    if (!controller) return;
    stopAutomatedPlayback();
    try {
      const result = await controller.startReplay(replayId);
      if (showWarnings(result.warnings)) return;
      setMenuPage(null);
      showNotice({ tone: "success", message: "已启动回想。" }, true);
    } catch (error) {
      showError(error);
    }
  };

  const performPlayMusic = async (audioId: string) => {
    if (!controller) return;
    try {
      await controller.playMusic(audioId);
      showNotice({ tone: "success", message: "音乐播放中。" }, true);
    } catch (error) {
      showError(error);
    }
  };

  const performStopMusic = async () => {
    if (!controller) return;
    try {
      await controller.stopMusic();
      showNotice({ tone: "success", message: "音乐已停止。" }, true);
    } catch (error) {
      showError(error);
    }
  };

  const confirm = () => {
    if (!confirmAction) return;
    switch (confirmAction.kind) {
      case "overwrite":
        void performSave(confirmAction.slot).finally(() => setConfirmAction(null));
        break;
      case "delete":
        void performDelete(confirmAction.slot);
        break;
      case "rollback":
        void performRollback(confirmAction.entry);
        break;
      case "restart":
        controls.restart();
        setConfirmAction(null);
        setMenuPage(null);
        setNotice(null);
        break;
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const interactiveTarget = isPlayerShortcutTarget(event.target);
      const block = () => {
        event.preventDefault();
        event.stopImmediatePropagation();
      };

      if (key === "escape") {
        if (!confirmAction && !menuPage) return;
        block();
        if (confirmAction && !busy) setConfirmAction(null);
        else if (!busy) closeMenu();
        return;
      }
      // 标题屏：capture 阶段拦截 Space/Enter（与宿主 bubble 阶段的全局 advance
      // 冲突，见 webRuntimeHost 的 keydown 监听）；a/r 同样不穿透到剧情。
      if (screen === "title") {
        if ((key === " " || key === "enter" || key === "a" || key === "r") && !interactiveTarget) block();
        return;
      }
      if (key === "f5" || key === "f9") {
        block();
        if (hideControls || confirmAction || interactiveTarget || busy) return;
        if (key === "f5") void performQuickSave();
        else void performQuickLoad();
        return;
      }
      if (menuPage || confirmAction || busy) {
        if (key === " " || key === "enter" || key === "a" || key === "r") block();
        return;
      }
      if (hideControls || interactiveTarget) return;
      if (key === " " || key === "enter") {
        block();
        controls.advance();
      } else if (key === "a") {
        block();
        controls.setAutoPlay(!stateRef.current.flags.isAutoPlay);
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  });

  const confirmCopy = confirmAction ? confirmationCopy(confirmAction) : null;
  const continueSlot = pickContinueSlot(titleSlots);

  return (
    <div
      data-player-stage="true"
      data-player-screen={screen}
      data-player-blocking={screen === "title" || menuPage != null || confirmAction != null || busy ? "true" : "false"}
      tabIndex={0}
      onClick={() => {
        if (screen === "story" && !menuPage && !confirmAction && !busy) controls.advance();
      }}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: "#000",
        cursor: hideControls ? "none" : "pointer",
        userSelect: "none",
        fontFamily: uiTokens.stageFontFamily,
        containerType: "size",
      }}
    >
      {screen === "title" && (
        <>
          {/* 标题美术缺省时以剧情当前背景打底（fixture 标题场景的最小背景由此上屏） */}
          {!titleBackgroundUrl && (
            <BackgroundLayer state={state} manifest={manifest} contentBase={contentBase} />
          )}
          <TitleScreen
            manifest={manifest}
            titleBackgroundUrl={titleBackgroundUrl}
            tokens={uiTokens.titleScreen}
            continueSlot={continueSlot}
            hasSaves={titleSlots.length > 0}
            busy={busy}
            onStart={handleTitleStart}
            onContinue={() => void performTitleContinue()}
            onLoad={() => openMenu("save")}
            onSettings={() => openMenu("settings")}
          />
        </>
      )}
      {screen === "story" && (
        <>
          <div style={{ position: "absolute", inset: 0, ...shakeStyle }}>
            <BackgroundLayer state={state} manifest={manifest} contentBase={contentBase} />
            <SpriteLayer state={state} manifest={manifest} contentBase={contentBase} />
            <DialogueBox state={state} manifest={manifest} />
          </div>
          <Effects state={state} />
      <style>{shakeKeyframes}</style>

      {state.choice && (
        <div
          data-ui-part="choiceBox"
          onClick={(event) => event.stopPropagation()}
          style={choiceContainerStyle(uiTokens.choiceBox)}
        >
          {state.choice.choices.map((choice) => (
            <button
              key={`${choice.text}:${choice.to}`}
              type="button"
              data-choice-to={choice.to}
              disabled={busy || menuPage != null || confirmAction != null}
              onClick={() => {
                setChoiceHint(`将跳转到 ${choice.to}`);
                controls.choose(choice.to);
              }}
              style={choiceButtonStyle(uiTokens.choiceButton)}
            >
              {choice.text}
            </button>
          ))}
          {choiceHint && <div style={choiceHintStyle}>{choiceHint}</div>}
          {/* 悬停与入场动画走 stylesheet（inline style 表达不了 :hover / keyframes） */}
          <style>{`
            @keyframes vnChoiceIn { from { opacity: 0; transform: translateY(14px) } }
            [data-choice-to]:not(:disabled):hover {
              background: ${uiTokens.choiceButton.hoverColor} !important;
              color: ${uiTokens.choiceButton.hoverTextColor} !important;
              border-color: transparent !important;
              transform: translateY(-1px);
              box-shadow: 0 12px 28px rgba(24, 28, 48, 0.24) !important;
            }
          `}</style>
        </div>
      )}

      {!hideControls && (
        <PlayerHud
          state={state}
          busy={busy}
          hud={uiTokens.hud}
          onOpenMenu={() => openMenu("save")}
          onQuickSave={() => void performQuickSave()}
          onQuickLoad={() => void performQuickLoad()}
          onToggleAuto={() => controls.setAutoPlay(!state.flags.isAutoPlay)}
          onToggleReadSkip={() => controls.setSkipMode(state.flags.skipMode === "read" ? "off" : "read")}
          onToggleAllSkip={() => controls.setSkipMode(state.flags.skipMode === "all" ? "off" : "all")}
          onOpenHistory={() => openMenu("history")}
        />
      )}

      {!hideControls && (
        <div style={progressStyle}>
          {state.flags.progress.current}/{state.flags.progress.total}
        </div>
      )}
        </>
      )}

      {!hideControls && (notice || busy) && (
        <div
          data-player-status={notice?.tone ?? "busy"}
          role={notice?.tone === "error" ? "alert" : "status"}
          onClick={(event) => event.stopPropagation()}
          style={stageStatusStyle(notice?.tone)}
        >
          {notice?.code && <code style={stageCodeStyle}>{notice.code}</code>}
          <span>{busy ? "处理中…" : notice?.message}</span>
        </div>
      )}

      {!hideControls && menuPage && runtime && (
        <PlayerMenu
          page={menuPage}
          busy={busy}
          notice={notice}
          window={uiTokens.menuWindow}
          onPageChange={changeMenuPage}
          onClose={closeMenu}
        >
          {menuPage === "save" && (
            <SaveLoadPanel
              slots={slots}
              busy={busy}
              manifest={manifest}
              contentBase={contentBase}
              onSave={requestSave}
              onLoad={(slot) => void performLoad(slot)}
              onDelete={(slot) => setConfirmAction({ kind: "delete", slot })}
              onQuickSave={() => void performQuickSave()}
              onQuickLoad={() => void performQuickLoad()}
            />
          )}
          {menuPage === "history" && (
            <HistoryPanel
              entries={runtime.history.getBacklog()}
              busy={busy}
              onReplayVoice={replayVoice}
              onRollback={(entry) => setConfirmAction({ kind: "rollback", entry })}
            />
          )}
          {menuPage === "gallery" && (
            <GalleryPanel
              manifest={manifest}
              contentBase={contentBase}
              gallery={runtime.gallery}
              busy={busy}
            />
          )}
          {menuPage === "replay" && (
            <ReplayPanel
              manifest={manifest}
              gallery={runtime.gallery}
              busy={busy}
              onStartReplay={(replayId) => void performStartReplay(replayId)}
            />
          )}
          {menuPage === "music" && (
            <MusicRoomPanel
              manifest={manifest}
              gallery={runtime.gallery}
              busy={busy}
              onPlayMusic={(audioId) => void performPlayMusic(audioId)}
              onStopMusic={() => void performStopMusic()}
            />
          )}
          {menuPage === "endings" && (
            <EndingsPanel manifest={manifest} gallery={runtime.gallery} />
          )}
          {menuPage === "settings" && (
            <RuntimeSettingsPanel settings={settings} busy={busy} onSave={saveSettings} />
          )}
          {menuPage === "system" && (
            <SystemPanel
              busy={busy}
              onReturn={closeMenu}
              onRestart={() => setConfirmAction({ kind: "restart" })}
              onReturnToTitle={returnToTitle}
            />
          )}
        </PlayerMenu>
      )}

      {confirmCopy && confirmAction && (
        <ConfirmDialog
          {...confirmCopy}
          busy={busy}
          onConfirm={confirm}
          onCancel={() => !busy && setConfirmAction(null)}
        />
      )}
    </div>
  );
}

function confirmationCopy(action: ConfirmAction): {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
} {
  switch (action.kind) {
    case "overwrite":
      return { title: "覆盖存档", message: `确定要覆盖“${action.slot.label}”吗？`, confirmLabel: "覆盖" };
    case "delete":
      return { title: "删除存档", message: `删除“${action.slot.label}”后无法恢复。`, confirmLabel: "删除", destructive: true };
    case "rollback":
      return { title: "回滚剧情", message: `确定回到“${action.entry.text}”吗？`, confirmLabel: "回滚" };
    case "restart":
      return { title: "重新开始", message: "当前未保存的剧情进度将丢失。", confirmLabel: "重新开始", destructive: true };
  }
}

function choiceContainerStyle(box: ChoiceBoxTokens): CSSProperties {
  return {
    position: "absolute",
    left: box.x,
    top: box.y,
    width: box.width,
    // 几何 token 语义 = 部件边框盒（与 Studio 拖拽 overlay 的选框一致）
    boxSizing: "border-box",
    // height token 缺省 = 自动（约 42% 舞台高限高，超出滚动）
    maxHeight: box.height ?? "42%",
    zIndex: 70,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    overflowY: "auto",
    animation: "vnChoiceIn 0.3s ease both",
  };
}

function choiceButtonStyle(tokens: ChoiceButtonTokens): CSSProperties {
  return {
    minHeight: 48,
    background: tokens.bgColor,
    color: tokens.textColor,
    border: "1px solid rgba(255, 255, 255, 0.55)",
    borderRadius: tokens.radius,
    padding: "12px 18px",
    fontSize: tokens.fontSize,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    textAlign: "center",
    letterSpacing: "0.5px",
    boxShadow: "0 8px 24px rgba(24, 28, 48, 0.18)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    transition: "transform 0.15s ease, box-shadow 0.15s ease",
  };
}

const choiceHintStyle: CSSProperties = {
  alignSelf: "center",
  padding: "5px 12px",
  borderRadius: 999,
  background: "rgba(20, 22, 32, 0.72)",
  color: "rgba(255, 255, 255, 0.85)",
  fontSize: 11,
  textAlign: "center",
};

function stageStatusStyle(tone: PlayerNotice["tone"] | undefined): CSSProperties {
  const border =
    tone === "error" ? "#ff8a80"
    : tone === "warning" ? palette.gold
    : tone === "success" ? palette.mint
    : palette.sky;
  return {
    position: "absolute",
    top: 60,
    left: 16,
    zIndex: 90,
    maxWidth: "min(560px, calc(100% - 32px))",
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "9px 16px",
    border: `1px solid ${border}`,
    borderRadius: 999,
    background: "rgba(20, 22, 32, 0.8)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.3)",
    color: "#fff",
    font: "12px/1.4 system-ui, sans-serif",
    cursor: "default",
  };
}

const stageCodeStyle: CSSProperties = { padding: "2px 5px", borderRadius: 4, background: "rgba(255, 255, 255, 0.14)", fontSize: 10 };
const progressStyle: CSSProperties = { position: "absolute", left: 14, bottom: 10, zIndex: 65, color: "rgba(255, 255, 255, 0.5)", font: "11px/1 monospace", pointerEvents: "none" };
