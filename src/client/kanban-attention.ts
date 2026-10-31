import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client';
import type { Attention, ConversationFacts, HostSnapshot } from '../shared/types.js';
import { EMPTY_CONVERSATION_FACTS } from '../shared/types.js';
import { aggregateTaskAttention, projectConversation } from './attention-projection.js';
import { allTasks } from './hub-view.js';

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
  host: Pick<HostSnapshot, 'state' | 'conversations'>,
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

/** Tracks whether any conversation started running since the previous status snapshot. */
export class RunningSessions {
  private readonly sessions = new Set<string>();

  /** @returns whether any conversation transitioned into running. */
  sync(statuses: SessionStatusSnapshot): boolean {
    let rising = false;
    const seen = new Set<string>();
    for (const [id, status] of statuses) {
      const key = String(id);
      seen.add(key);
      if (status.running === true) {
        if (!this.sessions.has(key)) rising = true;
        this.sessions.add(key);
      }
    }
    for (const id of [...this.sessions]) if (!seen.has(id)) this.sessions.delete(id);
    return rising;
  }
}
