import { useCallback, useEffect, useState } from "react";
import type { AppSettings, ThemeMode } from "../../lib/theme";
import { t } from "../../lib/i18n";
import {
  getCliToolStatus,
  installCliTool,
  uninstallCliTool,
  type CliToolStatus,
} from "../../lib/tauri";

interface SettingsProps {
  settings: AppSettings;
  onUpdate: (next: Partial<AppSettings>) => void | Promise<void>;
  presentation?: "embedded" | "standalone";
  onBack?: () => void;
  canGoBack?: boolean;
}

export function Settings({
  settings,
  onUpdate,
  presentation = "standalone",
  onBack,
  canGoBack = false,
}: SettingsProps) {
  const [cliStatus, setCliStatus] = useState<CliToolStatus | null>(null);
  const [cliBusy, setCliBusy] = useState(false);
  const [cliError, setCliError] = useState<string | null>(null);
  const [cliMessage, setCliMessage] = useState<string | null>(null);

  const refreshCliStatus = useCallback(async () => {
    setCliBusy(true);
    setCliError(null);
    try {
      setCliStatus(await getCliToolStatus());
    } catch (error) {
      setCliError(error instanceof Error ? error.message : String(error));
    } finally {
      setCliBusy(false);
    }
  }, []);

  useEffect(() => {
    void refreshCliStatus();
  }, [refreshCliStatus]);

  const installCli = useCallback(async () => {
    setCliBusy(true);
    setCliError(null);
    setCliMessage(null);
    try {
      const next = await installCliTool();
      setCliStatus(next);
      setCliMessage(`已安装到 ${next.linkPath}`);
    } catch (error) {
      setCliError(error instanceof Error ? error.message : String(error));
    } finally {
      setCliBusy(false);
    }
  }, []);

  const uninstallCli = useCallback(async () => {
    setCliBusy(true);
    setCliError(null);
    setCliMessage(null);
    try {
      const next = await uninstallCliTool();
      setCliStatus(next);
      setCliMessage("已卸载命令行工具");
    } catch (error) {
      setCliError(error instanceof Error ? error.message : String(error));
    } finally {
      setCliBusy(false);
    }
  }, []);

  const content = (
    <div style={contentStyle}>
      <AppearanceSection settings={settings} onUpdate={onUpdate} />

      <CommandLineToolSection
        status={cliStatus}
        busy={cliBusy}
        error={cliError}
        message={cliMessage}
        onRefresh={() => void refreshCliStatus()}
        onInstall={() => void installCli()}
        onUninstall={() => void uninstallCli()}
      />
    </div>
  );

  if (presentation === "embedded") {
    return <div style={embeddedPageStyle}>{content}</div>;
  }

  return (
    <div style={pageStyle}>
      {/* 顶部导航条（自定义拖拽区） */}
      <header data-tauri-drag-region style={headerStyle}>
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          <NavBtn onClick={onBack ?? noop} disabled={!canGoBack || !onBack} label={t("navigation.back")} ariaLabel={t("navigation.back")}>‹</NavBtn>
        </div>
        <div data-tauri-drag-region style={titleGroupStyle}>
          <span style={titleStyle}>{t("settings.title")}</span>
        </div>
        <div style={{ marginLeft: "auto" }} />
      </header>

      {content}
    </div>
  );
}

export function AppearanceSection({
  settings,
  onUpdate,
}: {
  settings: AppSettings;
  onUpdate: (next: Partial<AppSettings>) => void | Promise<void>;
}) {
  return (
    <section style={sectionStyle}>
      <h2 style={sectionTitleStyle}>{t("settings.appearance.title")}</h2>
      <p style={sectionDescStyle}>{t("settings.appearance.description")}</p>
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
  );
}

export function CommandLineToolSection({
  status,
  busy,
  error,
  message,
  onRefresh,
  onInstall,
  onUninstall,
}: {
  status: CliToolStatus | null;
  busy: boolean;
  error: string | null;
  message: string | null;
  onRefresh: () => void;
  onInstall: () => void;
  onUninstall: () => void;
}) {
  const statusText = status
    ? status.installed
      ? `已安装到 ${status.linkPath}`
      : status.linkOccupied
        ? `目标路径已被占用：${status.linkPath}`
        : "未安装到 PATH"
    : "正在检查 galstudio-cli";
  const detailText = status
    ? status.inPath
      ? `命令目录已在 PATH 中，可直接运行 ${status.command}。`
      : `命令目录可能不在 PATH 中：${status.linkPath}`
    : "GalStudio 会显式创建命令链接，不会静默修改 shell 配置。";

  return (
    <section style={sectionStyle}>
      <h2 style={sectionTitleStyle}>命令行工具</h2>
      <p style={sectionDescStyle}>安装后可在终端使用 galstudio-cli validate 校验项目。</p>
      <div style={cliPanelStyle}>
        <div style={cliStatusRowStyle}>
          <div>
            <div style={cliCommandStyle}>galstudio-cli</div>
            <div style={cliStatusTextStyle}>{busy ? "正在处理..." : statusText}</div>
          </div>
          <span style={{
            ...cliBadgeStyle,
            background: status?.installed ? "var(--bg-accent-soft)" : "var(--bg-inset)",
            color: status?.installed ? "var(--accent-bright)" : "var(--text-muted)",
          }}>
            {status ? (status.installed ? "已安装" : "未安装") : "检查中"}
          </span>
        </div>
        <p style={cliDetailStyle}>{detailText}</p>
        {status?.cliPath && <p style={cliPathStyle}>随应用提供：{status.cliPath}</p>}
        {status?.issue && <p role="alert" style={cliIssueStyle}>{status.issue}</p>}
        {error && <p role="alert" style={cliIssueStyle}>{error}</p>}
        {message && <p role="status" style={cliMessageStyle}>{message}</p>}
        <div style={cliActionRowStyle}>
          <button
            type="button"
            onClick={onInstall}
            disabled={busy || !status?.cliAvailable || status.installed || status.linkOccupied}
            style={primaryActionStyle}
          >
            安装 galstudio-cli
          </button>
          <button
            type="button"
            onClick={onUninstall}
            disabled={busy || !status?.installed}
            style={secondaryActionStyle}
          >
            卸载
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={busy}
            style={secondaryActionStyle}
          >
            重新检查
          </button>
        </div>
      </div>
    </section>
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
  const label = mode === "dark" ? t("settings.theme.dark") : t("settings.theme.light");
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
        {active && <span style={activeTagStyle}>{t("settings.theme.current")}</span>}
      </div>
    </button>
  );
}

function noop() {}

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

const embeddedPageStyle: React.CSSProperties = {
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
  display: "flex",
  flexDirection: "column",
  gap: 28,
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

const cliPanelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: 14,
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg-panel)",
};

const cliStatusRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 16,
};

const cliCommandStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text-bright)",
};

const cliStatusTextStyle: React.CSSProperties = {
  marginTop: 3,
  fontSize: 12,
  color: "var(--text-secondary)",
};

const cliBadgeStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: "2px 8px",
  borderRadius: 999,
  fontSize: 11,
};

const cliDetailStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: "var(--text-muted)",
};

const cliPathStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 11,
  color: "var(--text-muted)",
  wordBreak: "break-all",
};

const cliIssueStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: "var(--status-error-text)",
};

const cliMessageStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: "var(--status-ok-text)",
};

const cliActionRowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
};

const primaryActionStyle: React.CSSProperties = {
  padding: "7px 12px",
  borderRadius: 6,
  border: "1px solid var(--accent)",
  background: "var(--accent)",
  color: "white",
  cursor: "pointer",
};

const secondaryActionStyle: React.CSSProperties = {
  padding: "7px 12px",
  borderRadius: 6,
  border: "1px solid var(--border-input)",
  background: "var(--bg-inset)",
  color: "var(--text-primary)",
  cursor: "pointer",
};
