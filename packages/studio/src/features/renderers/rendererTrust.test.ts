import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRendererTrust,
  configureRendererTrustPersistence,
  initializeRendererTrust,
  isProjectRendererTrusted,
  trustProjectRenderer,
} from "./rendererTrust";

const load = vi.fn();
const save = vi.fn();

describe("project renderer trust", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    load.mockResolvedValue({});
    save.mockResolvedValue(undefined);
    configureRendererTrustPersistence({ load, save });
    void clearRendererTrust();
  });

  it("requires an explicit trust decision for a project, renderer, and source fingerprint", async () => {
    await initializeRendererTrust();
    expect(isProjectRendererTrusted("/projects/a", "default", "hash-a")).toBe(false);

    await trustProjectRenderer("/projects/a", "default", "hash-a");

    expect(isProjectRendererTrusted("/projects/a", "default", "hash-a")).toBe(true);
    expect(isProjectRendererTrusted("/projects/a", "default", "hash-b")).toBe(false);
    expect(isProjectRendererTrusted("/projects/a", "mobile", "hash-a")).toBe(false);
    expect(isProjectRendererTrusted("/projects/b", "default", "hash-a")).toBe(false);
  });

  it("accepts the app bootstrap snapshot without a second settings read", async () => {
    await initializeRendererTrust({ '["/projects/a","default"]': "hash-a" });

    expect(load).not.toHaveBeenCalled();
    expect(isProjectRendererTrusted("/projects/a", "default", "hash-a")).toBe(true);
  });

  it("loads persisted trust decisions when Studio starts", async () => {
    load.mockResolvedValue({ '["/projects/a","default"]': "hash-a" });

    await initializeRendererTrust();

    expect(isProjectRendererTrusted("/projects/a", "default", "hash-a")).toBe(true);
    expect(isProjectRendererTrusted("/projects/a", "default", "hash-b")).toBe(false);
  });

  it("persists the latest fingerprint and revokes stale content", async () => {
    await initializeRendererTrust();

    await trustProjectRenderer("/projects/a", "default", "hash-a");
    await trustProjectRenderer("/projects/a", "default", "hash-b");

    expect(save).toHaveBeenLastCalledWith({ '["/projects/a","default"]': "hash-b" });
    expect(isProjectRendererTrusted("/projects/a", "default", "hash-a")).toBe(false);
    expect(isProjectRendererTrusted("/projects/a", "default", "hash-b")).toBe(true);
  });

  it("continues persisting later trust decisions after a failed save", async () => {
    save.mockRejectedValueOnce(new Error("disk unavailable"));
    await initializeRendererTrust();

    await expect(
      trustProjectRenderer("/projects/a", "default", "hash-a"),
    ).rejects.toThrow("disk unavailable");
    await trustProjectRenderer("/projects/a", "default", "hash-b");

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ '["/projects/a","default"]': "hash-b" });
    expect(isProjectRendererTrusted("/projects/a", "default", "hash-b")).toBe(true);
  });

  it("revokes only the changed project when requested", async () => {
    await initializeRendererTrust();
    await trustProjectRenderer("/projects/a", "default", "hash-a");
    await trustProjectRenderer("/projects/b", "default", "hash-b");

    await clearRendererTrust("/projects/a");

    expect(isProjectRendererTrusted("/projects/a", "default", "hash-a")).toBe(false);
    expect(isProjectRendererTrusted("/projects/b", "default", "hash-b")).toBe(true);
    expect(save).toHaveBeenLastCalledWith({ '["/projects/b","default"]': "hash-b" });
  });
});
