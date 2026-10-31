import { lstat } from 'node:fs/promises';
import { ownedSessionIds } from '../domain/session-lineage.js';
import { KanbanError } from '../shared/errors.js';
import type { SessionTopologyPort } from '../shared/ports.js';
import type { Task } from '../shared/types.js';
import type { SharedWorktreeBlocker } from '../shared/worktree-blockers.js';
import { canonicalPath, containsPath } from './git.js';

export interface WorktreeOwnershipStore {
  locate(taskId: string): { task: Task };
  allTasks(): Task[];
}

export interface WorktreeSharingOptions {
  /** The user explicitly consented to removing a shared checkout. */
  force?: boolean;
}

async function exists(value: string): Promise<boolean> {
  try { await lstat(value); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

/**
 * Protects destructive worktree cleanup from targets used outside the task's
 * own conversation lineage. A task owns its retained conversations and their
 * native subagent descendants; forks and unrelated sessions stay foreign.
 * Every blocker is collected so a force consent can show the whole blast radius.
 */
export class WorktreeSharingGuard {
  constructor(
    private readonly store: WorktreeOwnershipStore,
    private readonly sessions: SessionTopologyPort,
  ) {}

  async assertExclusive(taskId: string, target: string, options: WorktreeSharingOptions = {}): Promise<void> {
    const canonical = await canonicalPath(target, true);
    // An absent checkout cannot be in use; the Git removal path handles the
    // registration without substituting a base project or Git root.
    if (!await exists(canonical)) return;
    // Force is an explicit, recorded consent; it skips the sharing refusal only.
    if (options.force === true) return;

    const task = this.store.locate(taskId).task;
    const blockers: SharedWorktreeBlocker[] = [];
    for (const other of this.store.allTasks()) {
      if (other.id === taskId || !other.worktree) continue;
      const otherPath = await canonicalPath(other.worktree.path, true);
      if (containsPath(canonical, otherPath) || containsPath(otherPath, canonical)) {
        blockers.push({ kind: 'task', taskId: other.id, title: other.title, path: otherPath });
      }
    }

    const topology = await this.sessions.topology(canonical);
    const owned = ownedSessionIds(task.sessionIds, topology.lineage);
    for (const session of topology.related) {
      if (owned.has(session.sessionId)) continue;
      const current = await canonicalPath(session.directory, true);
      if (!containsPath(canonical, current)) continue;
      blockers.push({ kind: 'session', sessionId: session.sessionId, path: current });
    }

    if (blockers.length === 0) return;
    const firstTask = blockers.find(blocker => blocker.kind === 'task');
    const firstSession = blockers.find(blocker => blocker.kind === 'session');
    throw new KanbanError(
      'SHARED_WORKTREE',
      firstTask ? 'Another task, "' + firstTask.title + '", is associated with this checkout.' : 'Another DSH conversation is using this checkout.',
      {
        path: canonical,
        blockers,
        ...(firstTask ? { taskId: firstTask.taskId, taskTitle: firstTask.title } : {}),
        ...(firstSession ? { sessionId: firstSession.sessionId } : {}),
      },
    );
  }
}
