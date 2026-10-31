import { agentOrdinal, type ConversationScope } from '../shared/conversations.js';

/** Native session title access and the rename operation exposed by the host. */
export interface SessionTitles {
  title(sessionId: string): string | undefined;
  rename(sessionId: string, title: string): Promise<void>;
}

/** The title read alone, for surfaces that never rename. */
export type SessionTitleSource = Pick<SessionTitles, 'title'>;

/** Native title first, then the task-order `Agent N` fallback. */
export function conversationLabel(scope: ConversationScope, sessionId: string, titles?: SessionTitleSource): string {
  return titles?.title(sessionId)?.trim() || 'Agent ' + agentOrdinal(scope, sessionId);
}
