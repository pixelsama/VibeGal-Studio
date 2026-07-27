import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { RuntimeSettingsRecord } from "@vibegal/engine";
import { cardStyle, palette } from "./uiTheme";

type EffectiveSettings = RuntimeSettingsRecord & {
  textSpeedCps: number;
  autoAdvanceMs: number;
};

export function RuntimeSettingsPanel({
  settings,
  busy,
  onSave,
}: {
  settings: RuntimeSettingsRecord;
  busy: boolean;
  onSave: (patch: Partial<RuntimeSettingsRecord>) => boolean | Promise<boolean>;
}) {
  const [draft, setDraft] = useState<EffectiveSettings>(() => effective(settings));
  const draftRef = useRef(draft);
  const pendingPatchRef = useRef<Partial<RuntimeSettingsRecord> | null>(null);
  const savingRef = useRef(false);
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
    if (!savingRef.current && pendingPatchRef.current === null) updateDraft(effective(settings));
  }, [
    settings,
    settings.textSpeedCps,
    settings.autoAdvanceMs,
    settings.volumes.master,
    settings.volumes.bgm,
    settings.volumes.sfx,
    settings.volumes.voice,
  ]);

  const updateDraft = (next: EffectiveSettings) => {
    draftRef.current = next;
    setDraft(next);
  };

  const flushSaves = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      while (pendingPatchRef.current) {
        const patch = pendingPatchRef.current;
        pendingPatchRef.current = null;
        const saved = await onSave(patch);
        if (!saved) {
          pendingPatchRef.current = null;
          updateDraft(effective(settingsRef.current));
          return;
        }
      }
    } finally {
      savingRef.current = false;
    }
  };

  const queueSave = (next: EffectiveSettings, patch: Partial<RuntimeSettingsRecord>) => {
    updateDraft(next);
    pendingPatchRef.current = mergePatch(pendingPatchRef.current, patch);
    void flushSaves();
  };

  const setVolume = (channel: keyof RuntimeSettingsRecord["volumes"], value: number) => {
    const next = { ...draftRef.current, volumes: { ...draftRef.current.volumes, [channel]: value } };
    queueSave(next, { volumes: { ...next.volumes } });
  };
  const setTextSpeed = (value: number) => {
    const next = { ...draftRef.current, textSpeedCps: value };
    queueSave(next, { textSpeedCps: value });
  };
  const setAutoDelay = (value: number) => {
    const next = { ...draftRef.current, autoAdvanceMs: value };
    queueSave(next, { autoAdvanceMs: value });
  };

  return (
    <div style={panelStyle}>
      <p style={hintStyle}>调整后立即保存到本机设置。</p>
      <div style={settingsGridStyle}>
        <SettingRange id="setting-master" label="主音量" value={draft.volumes.master} min={0} max={1} step={0.05} format={percent} disabled={busy} onChange={(value) => setVolume("master", value)} />
        <SettingRange id="setting-bgm" label="BGM 音量" value={draft.volumes.bgm} min={0} max={1} step={0.05} format={percent} disabled={busy} onChange={(value) => setVolume("bgm", value)} />
        <SettingRange id="setting-sfx" label="音效音量" value={draft.volumes.sfx} min={0} max={1} step={0.05} format={percent} disabled={busy} onChange={(value) => setVolume("sfx", value)} />
        <SettingRange id="setting-voice" label="语音音量" value={draft.volumes.voice} min={0} max={1} step={0.05} format={percent} disabled={busy} onChange={(value) => setVolume("voice", value)} />
        <SettingRange id="setting-text-speed" label="文字速度" value={draft.textSpeedCps} min={5} max={Math.max(120, draft.textSpeedCps)} step={1} format={(value) => `${value} 字/秒`} disabled={busy} onChange={setTextSpeed} />
        <SettingRange id="setting-auto-delay" label="自动播放间隔" value={draft.autoAdvanceMs} min={0} max={Math.max(5_000, draft.autoAdvanceMs)} step={100} format={(value) => `${formatSeconds(value)} 秒`} disabled={busy} onChange={setAutoDelay} />
      </div>
    </div>
  );
}

function SettingRange({
  id,
  label,
  value,
  min,
  max,
  step,
  format,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div style={settingStyle}>
      <div style={labelRowStyle}>
        <label htmlFor={id} style={labelStyle}>{label}</label>
        <output htmlFor={id} style={valueStyle}>{format(value)}</output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        style={rangeStyle}
      />
    </div>
  );
}

function effective(settings: RuntimeSettingsRecord): EffectiveSettings {
  return {
    ...settings,
    textSpeedCps: settings.textSpeedCps ?? 30,
    autoAdvanceMs: settings.autoAdvanceMs ?? 1_200,
    volumes: { ...settings.volumes },
  };
}

function mergePatch(
  current: Partial<RuntimeSettingsRecord> | null,
  next: Partial<RuntimeSettingsRecord>,
): Partial<RuntimeSettingsRecord> {
  return {
    ...current,
    ...next,
    ...(current?.volumes || next.volumes
      ? { volumes: { ...(current?.volumes ?? {}), ...(next.volumes ?? {}) } as RuntimeSettingsRecord["volumes"] }
      : {}),
  };
}

const percent = (value: number) => `${Math.round(value * 100)}%`;
const formatSeconds = (value: number) => Number((value / 1_000).toFixed(1)).toString();
const panelStyle: CSSProperties = { minHeight: "100%", display: "flex", flexDirection: "column", gap: 16 };
const hintStyle: CSSProperties = { margin: 0, color: palette.menuTextSoft, fontSize: 12 };
const settingsGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 };
const settingStyle: CSSProperties = { ...cardStyle, minWidth: 0, padding: "14px 16px" };
const labelRowStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 };
const labelStyle: CSSProperties = { color: palette.menuText, fontSize: 13, fontWeight: 600 };
const valueStyle: CSSProperties = { color: palette.accent, font: "600 12px/1 ui-monospace, monospace" };
const rangeStyle: CSSProperties = { width: "100%", accentColor: palette.accent, cursor: "pointer" };
