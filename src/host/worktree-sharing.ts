import { lstat } from 'node:fs/promises';
import { ownedSessionIds } from '../domain/session-lineage.js';
import { KanbanError } from '../shared/errors.js';
import type { SessionTopologyPort } from '../shared/ports.js';
import type { BoardState, Task } from '../shared/types.js';
import { canonicalPath, containsPath } from './git.js';

export interface WorktreeOwnershipStore {
  snapshot(): BoardState;
}

function requireTask(state: BoardState, id: string): Task {
  const task = state.tasks.find(item => item.id === id);
  if (!task) throw new KanbanError('TASK_NOT_FOUND', 'The task does not exist.', { taskId: id });
  return task;
}

async function exists(value: string): Promise<boolean> {
  try { await lstat(value); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

/**
 * Protects destructive worktree cleanup from targets used outside the task's
 * own conversation lineage. A task owns its retained conversations and their
 * native subagent descendants; forks and unrelated sessions stay foreign.
 */
export class WorktreeSharingGuard {
  constructor(
    private readonly store: WorktreeOwnershipStore,
    private readonly sessions: SessionTopologyPort,
  ) {}

  async assertExclusive(taskId: string, target: string): Promise<void> {
    const canonical = await canonicalPath(target, true);
    // An absent checkout cannot be in use; the Git removal path handles the
    // registration without substituting a base project or Git root.
    if (!await exists(canonical)) return;

    const state = this.store.snapshot();
    const task = requireTask(state, taskId);
    for (const other of state.tasks) {
      if (other.id === taskId || !other.worktree) continue;
      const otherPath = await canonicalPath(other.worktree.path, true);
      if (containsPath(canonical, otherPath) || containsPath(otherPath, canonical)) {
        throw new KanbanError(
          'SHARED_WORKTREE',
          'Another task, "' + other.title + '", is associated with this checkout.',
          { taskId: other.id, taskTitle: other.title, path: canonical },
        );
      }
    }

    const topology = await this.sessions.topology(canonical);
    const owned = ownedSessionIds(task.sessionIds, topology.lineage);
    for (const session of topology.related) {
      if (owned.has(session.sessionId)) continue;
      const current = await canonicalPath(session.directory, true);
      if (!containsPath(canonical, current)) continue;
      throw new KanbanError(
        'SHARED_WORKTREE',
        'Another DSH conversation is using this checkout.',
        { sessionId: session.sessionId, path: canonical },
      );
    }
  }
}
