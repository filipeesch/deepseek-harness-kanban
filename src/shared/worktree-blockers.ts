import type { Problem } from './types.js';

/** One party that blocks destructive cleanup of a checkout. */
export type SharedWorktreeBlocker =
  | { kind: 'task'; taskId: string; title: string; path: string }
  | { kind: 'session'; sessionId: string; path: string };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function fromList(value: unknown): SharedWorktreeBlocker[] {
  if (!Array.isArray(value)) return [];
  const blockers: SharedWorktreeBlocker[] = [];
  for (const item of value) {
    if (!record(item)) continue;
    const path = text(item.path) ?? '';
    if (item.kind === 'task') {
      const taskId = text(item.taskId);
      if (taskId) blockers.push({ kind: 'task', taskId, title: text(item.title) ?? taskId, path });
    } else if (item.kind === 'session') {
      const sessionId = text(item.sessionId);
      if (sessionId) blockers.push({ kind: 'session', sessionId, path });
    }
  }
  return blockers;
}

/**
 * Reads every sharing blocker from a `SHARED_WORKTREE` problem. Operations
 * recorded before blockers were collected carry only the legacy single
 * `taskId` or `sessionId` detail, which stays readable as one blocker.
 */
export function sharedWorktreeBlockers(problem: Problem | null | undefined): SharedWorktreeBlocker[] {
  if (!problem || problem.code !== 'SHARED_WORKTREE' || !problem.details) return [];
  const blockers = fromList(problem.details.blockers);
  if (blockers.length > 0) return dedupe(blockers);
  const path = text(problem.details.path) ?? '';
  const sessionId = text(problem.details.sessionId);
  if (sessionId) return [{ kind: 'session', sessionId, path }];
  const taskId = text(problem.details.taskId);
  if (taskId) return [{ kind: 'task', taskId, title: text(problem.details.taskTitle) ?? taskId, path }];
  return [];
}

function dedupe(blockers: SharedWorktreeBlocker[]): SharedWorktreeBlocker[] {
  const seen = new Set<string>();
  return blockers.filter(blocker => {
    const key = blocker.kind + ':' + (blocker.kind === 'task' ? blocker.taskId : blocker.sessionId);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** True when a failed operation can offer the consented force action. */
export function canForceSharedRemoval(problem: Problem | null | undefined): boolean {
  return problem?.code === 'SHARED_WORKTREE';
}
