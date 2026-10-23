import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { Attention } from '../shared/types.js';
import { EMPTY_ATTENTION } from '../shared/types.js';

interface Reminder { epoch: number; acknowledged: number; running: boolean; unread: boolean; viewers: number }

function reminder(): Reminder {
  return { epoch: 0, acknowledged: -1, running: false, unread: false, viewers: 0 };
}

/**
 * Client-owned completion reminders. The native status snapshot owns the transitions;
 * this tracker decides whether the current completion still needs acknowledgement.
 */
export class ReminderTracker {
  private readonly reminders = new Map<string, Reminder>();

  /** Reconcile the reminder epochs with the native status snapshot. */
  sync(statuses: SessionStatusSnapshot): void {
    for (const [id, reminder] of this.reminders) if (!statuses.has(id as SessionId)) { reminder.running = false; reminder.unread = false; }
    for (const [id, status] of statuses) {
      let current = this.reminders.get(id);
      if (!current) { current = reminder(); this.reminders.set(id, current); }
      // A new run resets a prior local read even when the host's old unread boolean remains true.
      if ((!current.running && status.running === true) || (!current.unread && status.completionUnread)) current.epoch++;
      current.running = status.running === true;
      current.unread = status.completionUnread;
      if (current.viewers > 0) current.acknowledged = current.epoch;
    }
  }

  /** Acknowledge the actually mounted or read conversation; returns the idempotent release. */
  view(id: string): () => void {
    let current = this.reminders.get(id);
    if (!current) { current = reminder(); this.reminders.set(id, current); }
    current.viewers++; current.acknowledged = current.epoch;
    let active = true;
    return () => { if (!active) return; active = false; current!.viewers = Math.max(0, current!.viewers - 1); };
  }

  /** Whether the current completion is still unread for this conversation. */
  isUnread(id: string): boolean {
    const current = this.reminders.get(id);
    return current ? current.unread && current.acknowledged !== current.epoch : true;
  }
}

/**
 * Combine the host-owned attention facts with the client-owned unread and pending-interaction
 * facts. Turn execution and background activity come only from the host.
 */
export function projectTaskAttention(
  host: Attention | undefined,
  statuses: SessionStatusSnapshot,
  reminders: ReminderTracker,
  sessionIds: readonly string[],
): Attention {
  const base = host ?? EMPTY_ATTENTION;
  const value: Attention = { ...base, background: [...base.background] };
  for (const id of sessionIds) {
    const status = statuses.get(id as SessionId);
    if (!status) continue;
    value.awaitingReply ||= status.pendingInteraction !== undefined;
    value.unread ||= status.completionUnread && reminders.isUnread(id);
  }
  return value;
}
