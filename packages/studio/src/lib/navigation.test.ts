import { describe, expect, it } from "vitest";
import {
  canGoBack,
  canGoForward,
  createNavigationState,
  currentLocation,
  goBack,
  goForward,
  pushLocation,
  replaceLocation,
  workspaceFromLocation,
} from "./navigation";

describe("semantic navigation history", () => {
  it("moves backward and forward through meaningful app locations", () => {
    let state = createNavigationState();
    state = pushLocation(state, { type: "workspace", workspace: "render" });
    state = pushLocation(state, { type: "script-graph" });
    state = pushLocation(state, { type: "script-node", nodeId: "intro" });

    expect(currentLocation(state)).toEqual({ type: "script-node", nodeId: "intro" });
    expect(canGoBack(state)).toBe(true);
    expect(canGoForward(state)).toBe(false);

    state = goBack(state);
    expect(currentLocation(state)).toEqual({ type: "script-graph" });
    expect(canGoForward(state)).toBe(true);

    state = goForward(state);
    expect(currentLocation(state)).toEqual({ type: "script-node", nodeId: "intro" });
  });

  it("does not add duplicate adjacent entries", () => {
    let state = createNavigationState({ type: "workspace", workspace: "render" });
    state = pushLocation(state, { type: "workspace", workspace: "render" });

    expect(state.entries).toEqual([{ type: "workspace", workspace: "render" }]);
    expect(state.index).toBe(0);
  });

  it("clears forward entries when navigating after back", () => {
    let state = createNavigationState();
    state = pushLocation(state, { type: "workspace", workspace: "render" });
    state = pushLocation(state, { type: "script-graph" });
    state = goBack(state);
    state = pushLocation(state, { type: "workspace", workspace: "assets" });

    expect(currentLocation(state)).toEqual({ type: "workspace", workspace: "assets" });
    expect(canGoForward(state)).toBe(false);
    expect(state.entries).toEqual([
      { type: "project-list" },
      { type: "workspace", workspace: "render" },
      { type: "workspace", workspace: "assets" },
    ]);
  });

  it("can replace invalid locations without changing history depth", () => {
    let state = createNavigationState({ type: "script-node", nodeId: "missing" });
    state = replaceLocation(state, { type: "script-graph" });

    expect(state.entries).toEqual([{ type: "script-graph" }]);
    expect(state.index).toBe(0);
  });

  it("maps project locations to workspace tabs", () => {
    expect(workspaceFromLocation({ type: "workspace", workspace: "render" })).toBe("render");
    expect(workspaceFromLocation({ type: "workspace", workspace: "assets" })).toBe("assets");
    expect(workspaceFromLocation({ type: "workspace", workspace: "project" })).toBe("project");
    expect(workspaceFromLocation({ type: "script-node", nodeId: "intro" })).toBe("script");
    expect(workspaceFromLocation({ type: "script-graph" })).toBe("script");
    expect(workspaceFromLocation({ type: "project-list" })).toBeNull();
  });

  it("treats settings as a global (non-workspace) location", () => {
    expect(workspaceFromLocation({ type: "settings" })).toBeNull();
  });

  it("can navigate to project settings and back", () => {
    let state = createNavigationState({ type: "workspace", workspace: "render" });
    state = pushLocation(state, { type: "workspace", workspace: "project" });
    expect(currentLocation(state)).toEqual({ type: "workspace", workspace: "project" });
    expect(canGoBack(state)).toBe(true);

    state = goBack(state);
    expect(currentLocation(state)).toEqual({ type: "workspace", workspace: "render" });
  });

  it("can navigate to global app settings without selecting a workspace tab", () => {
    let state = createNavigationState({ type: "workspace", workspace: "render" });
    state = pushLocation(state, { type: "settings" });

    expect(currentLocation(state)).toEqual({ type: "settings" });
    expect(workspaceFromLocation(currentLocation(state))).toBeNull();
  });
});
