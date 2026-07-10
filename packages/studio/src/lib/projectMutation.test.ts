import { describe, expect, it } from "vitest";
import type { FileRevision } from "./types";
import { RevisionedProjectMutationQueue } from "./projectMutation";

const firstRevision: FileRevision = {
  relPath: "content/graph.json",
  mtimeMs: 1,
  size: 10,
};

const secondRevision: FileRevision = {
  relPath: "content/graph.json",
  mtimeMs: 2,
  size: 11,
};

describe("RevisionedProjectMutationQueue", () => {
  it("serializes writes and passes the revision returned by one write to the next", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const seen: Array<FileRevision | null | undefined> = [];
    const queue = new RevisionedProjectMutationQueue(firstRevision);

    const first = queue.enqueue(async (expectedRevision) => {
      seen.push(expectedRevision);
      await firstGate;
      return secondRevision;
    });
    const thirdRevision = { ...secondRevision, mtimeMs: 3 };
    const second = queue.enqueue(async (expectedRevision) => {
      seen.push(expectedRevision);
      return thirdRevision;
    });

    await Promise.resolve();
    expect(seen).toEqual([firstRevision]);
    releaseFirst();

    await expect(first).resolves.toBe(secondRevision);
    await expect(second).resolves.toBe(thirdRevision);
    expect(seen).toEqual([firstRevision, secondRevision]);
    expect(queue.revision).toBe(thirdRevision);
  });

  it("continues processing later writes after a failed mutation", async () => {
    const queue = new RevisionedProjectMutationQueue(firstRevision);
    const failed = queue.enqueue(async () => {
      throw new Error("write conflict");
    });
    const next = queue.enqueue(async (expectedRevision) => {
      expect(expectedRevision).toBe(firstRevision);
      return secondRevision;
    });

    await expect(failed).rejects.toThrow("write conflict");
    await expect(next).resolves.toBe(secondRevision);
  });

  it("does not replace a newer local revision with an older watcher refresh", async () => {
    const queue = new RevisionedProjectMutationQueue(secondRevision);

    queue.synchronizeRevision(firstRevision);

    expect(queue.revision).toBe(secondRevision);
  });

  it("keeps the local revision when a stale refresh has the same timestamp", () => {
    const local = { ...secondRevision, size: 20 };
    const staleRefresh = { ...secondRevision, size: 10 };
    const queue = new RevisionedProjectMutationQueue(local);

    queue.synchronizeRevision(staleRefresh);

    expect(queue.revision).toBe(local);
  });
});
