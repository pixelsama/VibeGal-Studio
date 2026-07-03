/**
 * 右键菜单 / 弹窗落点的纯函数工具。
 *
 * 菜单必须做 viewport 内定位，避免弹出到窗口外（来自 Everything2Galgame 的前端经验）。
 * 这里把「把一个理想落点钳制到视口内」做成可单测的纯函数。
 */

/** 菜单理想尺寸（与 ContextMenu 组件的样式常量保持一致）。 */
export const MENU_WIDTH = 200;
export const MENU_HEIGHT = 200; // 估算上界（菜单项可变，取保守值）
export const MENU_PADDING = 8; // 离视口边缘留白

export interface Viewport {
  width: number;
  height: number;
}

/**
 * 把一个理想菜单落点（鼠标坐标）钳制到视口内，保证菜单完整可见。
 *
 * - 若右放下得下，优先贴鼠标坐标（菜单左上角 = x,y），符合直觉。
 * - 若右边放不下，向左翻（菜单右下角贴鼠标）。
 * - 上下同理。
 * 始终保证不超出 [MENU_PADDING, viewport - MENU_WIDTH - MENU_PADDING]。
 */
export function clampMenuPosition(
  desired: { x: number; y: number },
  viewport: Viewport,
  options: { menuWidth?: number; menuHeight?: number; padding?: number } = {},
): { x: number; y: number } {
  const menuWidth = options.menuWidth ?? MENU_WIDTH;
  const menuHeight = options.menuHeight ?? MENU_HEIGHT;
  const padding = options.padding ?? MENU_PADDING;

  const maxX = Math.max(padding, viewport.width - menuWidth - padding);
  const maxY = Math.max(padding, viewport.height - menuHeight - padding);

  return {
    x: Math.min(Math.max(desired.x, padding), maxX),
    y: Math.min(Math.max(desired.y, padding), maxY),
  };
}
