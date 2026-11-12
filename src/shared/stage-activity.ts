/** The persisted task facts that make a stage rename wait for the board to go idle. */
export interface StageActivityFacts {
  deterministic?: { phase: string };
  pendingTransition?: { status: string };
  autoMode?: { enabled: boolean };
  instructionPending?: { columnId: string };
  operation?: unknown;
  worktree?: { status: string } | null;
}

/**
 * The persisted reasons one task counts as in-flight work. A running conversation
 * is session state, so the caller folds it in on top of these.
 */
export function persistedStageActivity(facts: StageActivityFacts): string[] {
  const reasons: string[] = [];
  if (facts.deterministic !== undefined && !['stopped', 'failed'].includes(facts.deterministic.phase)) reasons.push('a deterministic execution');
  if (facts.pendingTransition !== undefined) reasons.push('a pending transition');
  if (facts.autoMode?.enabled === true) reasons.push('auto mode is armed');
  if (facts.instructionPending !== undefined) reasons.push('an unresolved stage instruction');
  if (facts.operation !== undefined && facts.operation !== null) reasons.push('an operation in progress');
  if (facts.worktree?.status === 'preparing') reasons.push('a worktree being prepared');
  if (facts.worktree?.status === 'error') reasons.push('a worktree in error');
  return reasons;
}

/** The conversation facts one task needs for a rename; the card and host both have them. */
export interface StageConversationFacts { running: boolean; background?: readonly unknown[] }

/** The reason a conversation makes a task busy, or none. */
export function conversationStageActivity(facts: StageConversationFacts | undefined): string[] {
  if (facts === undefined) return [];
  return facts.running || (facts.background?.length ?? 0) > 0 ? ['a running conversation'] : [];
}

/** True when the collected reasons block a stage rename. */
export function hasInFlightWork(reasons: readonly string[]): boolean {
  return reasons.length > 0;
}

/** One sentence naming why the board cannot rename a stage right now. */
export function describeStageActivity(reasons: readonly string[]): string {
  const unique = [...new Set(reasons)];
  return unique.join(', ');
}
