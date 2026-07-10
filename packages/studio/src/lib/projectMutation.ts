import type { FileRevision } from "./types";

/**
 * Serializes writes to one project file and carries the revision returned by a
 * successful write into the next queued mutation.
 *
 * A queue instance must only be used for one concrete project-relative file.
 */
export class RevisionedProjectMutationQueue {
  private tail: Promise<void> = Promise.resolve();
  private currentRevision: FileRevision | null | undefined;
  private queuedCount = 0;

  constructor(initialRevision?: FileRevision | null) {
    this.currentRevision = initialRevision;
  }

  get revision(): FileRevision | null | undefined {
    return this.currentRevision;
  }

  get pending(): number {
    return this.queuedCount;
  }

  /**
   * Accept revisions from project refreshes without allowing an older watcher
   * payload to replace a revision produced by a newer local write.
   */
  synchronizeRevision(incoming?: FileRevision | null): void {
    if (incoming === undefined) return;
    if (this.currentRevision == null) {
      this.currentRevision = incoming;
      return;
    }
    if (incoming == null) return;
    if (incoming.relPath !== this.currentRevision.relPath || incoming.mtimeMs > this.currentRevision.mtimeMs) {
      this.currentRevision = incoming;
    }
  }

  enqueue(
    mutation: (expectedRevision: FileRevision | null | undefined) => Promise<FileRevision | null>,
  ): Promise<FileRevision | null> {
    this.queuedCount += 1;
    const execution = this.tail.then(async () => {
      const nextRevision = await mutation(this.currentRevision);
      this.currentRevision = nextRevision;
      return nextRevision;
    });
    const settled = execution.finally(() => {
      this.queuedCount -= 1;
    });

    // A failed write rejects its own promise but must not poison later writes.
    this.tail = settled.then(() => undefined, () => undefined);
    return settled;
  }
}
