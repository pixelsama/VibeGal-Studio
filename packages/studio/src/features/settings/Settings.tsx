/**
 * Settings —— 全局设置页（独立全屏，模式同 ProjectList）。
 *
 * 通过导航栈进入（{ type: "settings" }），返回按钮回到来源位置。
 * 主题切换实时生效：updateSettings → applyTheme → <html data-theme> → CSS 变量。
 */
import type { AppSettings, ThemeMode } from "../../lib/theme";

interface SettingsProps {
  settings: AppSettings;
  onUpdate: (next: Partial<AppSettings>) => void | Promise<void>;
  onBack: () => void;
  canGoBack: boolean;
}

export function Settings({ settings, onUpdate, onBack, canGoBack }: SettingsProps) {
  return (
    <div style={pageStyle}>
      {/* 顶部导航条（自定义拖拽区） */}
      <header data-tauri-drag-region style={headerStyle}>
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          <NavBtn onClick={onBack} disabled={!canGoBack} label="后退" ariaLabel="后退">‹</NavBtn>
        </div>
        <div data-tauri-drag-region style={titleGroupStyle}>
          <span style={titleStyle}>设置</span>
        </div>
        <div style={{ marginLeft: "auto" }} />
      </header>

      <div style={contentStyle}>
        <section style={sectionStyle}>
          <h2 style={sectionTitleStyle}>外观</h2>
          <p style={sectionDescStyle}>选择编辑器界面的配色主题。预览区（游戏渲染层）不受影响。</p>
          <div style={themeCardRowStyle}>
            <ThemeCard
              mode="dark"
              active={settings.theme === "dark"}
              onSelect={() => void onUpdate({ theme: "dark" })}
            />
            <ThemeCard
              mode="light"
              active={settings.theme === "light"}
              onSelect={() => void onUpdate({ theme: "light" })}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

/** 主题选择卡片：可视化色块预览 + 名称 + 选中态。 */
function ThemeCard({
  mode,
  active,
  onSelect,
}: {
  mode: ThemeMode;
  active: boolean;
  onSelect: () => void;
}) {
  const label = mode === "dark" ? "深色" : "浅色";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      style={{
        ...themeCardStyle,
        borderColor: active ? "var(--accent)" : "var(--border-input)",
      }}
    >
      <div style={previewStyle}>
        <div style={{ ...previewPanelStyle, background: mode === "dark" ? "#0e1116" : "#f4f6f9" }}>
          <div style={{ ...previewBarStyle, background: mode === "dark" ? "#1a1f29" : "#ffffff" }} />
          <div style={{ ...previewDotStyle, background: mode === "dark" ? "#d4dae2" : "#2a3340" }} />
          <div style={{ ...previewDotStyle, background: mode === "dark" ? "#7a8290" : "#828c9a", width: 24 }} />
          <div style={{ ...previewAccentStyle, background: "#3a6ea5" }} />
        </div>
      </div>
      <div style={themeCardMetaStyle}>
        <span style={themeCardLabelStyle}>{label}</span>
        {active && <span style={activeTagStyle}>当前</span>}
      </div>
    </button>
  );
}

function NavBtn({
  children,
  onClick,
  disabled,
  label,
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={label}
      style={{
        width: 26,
        height: 26,
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: "transparent",
        color: "var(--text-secondary)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
        fontSize: 16,
        lineHeight: 1,
      }}
    >
      {children}
    </button>
  );
}

// ── 样式 ──

const pageStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: "100%",
  height: "100%",
  background: "var(--bg-app)",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  height: 38,
  padding: "0 12px 0 88px",
  background: "var(--bg-app)",
  borderBottom: "1px solid var(--border)",
  flexShrink: 0,
};

const titleGroupStyle: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  transform: "translate(-50%, -50%)",
  top: "50%",
};

const titleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text-bright)",
};

const contentStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "32px 48px",
};

const sectionStyle: React.CSSProperties = {
  maxWidth: 560,
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 14,
  fontWeight: 600,
  color: "var(--text-bright)",
};

const sectionDescStyle: React.CSSProperties = {
  margin: "0 0 12px",
  fontSize: 12,
  color: "var(--text-muted)",
};

const themeCardRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 14,
};

const themeCardStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: 12,
  borderRadius: 10,
  border: "2px solid",
  background: "var(--bg-panel)",
  cursor: "pointer",
  textAlign: "left",
};

const previewStyle: React.CSSProperties = {
  width: 160,
  height: 100,
  borderRadius: 6,
  overflow: "hidden",
};

const previewPanelStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 12,
};

const previewBarStyle: React.CSSProperties = {
  width: "100%",
  height: 14,
  borderRadius: 3,
};

const previewDotStyle: React.CSSProperties = {
  width: 40,
  height: 8,
  borderRadius: 3,
};

const previewAccentStyle: React.CSSProperties = {
  width: 28,
  height: 8,
  borderRadius: 3,
  marginTop: "auto",
};

const themeCardMetaStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const themeCardLabelStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-primary)",
};

const activeTagStyle: React.CSSProperties = {
  fontSize: 10,
  padding: "1px 6px",
  borderRadius: 3,
  background: "var(--bg-accent-soft)",
  color: "var(--accent-bright)",
};
