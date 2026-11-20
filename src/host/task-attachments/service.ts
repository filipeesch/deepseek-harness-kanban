import { randomUUID } from 'node:crypto';
import { KanbanError } from '../../shared/errors.js';
import type { HubState, TaskAttachment, TaskAttachmentOrigin } from '../../shared/types.js';
import { addTaskAttachments, requireTaskAttachment, taskAttachments } from '../../domain/task-attachment.js';
import type { TaskAttachmentStore } from './store.js';
import { TaskAttachmentStore as Store } from './store.js';

/**
 * The plugin's attachment surface for one task: store a file, read it back, and
 * remove it. Every write resolves its source first, because a task must never be
 * created carrying only part of the files it was given.
 */
export interface TaskAttachmentServiceDeps {
  readonly store: TaskAttachmentStore;
  /** The Hub aggregate holding the task, so a write validates against live state. */
  readonly hub: (hubId: string) => HubState;
  readonly ids?: () => string;
}

/** One resolved source a caller asked to attach, before it becomes a record. */
export interface AttachmentSourceInput {
  readonly name: string;
  readonly origin: TaskAttachmentOrigin;
  readonly data: Uint8Array;
}

/** One attachment as the browser reads it back. */
export interface ReadTaskAttachment {
  readonly name: string;
  readonly bytes: number;
  readonly origin: TaskAttachmentOrigin;
  readonly data: Uint8Array;
}

export class TaskAttachments {
  private readonly hub: (hubId: string) => HubState;
  private readonly ids: () => string;

  /** The underlying object store, shared with the answer-file surface. */
  readonly store: TaskAttachmentStore;

  constructor(deps: TaskAttachmentServiceDeps) {
    this.store = deps.store;
    this.hub = deps.hub;
    this.ids = deps.ids ?? (() => randomUUID());
  }

  /**
   * Resolve every supplied path before anything is stored. A single unreadable
   * path fails the whole batch, so a creation never records a partial set.
   *
   * @param paths - absolute host paths in the caller's order.
   * @returns one resolved source per path, in the same order.
   */
  static async resolvePaths(paths: readonly string[]): Promise<AttachmentSourceInput[]> {
    const resolved: AttachmentSourceInput[] = [];
    for (const path of paths) {
      const source = await Store.readSourcePath(path);
      resolved.push({ name: source.name, origin: 'path', data: source.data });
    }
    return resolved;
  }

  /**
   * Store one batch of already-resolved sources and return the records to record
   * on a task.
   *
   * @param taskId - the task that will own the files.
   * @param sources - resolved sources in the caller's order.
   */
  async storeAll(taskId: string, sources: readonly AttachmentSourceInput[]): Promise<TaskAttachment[]> {
    const written: TaskAttachment[] = [];
    try {
      for (const source of sources) {
        const stored = await this.store.store(taskId, source, this.ids());
        written.push(stored.attachment);
      }
      return written;
    } catch (error) {
      // A batch that fails partway publishes no partial set. A cleanup failure is
      // attached to the original error rather than replacing or hiding it, so the
      // caller still learns why the batch failed and that objects remain.
      try { await this.removeAll(taskId, written); }
      catch (cleanup) { throw attachmentBatchFailure(error, cleanup); }
      throw error;
    }
  }

  /**
   * Delete the bytes of an attachment after its record has been removed.
   *
   * @param taskId - the task that held the attachment.
   * @param attachment - the metadata that named the object.
   */
  async removeBytes(taskId: string, attachment: TaskAttachment): Promise<void> {
    await this.store.remove(taskId, attachment);
  }

  /** Delete the bytes of several attachments, reporting the first failure. */
  async removeAll(taskId: string, attachments: readonly TaskAttachment[]): Promise<void> {
    const failures: unknown[] = [];
    for (const attachment of attachments) {
      try { await this.store.remove(taskId, attachment); }
      catch (error) { failures.push(error); }
    }
    if (failures.length > 0) {
      const first = failures[0];
      throw new KanbanError('ATTACHMENT_DELETE_FAILED', 'Some attachment bytes could not be deleted.', {
        failed: failures.length,
        cause: first instanceof Error ? first.message : String(first),
      });
    }
  }

  /**
   * Delete every stored object of one task. A failure is reported, never thrown as
   * a reason to keep the task: the record is already gone, and the board must stay
   * truthful about it.
   *
   * @param taskId - the deleted task.
   * @returns the failure when the directory could not be removed.
   */
  async removeTaskFiles(taskId: string): Promise<Error | undefined> {
    try { await this.store.removeAll(taskId); return undefined; }
    catch (error) { return error instanceof Error ? error : new Error(String(error)); }
  }

  /**
   * Read one attachment's exact bytes for a client.
   *
   * @param hubId - the Hub holding the task.
   * @param taskId - the owning task.
   * @param attachmentId - the recorded attachment.
   */
  async read(hubId: string, taskId: string, attachmentId: string): Promise<ReadTaskAttachment> {
    const attachment = requireTaskAttachment(this.hub(hubId), taskId, attachmentId);
    const data = await this.store.read(taskId, attachment);
    return { name: attachment.name, bytes: attachment.bytes, origin: attachment.origin, data };
  }
  /**
   * The readable path of one attachment's stored object. The task context reports
   * it so an agent reads the file with its own tools instead of an attachment API.
   *
   * @param taskId - the owning task.
   * @param attachment - the recorded attachment.
   */
  pathOf(taskId: string, attachment: TaskAttachment): string {
    return this.store.pathOf(taskId, attachment);
  }

}
/**
 * Answer files: the working copies a question draft holds before submission.
 *
 * They live in their own directory, keyed by conversation, because a round belongs
 * to a conversation that may have no task card. A conversation identity therefore
 * cannot address a task file, even if a client supplies a colliding identifier.
 * The bytes a submitted answer delivers live in the host attachment store once the
 * accepted; these are the draft copies the browser re-reads to deliver them.
 */
export class QuestionAttachments {
  constructor(private readonly store: TaskAttachmentStore) {}

  /**
   * Store one file for a conversation and return the reference the draft keeps.
   *
   * @param sessionId - the conversation owning the round.
   * @param input - display name and exact bytes.
   * @param id - the attachment identity the caller allocated.
   */
  async save(sessionId: string, input: { name: string; data: Uint8Array }, id: string): Promise<{ id: string; name: string; bytes: number }> {
    const stored = await this.store.store(sessionId, { name: input.name, origin: 'upload', data: input.data }, id);
    return { id: stored.attachment.id, name: stored.attachment.name, bytes: stored.attachment.bytes };
  }

  /**
   * Read one draft file back, so a restored draft can deliver it and a reload is
   * never a silent loss.
   *
   * @param sessionId - the conversation owning the round.
   * @param attachment - the reference the draft holds.
   */
  async read(sessionId: string, reference: { id: string }): Promise<{ name: string; bytes: number; data: Uint8Array }> {
    // Only the identity is taken from the caller; the name and the length come from
    // the object the host stored, so a tampered reference cannot relabel a file.
    const { data, attachment } = await this.store.readOwned(sessionId, reference.id);
    return { name: attachment.name, bytes: attachment.bytes, data };
  }

  /** Delete one draft file whose attachment the user detached. */
  async remove(sessionId: string, reference: { id: string }): Promise<void> {
    // Removing an already-reclaimed copy is success, not failure: the caller asked for the
    // bytes to be absent and they are, so a duplicate cleanup cannot surface as an error.
    try {
      const { attachment } = await this.store.readOwned(sessionId, reference.id);
      await this.store.remove(sessionId, attachment);
    } catch (error) {
      if ((error as { code?: unknown }).code !== 'ATTACHMENT_MISSING') throw error;
    }
  }
}


/**
 * Combine the reason a batch failed with the reason its cleanup failed. The original
 * failure stays the primary cause, so the caller reports what actually went wrong and
 * the cleanup problem travels alongside it rather than replacing it.
 *
 * @param failure - why the batch could not be stored.
 * @param cleanup - why the partial objects could not be removed.
 */
function attachmentBatchFailure(failure: unknown, cleanup: unknown): KanbanError {
  const reason = failure instanceof Error ? failure.message : String(failure);
  const leftover = cleanup instanceof Error ? cleanup.message : String(cleanup);
  return new KanbanError('ATTACHMENT_BATCH_FAILED', 'The files could not be stored: ' + reason, {
    cleanup: leftover,
  });
}

export { addTaskAttachments };
