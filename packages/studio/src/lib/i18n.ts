const zhCN = {
  "app.loadingSettings": "正在加载设置",
  "navigation.back": "后退",
  "navigation.forward": "前进",
  "workspace.tab.render": "渲染",
  "workspace.tab.script": "脚本",
  "workspace.tab.assets": "资产",
  "workspace.tab.project": "项目",
  "workspace.currentRenderer": "当前渲染层",
  "workspace.noRenderer": "无渲染层",
  "settings.title": "设置",
  "settings.appearance.title": "外观",
  "settings.appearance.description": "选择编辑器界面的配色主题。预览区（游戏渲染层）不受影响。",
  "settings.theme.dark": "深色",
  "settings.theme.light": "浅色",
  "settings.theme.current": "当前",
  "script.title": "脚本",
} as const;

export type Locale = "zh-CN";
type Messages = typeof zhCN;
export type MessageKey = keyof Messages;

export const DEFAULT_LOCALE: Locale = "zh-CN";

export const dictionaries: Record<Locale, Messages> = {
  "zh-CN": zhCN,
};

export function t(key: MessageKey, locale: Locale = DEFAULT_LOCALE): string {
  return dictionaries[locale][key];
}
