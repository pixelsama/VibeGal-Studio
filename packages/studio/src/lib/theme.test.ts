import { describe, expect, it, vi } from "vitest";
import { createLatestSettingsSaver, type AppSettings } from "./theme";

describe("createLatestSettingsSaver", () => {
  it("serializes saves so the last requested settings are the final write", async () => {
    const firstSave = deferred();
    const secondSave = deferred();
    const saved: AppSettings[] = [];
    const save = vi.fn((settings: AppSettings) => {
      saved.push(settings);
      return saved.length === 1 ? firstSave.promise : secondSave.promise;
    });
    const saver = createLatestSettingsSaver(save, () => {});

    const pending = saver.requestSave({ theme: "dark" });
    saver.requestSave({ theme: "light" });

    expect(save).toHaveBeenCalledTimes(1);
    firstSave.resolve();
    await Promise.resolve();

    expect(save).toHaveBeenCalledTimes(2);
    expect(saved).toEqual([{ theme: "dark" }, { theme: "light" }]);

    secondSave.resolve();
    await pending;
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
