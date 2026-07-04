export type WorkspaceId = "render" | "script" | "assets";

export type NavigationLocation =
  | { type: "project-list" }
  | { type: "settings" }
  | { type: "workspace"; workspace: "render" | "assets" }
  | { type: "script-graph" }
  | { type: "script-node"; nodeId: string };

export interface NavigationState {
  entries: NavigationLocation[];
  index: number;
}

export const initialNavigationLocation: NavigationLocation = { type: "project-list" };

export function createNavigationState(initial: NavigationLocation = initialNavigationLocation): NavigationState {
  return { entries: [initial], index: 0 };
}

export function currentLocation(state: NavigationState): NavigationLocation {
  return state.entries[state.index] ?? initialNavigationLocation;
}

export function canGoBack(state: NavigationState): boolean {
  return state.index > 0;
}

export function canGoForward(state: NavigationState): boolean {
  return state.index < state.entries.length - 1;
}

export function goBack(state: NavigationState): NavigationState {
  if (!canGoBack(state)) return state;
  return { ...state, index: state.index - 1 };
}

export function goForward(state: NavigationState): NavigationState {
  if (!canGoForward(state)) return state;
  return { ...state, index: state.index + 1 };
}

export function pushLocation(state: NavigationState, next: NavigationLocation): NavigationState {
  if (sameLocation(currentLocation(state), next)) return state;
  return {
    entries: [...state.entries.slice(0, state.index + 1), next],
    index: state.index + 1,
  };
}

export function replaceLocation(state: NavigationState, next: NavigationLocation): NavigationState {
  if (sameLocation(currentLocation(state), next)) return state;
  return {
    entries: state.entries.map((entry, index) => (index === state.index ? next : entry)),
    index: state.index,
  };
}

export function workspaceFromLocation(location: NavigationLocation): WorkspaceId | null {
  if (location.type === "workspace") return location.workspace;
  if (location.type === "script-graph" || location.type === "script-node") return "script";
  return null;
}

export function sameLocation(a: NavigationLocation, b: NavigationLocation): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "workspace" && b.type === "workspace") return a.workspace === b.workspace;
  if (a.type === "script-node" && b.type === "script-node") return a.nodeId === b.nodeId;
  return true;
}
