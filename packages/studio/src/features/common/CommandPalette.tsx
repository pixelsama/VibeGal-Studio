/**
 * 命令面板（Ctrl/Cmd+K 唤起）。
 *
 * 范围刻意克制：跳转节点 + 切换工作台，两项都复用现有导航（navigateWithGuard）。
 * 过滤与键盘导航的索引回绕是纯函数（filterCommandItems / moveActiveIndex），
 * 便于单测；组件只负责渲染与事件接线。
 */
import { useMemo, useState } from "react";

export interface CommandItem {
  id: string;
  label: string;
  /** 右侧灰色辅助信息（如节点 id、"工作台"分组名） */
  hint?: string;
  /** 额外搜索词（不参与展示） */
  keywords?: string;
  onSelect: () => void;
}

/** 大小写不敏感的子串过滤；空 query 返回全量。 */
export function filterCommandItems(items: CommandItem[], query: string): CommandItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => (
    item.label.toLowerCase().includes(q) || (item.keywords ?? "").toLowerCase().includes(q)
  ));
}

/** ↑/↓ 导航的索引移动，两端回绕；空列表恒为 0。 */
export function moveActiveIndex(current: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return ((current + delta) % count + count) % count;
}

/** 过滤结果变化后当前索引可能越界，渲染与回车都用钳制值。 */
export function clampActiveIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(index, 0), count - 1);
}

export function CommandPalette({ items, onClose }: { items: CommandItem[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const filtered = useMemo(() => filterCommandItems(items, query), [items, query]);
  const active = clampActiveIndex(activeIndex, filtered.length);

  const runItem = (item: CommandItem) => {
    onClose();
    item.onSelect();
  };

  return (
    <div
      className="gs-anim-fade"
      style={overlayStyle}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="命令面板" className="gs-anim-pop" style={panelStyle}>
        <input
          autoFocus
          value={query}
          placeholder="搜索节点或工作台…"
          aria-label="搜索命令"
          style={inputStyle}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((index) => moveActiveIndex(clampActiveIndex(index, filtered.length), 1, filtered.length));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => moveActiveIndex(clampActiveIndex(index, filtered.length), -1, filtered.length));
            } else if (event.key === "Enter") {
              event.preventDefault();
              const item = filtered[active];
              if (item) runItem(item);
            } else if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
        />
        <div role="listbox" aria-label="命令列表" style={listStyle}>
          {filtered.length === 0 && <div style={emptyStyle}>无匹配结果</div>}
          {filtered.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={index === active}
              className={index === active ? "gs-command-item gs-command-item--active" : "gs-command-item"}
              ref={(el) => {
                if (index === active) el?.scrollIntoView?.({ block: "nearest" });
              }}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => runItem(item)}
            >
              <span style={itemLabelStyle}>{item.label}</span>
              {item.hint && <span style={itemHintStyle}>{item.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--overlay)",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  zIndex: 60,
};
const panelStyle: React.CSSProperties = {
  marginTop: "15vh",
  width: 480,
  maxWidth: "calc(100vw - 64px)",
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-modal)",
  overflow: "hidden",
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "var(--space-3) var(--space-4)",
  fontSize: "var(--text-md)",
  background: "transparent",
  border: "none",
  borderBottom: "1px solid var(--border)",
  color: "var(--text-bright)",
  outline: "none",
};
const listStyle: React.CSSProperties = {
  maxHeight: "50vh",
  overflowY: "auto",
  padding: "var(--space-1)",
};
const emptyStyle: React.CSSProperties = {
  padding: "var(--space-4)",
  textAlign: "center",
  color: "var(--text-muted)",
  fontSize: "var(--text-base)",
};
const itemLabelStyle: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const itemHintStyle: React.CSSProperties = {
  flexShrink: 0,
  color: "var(--text-dim)",
  fontSize: "var(--text-xs)",
};
