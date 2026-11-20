import { TASK_ATTACHMENT_ORIGINS } from '../shared/types.js';
import type { HubState, HubTask, Task, TaskAttachment, TaskAttachmentOrigin } from '../shared/types.js';
import { KanbanError, invariant } from '../shared/errors.js';
import { requireTask } from './hub-operations.js';

/**
 * The task attachment write rules, shared by the command lane, the card tools, and
 * the creation input so every path validates the same way.
 *
 * A write never touches bytes: the caller stores them first and then records the
 * metadata, and a caller that must not leave a partial task resolves every source
 * before it starts.
 */

/** One attachment a write adds: its identity, metadata, and origin. */
export interface TaskAttachmentWrite {
  readonly id: string;
  readonly name: string;
  readonly bytes: number;
  readonly origin: TaskAttachmentOrigin;
}

function assertAttachment(value: TaskAttachmentWrite): void {
  invariant(typeof value.id === 'string' && value.id.length > 0, 'INVALID_INPUT', 'Attachment identity is required.');
  invariant(typeof value.name === 'string' && value.name.trim().length > 0, 'INVALID_INPUT', 'Attachment name is required.');
  invariant(Number.isSafeInteger(value.bytes) && value.bytes >= 0, 'INVALID_INPUT', 'Attachment byte length must be a nonnegative whole number.');
  invariant(TASK_ATTACHMENT_ORIGINS.includes(value.origin), 'INVALID_INPUT', 'Unknown attachment origin.');
}

/** The attachments one task currently carries. */
export function taskAttachments(task: Pick<Task, 'attachments'>): readonly TaskAttachment[] {
  return task.attachments ?? [];
}

/** Whether one task already records an attachment with this identity. */
export function hasAttachment(task: HubTask, attachmentId: string): boolean {
  return taskAttachments(task).some(attachment => attachment.id === attachmentId);
}

/**
 * Record attachments on one task, preserving the order they are supplied in and
 * refusing an identity that task already holds.
 *
 * @param task - the task being written.
 * @param additions - validated attachments to append.
 */
export function addTaskAttachments(task: HubTask, additions: readonly TaskAttachmentWrite[]): void {
  if (additions.length === 0) return;
  const existing = new Set(taskAttachments(task).map(attachment => attachment.id));
  const appended: TaskAttachment[] = [];
  for (const addition of additions) {
    assertAttachment(addition);
    if (existing.has(addition.id)) throw new KanbanError('ATTACHMENT_DUPLICATE', 'This task already holds an attachment with that identity.', { attachmentId: addition.id });
    existing.add(addition.id);
    appended.push({ id: addition.id, name: addition.name, bytes: addition.bytes, origin: addition.origin });
  }
  task.attachments = [...taskAttachments(task), ...appended];
}

/**
 * Drop one attachment from a task's record.
 *
 * @param task - the task being written.
 * @param attachmentId - the attachment to forget.
 * @returns the metadata that was recorded, so the caller can delete its bytes.
 */
export function removeTaskAttachment(task: HubTask, attachmentId: string): TaskAttachment {
  invariant(typeof attachmentId === 'string' && attachmentId.length > 0, 'INVALID_INPUT', 'Attachment identity is required.');
  const current = taskAttachments(task);
  const removed = current.find(attachment => attachment.id === attachmentId);
  if (removed === undefined) throw new KanbanError('ATTACHMENT_NOT_FOUND', 'This task does not hold that attachment.', { attachmentId });
  const remaining = current.filter(attachment => attachment.id !== attachmentId);
  if (remaining.length === 0) delete task.attachments;
  else task.attachments = remaining;
  return removed;
}

/**
 * The removal rule a tool applies: an attachment's bytes are destroyed, so the
 * caller must have confirmed. The refusal names what would be lost.
 *
 * @param task - the task carrying the attachment.
 * @param attachmentId - the attachment to remove.
 * @param confirmed - whether the caller explicitly confirmed the removal.
 */
export function assertAttachmentRemoval(task: HubTask, attachmentId: string, confirmed: boolean | undefined): TaskAttachment {
  const current = taskAttachments(task).find(attachment => attachment.id === attachmentId);
  if (current === undefined) throw new KanbanError('ATTACHMENT_NOT_FOUND', 'This task does not hold that attachment.', { attachmentId });
  if (confirmed !== true) throw new KanbanError('CONFIRMATION_REQUIRED', 'Removing the attachment "' + current.name + '" deletes its stored bytes; confirm the removal.', { attachmentId, name: current.name });
  return current;
}

/**
 * Read one attachment off a task, or fail naming the attachment.
 *
 * @param hub - the Hub holding the task.
 * @param taskId - the owning task identity.
 * @param attachmentId - the requested attachment identity.
 */
export function requireTaskAttachment(hub: HubState, taskId: string, attachmentId: string): TaskAttachment {
  const task = requireTask(hub, taskId);
  const attachment = taskAttachments(task).find(value => value.id === attachmentId);
  if (attachment === undefined) throw new KanbanError('ATTACHMENT_NOT_FOUND', 'The task does not hold that attachment.', { taskId, attachmentId });
  return attachment;
}
