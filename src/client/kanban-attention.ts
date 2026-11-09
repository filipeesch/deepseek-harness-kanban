import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client';
import type { Attention, ConversationFacts, FullHostSnapshot } from '../shared/types.js';
import { EMPTY_CONVERSATION_FACTS } from '../shared/types.js';
import { samePendingUserWork } from '../domain/pending-user-work.js';
import { aggregateTaskAttention, projectConversation } from './attention-projection.js';
import { allTasks } from './snapshot-normalize.js';

/** Conversation-level and task-level attention derived from one Host snapshot. */
export interface TaskAttentionProjection {
  readonly attention: Record<string, Attention>;
  readonly conversationAttention: Record<string, Attention>;
}

/**
 * Project each task conversation's durable facts with the client-owned read
 * acknowledgment and aggregate them per task.
 */
export function projectTaskAttention(
  host: Pick<FullHostSnapshot, 'state' | 'conversations'>,
  statuses: SessionStatusSnapshot,
  acknowledged: (sessionId: string) => number | undefined,
): TaskAttentionProjection {
  const tasks = allTasks(host);
  const conversationAttention: Record<string, Attention> = {};
  for (const task of tasks) {
    for (const sessionId of task.sessionIds) {
      if (conversationAttention[sessionId]) continue;
      const facts: ConversationFacts = host.conversations[sessionId] ?? EMPTY_CONVERSATION_FACTS;
      conversationAttention[sessionId] = projectConversation(facts, statuses.get(sessionId as SessionId), acknowledged(sessionId));
    }
  }
  const attention: Record<string, Attention> = {};
  for (const task of tasks) {
    attention[task.id] = aggregateTaskAttention(task.sessionIds.flatMap(sessionId => conversationAttention[sessionId] ? [conversationAttention[sessionId]!] : []));
  }
  return { attention, conversationAttention };
}

/** Whether two presented attention values are indistinguishable to every surface. */
export function sameAttention(left: Attention, right: Attention): boolean {
  if (left === right) return true;
  if (left.running !== right.running || left.unread !== right.unread || left.awaitingReply !== right.awaitingReply || left.failed !== right.failed) return false;
  if (!samePendingUserWork(left.pending, right.pending)) return false;
  if (left.background.length !== right.background.length) return false;
  for (let index = 0; index < left.background.length; index += 1) {
    if (left.background[index]!.kind !== right.background[index]!.kind || left.background[index]!.label !== right.background[index]!.label) return false;
  }
  return true;
}

/**
 * Projects task attention while keeping each unchanged task's and conversation's object
 * identity. Memoized cards compare that identity, so an attention-only publication only
 * re-renders the cards whose presentation actually changed.
 */
export class AttentionProjector {
  private attention: Record<string, Attention> = {};
  private conversationAttention: Record<string, Attention> = {};

  project(
    host: Pick<FullHostSnapshot, 'state' | 'conversations'>,
    statuses: SessionStatusSnapshot,
    acknowledged: (sessionId: string) => number | undefined,
  ): TaskAttentionProjection {
    const fresh = projectTaskAttention(host, statuses, acknowledged);
    this.conversationAttention = reuse(this.conversationAttention, fresh.conversationAttention);
    this.attention = reuse(this.attention, fresh.attention);
    return { attention: this.attention, conversationAttention: this.conversationAttention };
  }
}

/** Keep the previous object for every key whose value did not change. */
function reuse(previous: Record<string, Attention>, next: Record<string, Attention>): Record<string, Attention> {
  const result: Record<string, Attention> = {};
  for (const [key, value] of Object.entries(next)) {
    const before = previous[key];
    result[key] = before !== undefined && sameAttention(before, value) ? before : value;
  }
  return result;
}

/** Tracks which conversations started running since the previous status snapshot. */
export class RunningSessions {
  private readonly sessions = new Set<string>();

  /** @returns the conversations that transitioned into running. */
  sync(statuses: SessionStatusSnapshot): string[] {
    const rising: string[] = [];
    const seen = new Set<string>();
    for (const [id, status] of statuses) {
      const key = String(id);
      seen.add(key);
      if (status.running === true) {
        if (!this.sessions.has(key)) rising.push(key);
        this.sessions.add(key);
      }
    }
    for (const id of [...this.sessions]) if (!seen.has(id)) this.sessions.delete(id);
    return rising;
  }
}
