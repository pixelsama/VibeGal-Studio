import { describe, expect, it } from "vitest";
import {
  clearProjectDraft,
  loadProjectDraft,
  projectDraftStorageKey,
  saveProjectDraft,
  type DraftStorage,
} from "./draftRecovery";

function memoryStorage(): DraftStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

describe("project draft recovery", () => {
  it("scopes drafts by project and resource", () => {
    expect(projectDraftStorageKey("/one", "content/manifest.json"))
      .not.toBe(projectDraftStorageKey("/two", "content/manifest.json"));
    expect(projectDraftStorageKey("/one", "content/nodes/a.json"))
      .not.toBe(projectDraftStorageKey("/one", "content/nodes/b.json"));
  });

  it("round-trips and clears JSON drafts in session storage", () => {
    const storage = memoryStorage();
    const key = projectDraftStorageKey("/project", "content/nodes/a.json");

    saveProjectDraft(storage, key, { mode: "scenario", text: "草稿" });
    expect(loadProjectDraft(storage, key)).toEqual({ mode: "scenario", text: "草稿" });
    clearProjectDraft(storage, key);
    expect(loadProjectDraft(storage, key)).toBeNull();
  });

  it("ignores corrupt stored drafts instead of breaking the editor", () => {
    const storage = memoryStorage();
    const key = projectDraftStorageKey("/project", "content/manifest.json");
    storage.setItem(key, "not-json");

    expect(loadProjectDraft(storage, key)).toBeNull();
  });
});
