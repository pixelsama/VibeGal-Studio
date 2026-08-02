import { useCallback, useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import type { AppSettings, ThemeMode } from "../../lib/theme";
import {
  translateZhCN,
  useStudioI18n,
  type StudioLanguagePreference,
  type StudioTranslator,
} from "../../lib/i18n";
import { getDesktopPlatform } from "../../lib/platform";
import { Button, IconButton } from "../common/Button";
import {
  agentDetect,
  agentMcpInstall,
  getCliToolStatus,
  installCliTool,
  uninstallCliTool,
  type AgentAvailability,
  type AgentKind,
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
  const { t } = useStudioI18n();
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
      setCliMessage(t("settings.cli.installedAt", { path: next.linkPath }));
    } catch (error) {
      setCliError(error instanceof Error ? error.message : String(error));
    } finally {
      setCliBusy(false);
    }
  }, [t]);

  const uninstallCli = useCallback(async () => {
    setCliBusy(true);
    setCliError(null);
    setCliMessage(null);
    try {
      const next = await uninstallCliTool();
      setCliStatus(next);
      setCliMessage(t("settings.cli.uninstalled"));
    } catch (error) {
      setCliError(error instanceof Error ? error.message : String(error));
    } finally {
      setCliBusy(false);
    }
  }, [t]);

  const copyCliPath = useCallback(async () => {
    const path = cliStatus?.cliPath;
    if (!path) return;
    setCliError(null);
    setCliMessage(null);
    try {
      await navigator.clipboard.writeText(path);
      setCliMessage(t("settings.cli.pathCopied"));
    } catch {
      setCliError(t("settings.cli.copyFailed"));
    }
  }, [cliStatus, t]);

  const [agentAvailability, setAgentAvailability] = useState<AgentAvailability[] | null>(null);
  const [agentBusy, setAgentBusy] = useState<AgentKind | null>(null);
  const [agentMessage, setAgentMessage] = useState<string | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);

  const refreshAgentAvailability = useCallback(async () => {
    setAgentError(null);
    try {
      setAgentAvailability(await agentDetect());
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void refreshAgentAvailability();
  }, [refreshAgentAvailability]);

  const registerAgent = useCallback(async (agent: AgentKind) => {
    setAgentBusy(agent);
    setAgentError(null);
    setAgentMessage(null);
    try {
      const result = await agentMcpInstall(agent);
      if (result.ok) {
        setAgentMessage(t("settings.agent.registered", { agent: agent.toUpperCase() }));
      } else {
        setAgentError(result.message);
      }
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : String(error));
    } finally {
      setAgentBusy(null);
    }
  }, [t]);

  const content = (
    <div className="gs-settings-grid" style={contentStyle}>
      <AppearanceSection settings={settings} onUpdate={onUpdate} t={t} />
      <LanguageSection settings={settings} onUpdate={onUpdate} t={t} />

      <AgentConnectionSection
        availability={agentAvailability}
        busy={agentBusy}
        error={agentError}
        message={agentMessage}
        cliInstalled={Boolean(cliStatus?.installed)}
        onRefresh={() => void refreshAgentAvailability()}
        onRegister={(agent) => void registerAgent(agent)}
        t={t}
      />
      <CommandLineToolSection
        status={cliStatus}
        busy={cliBusy}
        error={cliError}
        message={cliMessage}
        onRefresh={() => void refreshCliStatus()}
        onInstall={() => void installCli()}
        onUninstall={() => void uninstallCli()}
        onCopyPath={() => void copyCliPath()}
        t={t}
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
          <IconButton onClick={onBack ?? noop} disabled={!canGoBack || !onBack} size={26} title={t("nav.back")} aria-label={t("nav.back")}>
            <ChevronLeft size={16} />
          </IconButton>
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
  t = translateZhCN,
}: {
  settings: AppSettings;
  onUpdate: (next: Partial<AppSettings>) => void | Promise<void>;
  t?: StudioTranslator;
}) {
  return (
    <section className="gs-settings-card" style={sectionStyle}>
      <h2 className="gs-settings-card__title" style={sectionTitleStyle}>{t("settings.appearance.title")}</h2>
      <p className="gs-settings-card__desc" style={sectionDescStyle}>{t("settings.appearance.description")}</p>
      <div style={themeCardRowStyle}>
        <ThemeCard
          mode="system"
          t={t}
          active={settings.theme === "system"}
          onSelect={() => void onUpdate({ theme: "system" })}
        />
        <ThemeCard
          mode="dark"
          t={t}
          active={settings.theme === "dark"}
          onSelect={() => void onUpdate({ theme: "dark" })}
        />
        <ThemeCard
          mode="light"
          t={t}
          active={settings.theme === "light"}
          onSelect={() => void onUpdate({ theme: "light" })}
        />
      </div>
    </section>
  );
}

export function LanguageSection({
  settings,
  onUpdate,
  t = translateZhCN,
}: {
  settings: AppSettings;
  onUpdate: (next: Partial<AppSettings>) => void | Promise<void>;
  t?: StudioTranslator;
}) {
  const preference = settings.studioLanguage ?? "system";
  const choices: StudioLanguagePreference[] = ["system", "zh-CN", "en"];
  const labels = {
    system: t("settings.language.system"),
    "zh-CN": t("settings.language.zhCN"),
    en: t("settings.language.en"),
  } satisfies Record<StudioLanguagePreference, string>;

  return (
    <section className="gs-settings-card" style={sectionStyle}>
      <h2 className="gs-settings-card__title" style={sectionTitleStyle}>{t("settings.language.title")}</h2>
      <p className="gs-settings-card__desc" style={sectionDescStyle}>{t("settings.language.description")}</p>
      <div style={languageRowStyle}>
        {choices.map((choice) => (
          <Button
            key={choice}
            variant={preference === choice ? "primary" : "secondary"}
            aria-pressed={preference === choice}
            onClick={() => void onUpdate({ studioLanguage: choice })}
          >
            {labels[choice]}
          </Button>
        ))}
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
  onCopyPath,
  t = translateZhCN,
}: {
  status: CliToolStatus | null;
  busy: boolean;
  error: string | null;
  message: string | null;
  onRefresh: () => void;
  onInstall: () => void;
  onUninstall: () => void;
  onCopyPath?: () => void;
  t?: StudioTranslator;
}) {
  // 平台没有可安装的命令链接路径（Windows）：降级为手动引导
  const manualOnly = status != null && status.linkPath === "";
  const statusText = status
    ? status.installed
      ? t("settings.cli.installedAt", { path: status.linkPath })
      : manualOnly
        ? status.cliAvailable
          ? t("settings.cli.bundledManual")
          : t("settings.cli.bundledMissing")
        : status.linkOccupied
          ? t("settings.cli.pathOccupied", { path: status.linkPath })
          : t("settings.cli.linkMissing")
    : t("settings.cli.checking");
  const detailText = status
    ? status.installed
      ? t("settings.cli.installedDetail", { command: status.command })
      : manualOnly
        ? t("settings.cli.manualDetail")
        : status.linkOccupied
          ? t("settings.cli.occupiedDetail")
          : t("settings.cli.createLinkDetail", { path: status.linkPath })
    : t("settings.cli.defaultDetail");
  const installDisabled =
    busy || !status?.cliAvailable || Boolean(status.installed) || Boolean(status?.linkOccupied);

  return (
    <section className="gs-settings-card" style={sectionStyle}>
      <h2 className="gs-settings-card__title" style={sectionTitleStyle}>{t("settings.cli.title")}</h2>
      <p className="gs-settings-card__desc" style={sectionDescStyle}>{t("settings.cli.description")}</p>
      <div style={cliPanelStyle}>
        <div style={cliStatusRowStyle}>
          <div>
            <div style={cliCommandStyle}>vibegal-cli</div>
            <div style={cliStatusTextStyle}>{busy ? t("settings.cli.processing") : statusText}</div>
          </div>
          <span style={{
            ...cliBadgeStyle,
            background: status?.installed ? "var(--bg-accent-soft)" : "var(--bg-inset)",
            color: status?.installed ? "var(--accent-bright)" : "var(--text-muted)",
          }}>
            {status ? (status.installed ? t("settings.cli.installed") : manualOnly ? t("settings.cli.manual") : t("settings.cli.notInstalled")) : t("settings.cli.checkingShort")}
          </span>
        </div>
        <p style={cliDetailStyle}>{detailText}</p>
        {status?.cliPath && <p style={cliPathStyle}>{t("settings.cli.bundledAt", { path: status.cliPath })}</p>}
        {status?.issue && <p role="alert" style={cliIssueStyle}>{status.issue}</p>}
        {error && <p role="alert" style={cliIssueStyle}>{error}</p>}
        {message && <p role="status" style={cliMessageStyle}>{message}</p>}
        <div style={cliActionRowStyle}>
          {manualOnly ? (
            <Button variant="primary" onClick={onCopyPath} disabled={busy || !status.cliAvailable}>
              {t("settings.cli.copyPath")}
            </Button>
          ) : (
            <>
              <Button variant="primary" onClick={onInstall} disabled={installDisabled}>
                {status?.installed ? t("settings.cli.installed") : t("settings.cli.install")}
              </Button>
              <Button variant="secondary" onClick={onUninstall} disabled={busy || !status?.installed}>
                {t("settings.cli.uninstall")}
              </Button>
            </>
          )}
          <Button variant="secondary" onClick={onRefresh} disabled={busy}>
            {t("settings.cli.recheck")}
          </Button>
        </div>
      </div>
    </section>
  );
}

const AGENT_OPTIONS: { agent: AgentKind; label: string }[] = [
  { agent: "codex", label: "Codex" },
  { agent: "claude", label: "Claude" },
  { agent: "opencode", label: "OpenCode" },
];

/**
 * 「连接 Agent」卡片：把 VibeGal MCP server 注册进本机外部 Agent。
 * 只在对应 CLI 已探测到（可用）时允许注册；CLI 未安装的 Agent 置灰并给出提示。
 */
export function AgentConnectionSection({
  availability,
  busy,
  error,
  message,
  cliInstalled,
  onRefresh,
  onRegister,
  t = translateZhCN,
}: {
  availability: AgentAvailability[] | null;
  busy: AgentKind | null;
  error: string | null;
  message: string | null;
  cliInstalled: boolean;
  onRefresh: () => void;
  onRegister: (agent: AgentKind) => void;
  t?: StudioTranslator;
}) {
  const availabilityByAgent = new Map(
    (availability ?? []).map((entry) => [entry.agent, entry]),
  );
  const checking = availability === null;

  return (
    <section className="gs-settings-card" style={sectionStyle}>
      <h2 className="gs-settings-card__title" style={sectionTitleStyle}>{t("settings.agent.title")}</h2>
      <p className="gs-settings-card__desc" style={sectionDescStyle}>{t("settings.agent.description")}</p>
      <div style={cliPanelStyle}>
        {checking ? (
          <p style={cliStatusTextStyle}>{t("settings.agent.checking")}</p>
        ) : (
          AGENT_OPTIONS.map(({ agent, label }) => {
            const entry = availabilityByAgent.get(agent);
            const available = entry?.available ?? false;
            const busyThis = busy === agent;
            return (
              <div key={agent} data-agent-connect={agent} style={agentRowStyle}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={cliCommandStyle}>{label}</div>
                  <div style={cliStatusTextStyle}>
                    {available
                      ? entry?.version
                        ? t("settings.agent.installed", { version: entry.version })
                        : t("settings.cli.installed")
                      : t("settings.agent.notInstalled", { agent: label })}
                  </div>
                  {!available && (
                    <div style={agentHintStyle}>{t("settings.agent.notInstalledHint", { agent: label })}</div>
                  )}
                </div>
                <Button
                  variant="secondary"
                  data-agent-register={agent}
                  onClick={() => onRegister(agent)}
                  disabled={busyThis || !available || !cliInstalled || busy !== null}
                  title={!cliInstalled ? t("settings.agent.cliHint") : undefined}
                >
                  {busyThis ? t("settings.cli.processing") : t("settings.agent.register", { agent: label })}
                </Button>
              </div>
            );
          })
        )}
        {!cliInstalled && !checking && (
          <p style={agentHintStyle}>{t("settings.agent.cliHint")}</p>
        )}
        {message && <p role="status" style={cliMessageStyle}>{message} {t("settings.agent.registeredHint")}</p>}
        {error && <p role="alert" style={cliIssueStyle}>{error}</p>}
        <div style={cliActionRowStyle}>
          <Button variant="secondary" onClick={onRefresh} disabled={busy !== null}>
            {t("settings.cli.recheck")}
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
  t,
}: {
  mode: ThemeMode;
  active: boolean;
  onSelect: () => void;
  t: StudioTranslator;
}) {
  const label = mode === "system" ? t("settings.theme.system") : mode === "dark" ? t("settings.theme.dark") : t("settings.theme.light");
  const previewMode = mode === "system" ? "dark" : mode;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className="gs-selected-surface"
      style={{
        ...themeCardStyle,
        borderColor: active ? "var(--accent-secondary)" : "var(--border-input)",
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
        {active && <span style={activeTagStyle}>{t("settings.current")}</span>}
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
  position: "relative",
  display: "flex",
  alignItems: "center",
  gap: 10,
  height: 38,
  // macOS Overlay 标题栏避让红绿灯；Windows/Linux 原生标题栏无需避让
  padding: getDesktopPlatform() === "macos" ? "0 12px 0 88px" : "0 12px",
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
};

const sectionStyle: React.CSSProperties = {
  maxWidth: "none",
};

const sectionTitleStyle: React.CSSProperties = {};

const sectionDescStyle: React.CSSProperties = {};

const languageRowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 10,
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
  background: "var(--accent-secondary-soft)",
  color: "var(--accent-secondary-bright)",
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
  overflowWrap: "anywhere",
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

const agentRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-3)",
  padding: "var(--space-2) 0",
  borderBottom: "1px solid var(--border-subtle)",
};

const agentHintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "var(--text-xs)",
  color: "var(--text-muted)",
  lineHeight: 1.5,
  maxWidth: 420,
};

const cliActionRowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-2)",
};
