import type { CSSProperties } from "react";
import type { Manifest } from "../../lib/types";

export interface ResourceOption {
  value: string;
  label: string;
  hint?: string;
}

export type ResourcePickerKind = "background" | "bgm" | "sfx" | "voice" | "character" | "expression" | "cg" | "video";

type ResourcePickerProps = {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
} & (
  | {
    options: ResourceOption[];
    manifest?: never;
    kind?: never;
    characterId?: never;
  }
  | {
    manifest: Manifest;
    kind: ResourcePickerKind;
    characterId?: string;
    options?: never;
  }
);

const MISSING_OPTION_VALUE = "__missing__";

export function buildResourcePickerOptions(
  manifest: Manifest,
  spec: { kind: ResourcePickerKind; characterId?: string },
): ResourceOption[] {
  switch (spec.kind) {
    case "background":
      return Object.keys(manifest.backgrounds).map((id) => ({ value: id, label: id }));
    case "bgm":
      return Object.keys(manifest.audio.bgm).map((id) => ({ value: id, label: id }));
    case "sfx":
      return Object.keys(manifest.audio.sfx).map((id) => ({ value: id, label: id }));
    case "voice":
      return Object.keys(manifest.audio.voice).map((id) => ({ value: id, label: id }));
    case "character":
      return Object.entries(manifest.characters).map(([id, character]) => ({
        value: id,
        label: character.name || id,
        hint: character.name && character.name !== id ? id : undefined,
      }));
    case "expression": {
      const character = spec.characterId ? manifest.characters[spec.characterId] : undefined;
      return Object.keys(character?.sprites ?? {}).map((expr) => ({
        value: expr,
        label: expr,
      }));
    }
    case "cg":
      return Object.entries(manifest.cg ?? {}).map(([id, asset]) => ({
        value: id,
        label: asset.name || id,
      }));
    case "video":
      return Object.entries(manifest.videos ?? {}).map(([id, asset]) => ({
        value: id,
        label: asset.name || id,
      }));
  }
}

export function ResourcePicker({
  label,
  value,
  onChange,
  disabled = false,
  placeholder,
  ...source
}: ResourcePickerProps) {
  const options = resolveOptions(source);
  const fieldLabel = label ?? ("kind" in source ? source.kind : "资源");
  const hasCurrentValue = value.length > 0;
  const currentExists = options.some((option) => option.value === value);
  const selectValue = hasCurrentValue && !currentExists ? MISSING_OPTION_VALUE : value;

  return (
    <label style={fieldStyle}>
      <span style={fieldLabelStyle}>{fieldLabel}</span>
      <div style={pickerRowStyle}>
        <select
          value={selectValue}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value;
            if (next === MISSING_OPTION_VALUE) return;
            onChange(next);
          }}
          style={selectStyle}
        >
          <option value="">{placeholder ?? `选择${fieldLabel}`}</option>
          {hasCurrentValue && !currentExists && (
            <option value={MISSING_OPTION_VALUE}>{`缺失：${value}`}</option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.hint ? `${option.label} (${option.hint})` : option.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={value}
          disabled={disabled}
          placeholder={`${fieldLabel} id`}
          onChange={(event) => onChange(event.target.value)}
          style={inputStyle}
        />
      </div>
    </label>
  );
}

function resolveOptions(
  source: Omit<ResourcePickerProps, "label" | "value" | "onChange" | "disabled" | "placeholder">,
): ResourceOption[] {
  if ("options" in source && source.options) return source.options;
  return buildResourcePickerOptions(source.manifest!, {
    kind: source.kind!,
    characterId: source.characterId,
  });
}

const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1)",
  minWidth: 0,
};

const fieldLabelStyle: CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--text-secondary)",
};

const pickerRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(120px, 0.9fr)",
  gap: "var(--space-2)",
  minWidth: 0,
};

const selectStyle: CSSProperties = {
  minWidth: 0,
  padding: "7px var(--space-2)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-strong)",
  background: "var(--bg-panel)",
  color: "var(--text-primary)",
  fontSize: "var(--text-base)",
};

const inputStyle: CSSProperties = {
  minWidth: 0,
  padding: "7px var(--space-2)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-strong)",
  background: "var(--bg-panel)",
  color: "var(--text-primary)",
  fontSize: "var(--text-base)",
};
