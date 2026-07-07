import { useCallback, useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import type { AppSettings, ThemeMode } from "../../lib/theme";
import { Button, IconButton } from "../common/Button";
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
        <div style={{ display: "flex", gap: "var(--space-1)", flexShrink: 0 }}>
          <IconButton onClick={onBack ?? noop} disabled={!canGoBack || !onBack} size={26} title="后退" aria-label="后退">
            <ChevronLeft size={16} />
          </IconButton>
        </div>
        <div data-tauri-drag-region style={titleGroupStyle}>
          <span style={titleStyle}>设置</span>
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
      <h2 style={sectionTitleStyle}>外观</h2>
      <p style={sectionDescStyle}>选择编辑器界面的配色主题。预览区（游戏渲染层）不受影响。</p>
      <div style={themeCardRowStyle}>
        <ThemeCard
          mode="system"
          active={settings.theme === "system"}
          onSelect={() => void onUpdate({ theme: "system" })}
        />
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
        : "未安装命令链接"
    : "正在检查 galstudio-cli";
  const detailText = status
    ? status.installed
      ? `命令已注册到全局命令目录，可在终端和外部 Agent 中直接运行 ${status.command}。`
      : status.linkOccupied
        ? "GalStudio 不会覆盖非自己管理的同名命令。"
        : `将创建全局命令链接：${status.linkPath}`
    : "GalStudio 会显式创建命令链接，不会静默修改 shell 配置。";
  const installDisabled =
    busy || !status?.cliAvailable || Boolean(status.installed) || Boolean(status?.linkOccupied);

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
          <Button variant="primary" onClick={onInstall} disabled={installDisabled}>
            {status?.installed ? "已安装" : "安装 galstudio-cli"}
          </Button>
          <Button variant="secondary" onClick={onUninstall} disabled={busy || !status?.installed}>
            卸载
          </Button>
          <Button variant="secondary" onClick={onRefresh} disabled={busy}>
            重新检查
          </Button>
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
  const label = mode === "system" ? "跟随系统" : mode === "dark" ? "深色" : "浅色";
  const previewMode = mode === "system" ? "dark" : mode;
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
        <div style={{ ...previewPanelStyle, background: previewMode === "dark" ? "#0e1116" : "#f4f6f9" }}>
          <div style={{ ...previewBarStyle, background: previewMode === "dark" ? "#1a1f29" : "#ffffff" }} />
          <div style={{ ...previewDotStyle, background: previewMode === "dark" ? "#d4dae2" : "#2a3340" }} />
          <div style={{ ...previewDotStyle, background: previewMode === "dark" ? "#7a8290" : "#828c9a", width: 24 }} />
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

function noop() {}

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
  fontSize: "var(--text-base)",
  fontWeight: 600,
  color: "var(--text-bright)",
};

const contentStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "var(--space-8) var(--space-12)",
  display: "flex",
  flexDirection: "column",
  gap: 28,
};

const sectionStyle: React.CSSProperties = {
  maxWidth: 560,
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
};

const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "var(--text-md)",
  fontWeight: 600,
  color: "var(--text-bright)",
};

const sectionDescStyle: React.CSSProperties = {
  margin: "0 0 var(--space-3)",
  fontSize: "var(--text-sm)",
  color: "var(--text-muted)",
};

const themeCardRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 14,
};

const themeCardStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
  padding: "var(--space-3)",
  borderRadius: "var(--radius-lg)",
  border: "2px solid",
  background: "var(--bg-panel)",
  cursor: "pointer",
  textAlign: "left",
  width: "100%",
  minWidth: 0,
};

const previewStyle: React.CSSProperties = {
  width: "100%",
  height: 100,
  borderRadius: "var(--radius-sm)",
  overflow: "hidden",
};

const previewPanelStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
  padding: "var(--space-3)",
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
  flexWrap: "wrap",
  gap: "var(--space-2)",
};

const themeCardLabelStyle: React.CSSProperties = {
  fontSize: "var(--text-base)",
  color: "var(--text-primary)",
};

const activeTagStyle: React.CSSProperties = {
  fontSize: "var(--text-xs)",
  padding: "1px var(--space-1)",
  borderRadius: "var(--radius-xs)",
  background: "var(--bg-accent-soft)",
  color: "var(--accent-bright)",
};

const cliPanelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
  padding: "var(--space-3)",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  background: "var(--bg-panel)",
};

const cliStatusRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "var(--space-4)",
};

const cliCommandStyle: React.CSSProperties = {
  fontSize: "var(--text-base)",
  fontWeight: 600,
  color: "var(--text-bright)",
};

const cliStatusTextStyle: React.CSSProperties = {
  marginTop: 3,
  fontSize: "var(--text-sm)",
  color: "var(--text-secondary)",
};

const cliBadgeStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: "2px var(--space-2)",
  borderRadius: "var(--radius-pill)",
  fontSize: "var(--text-xs)",
};

const cliDetailStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "var(--text-sm)",
  color: "var(--text-muted)",
};

const cliPathStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "var(--text-xs)",
  color: "var(--text-muted)",
  wordBreak: "break-all",
};

const cliIssueStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "var(--text-sm)",
  color: "var(--status-error-text)",
};

const cliMessageStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "var(--text-sm)",
  color: "var(--status-ok-text)",
};

const cliActionRowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-2)",
};
