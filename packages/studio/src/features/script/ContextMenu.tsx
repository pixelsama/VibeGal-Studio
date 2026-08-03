import { useEffect, useRef, useState } from "react";
import { clampMenuPosition, MENU_HEIGHT, MENU_WIDTH } from "./canvasMenu";

export interface ContextMenuItem {
  /** 唯一 key。 */
  key: string;
  /** 显示文案。 */
  label: string;
  /** 点击回调；点击后菜单自动关闭。 */
  onSelect: () => void;
  /** 是否禁用。 */
  disabled?: boolean;
  /** 是否危险操作（删除等），红色高亮。 */
  danger?: boolean;
  /** 可选分组分隔：为 true 时，这一项之前画一条分隔线。 */
  dividerBefore?: boolean;
}

interface ContextMenuProps {
  /** 期望落点（通常是鼠标 clientX/clientY，相对视口）。 */
  anchor: { x: number; y: number };
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * 画布右键菜单。
 *
 * - 用 fixed 定位 + clampMenuPosition 钳到视口内，绝不弹出窗口外。
 * - 点击菜单项或视口任意处 / Esc 关闭。
 * - 菜单不跟随画布缩放（来自 Everything2Galgame 经验：画布工具层固定悬浮）。
 */
export function ContextMenu({ anchor, items, onClose }: ContextMenuProps) {
  const [viewport, setViewport] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const ref = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // 打开时聚焦第一个可用项，方向键在其间移动（roving tabindex）。
  const [activeIndex, setActiveIndex] = useState(() => items.findIndex((item) => !item.disabled));

  useEffect(() => {
    const handleResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // 真实菜单高度按项数估算，钳制更准。
  const estimatedHeight = Math.min(MENU_HEIGHT, items.length * 36 + 12);
  const pos = clampMenuPosition(anchor, viewport, {
    menuWidth: MENU_WIDTH,
    menuHeight: estimatedHeight,
  });

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    // 用 mousedown 而非 click，避免右键事件本身立即触发关闭
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // 打开即聚焦首个可用菜单项，让键盘用户能立刻用方向键导航。
  useEffect(() => {
    itemRefs.current[activeIndex]?.focus();
  }, []);

  const enabledIndices = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.disabled)
    .map(({ index }) => index);

  const focusIndex = (index: number) => {
    setActiveIndex(index);
    itemRefs.current[index]?.focus();
  };

  const moveActive = (delta: 1 | -1) => {
    if (enabledIndices.length === 0) return;
    const currentPos = enabledIndices.indexOf(activeIndex);
    const nextPos = currentPos === -1 ? 0 : (currentPos + delta + enabledIndices.length) % enabledIndices.length;
    focusIndex(enabledIndices[nextPos]);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      if (enabledIndices.length > 0) focusIndex(enabledIndices[0]);
    } else if (event.key === "End") {
      event.preventDefault();
      if (enabledIndices.length > 0) focusIndex(enabledIndices[enabledIndices.length - 1]);
    }
  };

  return (
    <div ref={ref} role="menu" className="gs-anim-pop" onKeyDown={handleKeyDown} style={{ ...menuStyle, left: pos.x, top: pos.y }}>
      {items.map((item, index) => (
        <div key={item.key}>
          {item.dividerBefore && <div style={dividerStyle} />}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            tabIndex={index === activeIndex ? 0 : -1}
            ref={(element) => { itemRefs.current[index] = element; }}
            className="gs-menu-item"
            onClick={() => {
              if (item.disabled) return;
              item.onSelect();
              onClose();
            }}
            style={{
              color: item.disabled
                ? "var(--text-dim)"
                : item.danger
                  ? "var(--status-error-text)"
                  : "var(--text-primary)",
              cursor: item.disabled ? "not-allowed" : "pointer",
            }}
          >
            {item.label}
          </button>
        </div>
      ))}
    </div>
  );
}

const menuStyle: React.CSSProperties = {
  position: "fixed",
  zIndex: 1000,
  minWidth: 180,
  maxWidth: MENU_WIDTH,
  padding: "var(--space-2)",
  background: "var(--bg-panel)",
  border: "1px solid var(--border-input)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-pop)",
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

const dividerStyle: React.CSSProperties = {
  height: 1,
  margin: "var(--space-1) var(--space-1)",
  background: "var(--border)",
};
