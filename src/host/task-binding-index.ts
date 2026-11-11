import type { WorktreeBinding } from './hub-repository.js';
import { canonicalPath, containsPath } from './git.js';
import type { SharedWorktreeBlocker } from '../shared/worktree-blockers.js';

export type { WorktreeBinding };

/** The lightweight binding read the index answers over. */
export interface BindingSource {
  worktreeBindings(): readonly WorktreeBinding[];
}

/** One other task holding an unsettled context operation that touches a checkout. */
export interface ActiveCheckoutOperation {
  readonly taskId: string;
  readonly title: string;
  readonly path: string;
}

type Canonicalize = (value: string) => Promise<string>;

/**
 * Answers the three binding questions a destructive path asks — which other task
 * binds a checkout, which other task is operating under it, and which paths are
 * already reserved — from the repository's binding projection instead of cloning
 * Hubs. It never caches native session state: the sharing refusal must be decided
 * from what the host reports at the moment it runs.
 */
export class TaskBindingIndex {
  constructor(
    private readonly source: BindingSource,
    private readonly canonical: Canonicalize = value => canonicalPath(value, true),
  ) {}

  all(): readonly WorktreeBinding[] {
    return this.source.worktreeBindings();
  }

  /** Every path a task already reserves, for collision-free name derivation. */
  occupied(): ReadonlySet<string> {
    const occupied = new Set<string>();
    for (const binding of this.all()) {
      if (binding.worktreePath) occupied.add(binding.worktreePath);
      for (const path of binding.unclaimedWorktreePaths) occupied.add(path);
      if (binding.operationAttemptPath) occupied.add(binding.operationAttemptPath);
      if (binding.pendingWorktreePath) occupied.add(binding.pendingWorktreePath);
    }
    return occupied;
  }

  /** Other tasks whose binding resolves onto the same checkout, in either direction. */
  async blockingTasks(taskId: string, target: string): Promise<SharedWorktreeBlocker[]> {
    const blockers: SharedWorktreeBlocker[] = [];
    for (const binding of this.all()) {
      if (binding.taskId === taskId || binding.worktreePath === null) continue;
      const other = await this.canonicalOrNull(binding.worktreePath);
      if (other === null) continue;
      if (containsPath(target, other) || containsPath(other, target)) {
        blockers.push({ kind: 'task', taskId: binding.taskId, title: binding.title, path: other });
      }
    }
    return blockers;
  }

  /** Another task's unsettled operation whose target covers the same checkout. */
  async activeOperations(value: string, exceptTaskId: string): Promise<ActiveCheckoutOperation[]> {
    const target = await this.canonicalOrNull(value) ?? value;
    const active: ActiveCheckoutOperation[] = [];
    for (const binding of this.all()) {
      if (binding.taskId === exceptTaskId) continue;
      const operation = binding.operation;
      if (!operation || operation.phase === 'failed') continue;
      const candidates = [operation.targetPath, binding.worktreePath, operation.requestPath];
      for (const candidate of candidates) {
        if (!candidate) continue;
        const resolved = await this.canonicalOrNull(candidate);
        if (resolved === null) continue;
        if (containsPath(target, resolved) || containsPath(resolved, target)) {
          active.push({ taskId: binding.taskId, title: binding.title, path: target });
          break;
        }
      }
    }
    return active;
  }

  /** The binding for one task, when the projection still has it. */
  forTask(taskId: string): WorktreeBinding | undefined {
    return this.all().find(binding => binding.taskId === taskId);
  }

  private async canonicalOrNull(value: string): Promise<string | null> {
    try { return await this.canonical(value); }
    catch { return null; }
  }
}
