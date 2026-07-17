/**
 * 全局快捷键帮助浮层（按 ? 唤起；Esc / 点击遮罩 / 再按 ? 关闭）。
 *
 * SHORTCUT_SECTIONS 是快捷键说明的唯一事实源，内容必须与实际绑定的
 * 快捷键保持一致：Ctrl+S 保存（useSaveShortcut）、Ctrl+K 命令面板、
 * 图视图撤销/重做（graphShortcuts）、Delete 删除选中图元素（GraphCanvas）。
 */
import { useEffect } from "react";
import { getDesktopPlatform, type DesktopPlatform } from "../../lib/platform";

export interface ShortcutItem {
  keys: string[];
  label: string;
}

export interface ShortcutSection {
  title: string;
  items: ShortcutItem[];
}

export const SHORTCUT_SECTIONS: ShortcutSection[] = [
  {
    title: "通用",
    items: [
      { keys: ["Ctrl", "S"], label: "保存当前编辑（节点 / 资产草稿 / 项目设置）" },
      { keys: ["Ctrl", "K"], label: "命令面板：跳转节点、切换工作台" },
      { keys: ["?"], label: "打开 / 关闭本帮助" },
      { keys: ["Esc"], label: "关闭弹窗与面板" },
    ],
  },
  {
    title: "图编辑（脚本工作台）",
    items: [
      { keys: ["Ctrl", "Z"], label: "撤销" },
      { keys: ["Ctrl", "Shift", "Z"], label: "重做（也可用 Ctrl+Y）" },
      { keys: ["Delete"], label: "删除选中的节点或连线（Backspace 同效）" },
      { keys: ["右键"], label: "画布空白或节点上打开操作菜单" },
    ],
  },
];

/** macOS 上 Ctrl 显示为 ⌘，与系统习惯一致。 */
export function shortcutKeysForPlatform(keys: string[], platform: DesktopPlatform): string[] {
  if (platform !== "macos") return keys;
  return keys.map((key) => (key === "Ctrl" ? "⌘" : key));
}

export interface HelpToggleKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  targetIsEditable: boolean;
}

/** 是否应触发帮助浮层开关：裸按 ?，且焦点不在输入控件内。 */
export function isShortcutsHelpToggle(event: HelpToggleKeyEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.targetIsEditable) return false;
  return event.key === "?";
}

export function ShortcutsHelpDialog({ onClose }: { onClose: () => void }) {
  const platform = getDesktopPlatform();

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="gs-anim-fade"
      style={overlayStyle}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="键盘快捷键" className="gs-anim-pop" style={dialogStyle}>
        <div style={titleStyle}>键盘快捷键</div>
        {SHORTCUT_SECTIONS.map((section) => (
          <section key={section.title} style={sectionStyle}>
            <div style={sectionTitleStyle}>{section.title}</div>
            {section.items.map((item) => (
              <div key={item.label} style={rowStyle}>
                <span style={labelStyle}>{item.label}</span>
                <span style={keysStyle}>
                  {shortcutKeysForPlatform(item.keys, platform).map((key, index) => (
                    <span key={`${key}-${index}`}>
                      {index > 0 && <span style={plusStyle}>+</span>}
                      <kbd className="gs-kbd">{key}</kbd>
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--overlay)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 60,
};
const dialogStyle: React.CSSProperties = {
  width: 440,
  maxWidth: "calc(100vw - 64px)",
  maxHeight: "calc(100vh - 96px)",
  overflowY: "auto",
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-modal)",
  padding: "var(--space-5)",
};
const titleStyle: React.CSSProperties = {
  fontSize: "var(--text-lg)",
  fontWeight: 600,
  color: "var(--text-bright)",
  marginBottom: "var(--space-4)",
};
const sectionStyle: React.CSSProperties = {
  marginBottom: "var(--space-4)",
};
const sectionTitleStyle: React.CSSProperties = {
  fontSize: "var(--text-xs)",
  color: "var(--text-muted)",
  marginBottom: "var(--space-2)",
};
const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-4)",
  padding: "var(--space-1) 0",
};
const labelStyle: React.CSSProperties = {
  fontSize: "var(--text-base)",
  color: "var(--text-primary)",
};
const keysStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  flexShrink: 0,
};
const plusStyle: React.CSSProperties = {
  color: "var(--text-dim)",
  margin: "0 var(--space-1)",
  fontSize: "var(--text-sm)",
};
