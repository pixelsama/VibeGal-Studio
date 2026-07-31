/**
 * 外观属性组的折叠偏好（Spec 33 §6.4：收敛默认可见集）。
 *
 * 只存「与默认展开集的差异」：缺失的组 id 一律回退默认展开集
 * （dialogueBox/nameBox/choiceBox/stage 展开，其余折叠）。渲染层声明的
 * 分组集合可能变化，孤儿 key 无害——找不到就回退默认。
 * 折叠状态是个人工作习惯（UI 偏好），不进 manifest，与 sidebarPrefs 同层。
 */
export interface AppearanceGroupPrefs {
  /** 组 id → 折叠状态覆盖；与默认展开集一致时不存在该 key。 */
  collapsedOverrides: Record<string, boolean>;
}

export interface AppearanceGroupPrefsStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export const APPEARANCE_GROUP_PREFS_STORAGE_KEY = "vibegal.appearanceGroupPrefs.v1";

/** 默认展开的属性组（故事创作高频）；其余组默认折叠。 */
export const DEFAULT_EXPANDED_APPEARANCE_GROUPS: readonly string[] = ["dialogueBox", "nameBox", "choiceBox", "stage"];

export const DEFAULT_APPEARANCE_GROUP_PREFS: AppearanceGroupPrefs = {
  collapsedOverrides: {},
};

export function loadAppearanceGroupPrefs(storage = browserLocalStorage()): AppearanceGroupPrefs {
  if (!storage) return { ...DEFAULT_APPEARANCE_GROUP_PREFS };

  try {
    const raw = storage.getItem(APPEARANCE_GROUP_PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_APPEARANCE_GROUP_PREFS };
    return normalizeAppearanceGroupPrefs(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_APPEARANCE_GROUP_PREFS };
  }
}

export function saveAppearanceGroupPrefs(
  prefs: AppearanceGroupPrefs,
  storage = browserLocalStorage(),
): AppearanceGroupPrefs {
  if (!storage) return prefs;

  try {
    storage.setItem(APPEARANCE_GROUP_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage failure should not block the appearance workspace interaction itself.
  }

  return prefs;
}

/**
 * 记录一个组的折叠覆盖；与默认展开集一致时删除该 key，
 * 让存储永远只含差异（渲染层分组变化时旧 key 自然失效）。
 */
export function updateAppearanceGroupPref(
  groupId: string,
  collapsed: boolean,
  storage = browserLocalStorage(),
): AppearanceGroupPrefs {
  const overrides = { ...loadAppearanceGroupPrefs(storage).collapsedOverrides };
  if (collapsed === !isAppearanceGroupDefaultExpanded(groupId)) {
    delete overrides[groupId];
  } else {
    overrides[groupId] = collapsed;
  }
  return saveAppearanceGroupPrefs({ collapsedOverrides: overrides }, storage);
}

export function isAppearanceGroupDefaultExpanded(groupId: string): boolean {
  return DEFAULT_EXPANDED_APPEARANCE_GROUPS.includes(groupId);
}

export function effectiveAppearanceGroupCollapsed(
  groupId: string,
  overrides: Record<string, boolean>,
): boolean {
  return overrides[groupId] ?? !isAppearanceGroupDefaultExpanded(groupId);
}

function browserLocalStorage(): AppearanceGroupPrefsStorage | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

function normalizeAppearanceGroupPrefs(value: unknown): AppearanceGroupPrefs {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_APPEARANCE_GROUP_PREFS };
  }

  const maybe = value as Partial<AppearanceGroupPrefs>;
  const rawOverrides = maybe.collapsedOverrides;
  const collapsedOverrides: Record<string, boolean> = {};
  if (rawOverrides && typeof rawOverrides === "object" && !Array.isArray(rawOverrides)) {
    for (const [groupId, collapsed] of Object.entries(rawOverrides)) {
      if (typeof collapsed === "boolean") collapsedOverrides[groupId] = collapsed;
    }
  }
  return { collapsedOverrides };
}
