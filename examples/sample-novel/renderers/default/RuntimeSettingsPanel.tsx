import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import type { RuntimeSettingsRecord } from "@vibegal/engine";
import { cardStyle, palette, primaryPillButton } from "./uiTheme";

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

  useEffect(() => {
    setDraft(effective(settings));
  }, [
    settings.textSpeedCps,
    settings.autoAdvanceMs,
    settings.volumes.master,
    settings.volumes.bgm,
    settings.volumes.sfx,
    settings.volumes.voice,
  ]);

  const setVolume = (channel: keyof RuntimeSettingsRecord["volumes"], value: number) => {
    setDraft((current: EffectiveSettings) => ({ ...current, volumes: { ...current.volumes, [channel]: value } }));
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await onSave({
      textSpeedCps: draft.textSpeedCps,
      autoAdvanceMs: draft.autoAdvanceMs,
      volumes: { ...draft.volumes },
    });
    if (!saved) setDraft(effective(settings));
  };

  return (
    <form onSubmit={(event) => void submit(event)} style={formStyle}>
      <div style={settingsGridStyle}>
        <SettingRange id="setting-master" label="主音量" value={draft.volumes.master} min={0} max={1} step={0.05} format={percent} disabled={busy} onChange={(value) => setVolume("master", value)} />
        <SettingRange id="setting-bgm" label="BGM 音量" value={draft.volumes.bgm} min={0} max={1} step={0.05} format={percent} disabled={busy} onChange={(value) => setVolume("bgm", value)} />
        <SettingRange id="setting-sfx" label="音效音量" value={draft.volumes.sfx} min={0} max={1} step={0.05} format={percent} disabled={busy} onChange={(value) => setVolume("sfx", value)} />
        <SettingRange id="setting-voice" label="语音音量" value={draft.volumes.voice} min={0} max={1} step={0.05} format={percent} disabled={busy} onChange={(value) => setVolume("voice", value)} />
        <SettingRange id="setting-text-speed" label="文字速度" value={draft.textSpeedCps} min={5} max={Math.max(120, draft.textSpeedCps)} step={1} format={(value) => `${value} CPS`} disabled={busy} onChange={(value) => setDraft((current: EffectiveSettings) => ({ ...current, textSpeedCps: value }))} />
        <SettingRange id="setting-auto-delay" label="自动播放间隔" value={draft.autoAdvanceMs} min={0} max={Math.max(5_000, draft.autoAdvanceMs)} step={100} format={(value) => `${value} ms`} disabled={busy} onChange={(value) => setDraft((current: EffectiveSettings) => ({ ...current, autoAdvanceMs: value }))} />
      </div>
      <div style={footerStyle}>
        <button type="submit" data-settings-action="save" disabled={busy} style={primaryPillButton}>
          应用设置
        </button>
      </div>
    </form>
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

const percent = (value: number) => `${Math.round(value * 100)}%`;
const formStyle: CSSProperties = { minHeight: "100%", display: "flex", flexDirection: "column", gap: 22 };
const settingsGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 };
const settingStyle: CSSProperties = { ...cardStyle, minWidth: 0, padding: "14px 16px" };
const labelRowStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 };
const labelStyle: CSSProperties = { color: palette.ink, fontSize: 13, fontWeight: 600 };
const valueStyle: CSSProperties = { color: palette.accent, font: "600 12px/1 ui-monospace, monospace" };
const rangeStyle: CSSProperties = { width: "100%", accentColor: palette.accent, cursor: "pointer" };
const footerStyle: CSSProperties = { display: "flex", justifyContent: "flex-end", marginTop: "auto" };
