import type { HeldMessage, Task } from '../shared/types.js';

/** The most held messages one task keeps; a further write is refused instead of evicting one. */
export const HELD_MESSAGE_LIMIT = 32;
/** How many released identities a task remembers, so a replay never requeues a delivered message. */
export const RELEASED_MESSAGE_LIMIT = 64;

/** Delivery identity: one tool call from one sending conversation. */
export function heldMessageIdentity(senderSessionId: string, callId: string): string {
  return 'held:' + senderSessionId + ':' + callId;
}

/**
 * Add one held message to a task, at most once per identity. Returns whether the
 * record changed, so a repeated call is harmless and reports no new message.
 */
export function addHeldMessage(task: Pick<Task, 'heldMessages' | 'releasedMessages'>, message: HeldMessage): boolean {
  // A message already delivered for this identity is never queued again, and a full
  // queue is refused rather than silently dropping the message that arrived first.
  if (wasReleased(task, message.id)) return false;
  const current = task.heldMessages ?? [];
  if (current.some(entry => entry.id === message.id)) return false;
  if (current.length >= HELD_MESSAGE_LIMIT) return false;
  task.heldMessages = [...current, message];
  return true;
}

/** Whether one held message was already released and delivered. */
export function wasReleased(task: Pick<Task, 'releasedMessages'>, id: string): boolean {
  return (task.releasedMessages ?? []).includes(id);
}

/** Keep one released identity, bounded, so its replay is a no-op instead of a requeue. */
export function recordReleased(task: Pick<Task, 'releasedMessages'>, id: string): void {
  const current = task.releasedMessages ?? [];
  if (current.includes(id)) return;
  task.releasedMessages = [...current, id].slice(-RELEASED_MESSAGE_LIMIT);
}

/** The messages waiting for one stage, in arrival order. */
export function heldMessagesFor(task: Pick<Task, 'heldMessages'>, columnId: string): HeldMessage[] {
  return (task.heldMessages ?? []).filter(message => message.columnId === columnId);
}

/** Drop one released or discarded message; returns whether it was held. */
export function takeHeldMessage(task: Pick<Task, 'heldMessages'>, id: string): HeldMessage | undefined {
  const current = task.heldMessages ?? [];
  const found = current.find(message => message.id === id);
  if (found === undefined) return undefined;
  const remaining = current.filter(message => message.id !== id);
  if (remaining.length === 0) delete task.heldMessages;
  else task.heldMessages = remaining;
  return found;
}

/** Drop every message a workflow edit or a task lifecycle made undeliverable. */
export function dropHeldMessages(task: Pick<Task, 'heldMessages'>, predicate: (message: HeldMessage) => boolean): HeldMessage[] {
  const dropped = (task.heldMessages ?? []).filter(predicate);
  if (dropped.length > 0) {
    const kept = (task.heldMessages ?? []).filter(message => !predicate(message));
    if (kept.length === 0) delete task.heldMessages;
    else task.heldMessages = kept;
  }
  return dropped;
}
