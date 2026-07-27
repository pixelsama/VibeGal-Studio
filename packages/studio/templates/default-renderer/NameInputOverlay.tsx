import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import type { PendingNameInput } from "@vibegal/engine";
import { palette } from "./uiTheme";

export function NameInputOverlay({
  input,
  disabled,
  onSubmit,
}: {
  input: PendingNameInput;
  disabled: boolean;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(input.default ?? "");

  useEffect(() => {
    setValue(input.default ?? "");
  }, [input.instructionId, input.default]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(value);
  };

  return (
    <div data-name-input-overlay onClick={(event) => event.stopPropagation()} style={overlayStyle}>
      <form onSubmit={submit} style={formStyle}>
        <label htmlFor="vibegal-player-name" style={promptStyle}>{input.prompt}</label>
        <input
          id="vibegal-player-name"
          data-name-input
          autoFocus
          autoComplete="off"
          value={value}
          disabled={disabled}
          onChange={(event) => setValue(event.currentTarget.value)}
          aria-describedby={input.error ? "vibegal-player-name-error" : undefined}
          style={inputStyle}
        />
        <div style={metaStyle}>
          <span>{Array.from(value).length} / {input.maxLength}</span>
          {input.error && <span id="vibegal-player-name-error" role="alert" style={errorStyle}>{input.error}</span>}
        </div>
        <button type="submit" data-name-input-submit disabled={disabled} style={buttonStyle}>确认</button>
      </form>
    </div>
  );
}

const overlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 35,
  display: "grid",
  placeItems: "center",
  background: "rgba(17, 20, 34, 0.42)",
  backdropFilter: "blur(6px)",
};
const formStyle: CSSProperties = {
  width: "min(520px, calc(100% - 64px))",
  boxSizing: "border-box",
  padding: 28,
  border: "1px solid rgba(255,255,255,0.7)",
  borderRadius: 22,
  background: "rgba(250, 250, 255, 0.94)",
  boxShadow: "0 22px 70px rgba(17, 20, 34, 0.36)",
  color: palette.menuDeep,
  cursor: "default",
};
const promptStyle: CSSProperties = { display: "block", marginBottom: 14, fontSize: 18, fontWeight: 800 };
const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "12px 14px",
  border: `2px solid ${palette.accent}`,
  borderRadius: 12,
  background: "#fff",
  color: palette.menuDeep,
  font: "600 18px/1.4 inherit",
  outline: "none",
  userSelect: "text",
};
const metaStyle: CSSProperties = { minHeight: 24, display: "flex", justifyContent: "space-between", gap: 12, marginTop: 8, color: "#5f6578", fontSize: 12 };
const errorStyle: CSSProperties = { color: "#b42336", textAlign: "right" };
const buttonStyle: CSSProperties = {
  display: "block",
  minWidth: 120,
  margin: "12px 0 0 auto",
  padding: "10px 20px",
  border: 0,
  borderRadius: 999,
  background: palette.accent,
  color: "#fff",
  font: "700 14px/1 inherit",
  cursor: "pointer",
};
