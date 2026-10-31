/** The conversation fields every task-like record shares. */
export interface ConversationScope {
  readonly sessionIds: readonly string[];
  readonly closedSessionIds: readonly string[];
}

/** Conversation sessions that still own a tab, in task order. */
export function openSessionIds(scope: ConversationScope): string[] {
  return scope.sessionIds.filter(id => !scope.closedSessionIds.includes(id));
}

/** Closed conversation sessions in their recorded close order. */
export function closedSessionIds(scope: ConversationScope): string[] {
  return scope.closedSessionIds.filter(id => scope.sessionIds.includes(id));
}

/** The first conversation that can receive work, or `undefined` when every tab is closed. */
export function firstOpenSessionId(scope: ConversationScope): string | undefined {
  return scope.sessionIds.find(id => !scope.closedSessionIds.includes(id));
}

/** One-based position used by the `Agent N` fallback label. */
export function agentOrdinal(scope: ConversationScope, sessionId: string): number {
  return scope.sessionIds.indexOf(sessionId) + 1;
}
