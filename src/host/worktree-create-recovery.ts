import { lstat, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { KanbanError } from '../shared/errors.js';
import type { GitPort, GitRepository } from '../shared/ports.js';
import type { ContextOperation, GitProject } from '../shared/types.js';
import { resolveCanonicalPath } from './path-resolution.js';
import { assertWorktreeTarget, containsPath } from './repository-layout.js';
import { CreateAttempt, retryModeFor, unverifiedAttempt } from './worktree-create-attempt.js';
import { CheckoutStateProbe, type CheckoutState } from './worktree-checkout-state.js';

/** What the coordinator must do before it invokes Git for a creation. */
export type CreateRoute =
  | { kind: 'adopt' }
  | { kind: 'create'; sourceCommit?: string; reuseBranch: boolean; branchTip?: string; clearAttempt: boolean; clearRegistration?: string }
  | { kind: 'incomplete'; state: CheckoutState }
  | { kind: 'reuse-blocked'; branchName: string; expected: string; actual: string };

export interface CreateRecoveryDependencies {
  git: Pick<GitPort, 'sourceCommit' | 'branchTip' | 'clearRegistration' | 'assertPolicy'>;
  checkout: CheckoutStateProbe;
  /** The configured worktree base path; the discard never removes it or anything above it. */
  basePath: () => string | undefined;
}

/**
 * Decides one creation's route from the attempt and the observed destination, and
 * performs the only filesystem removal the product does without Git: the discard of
 * an incomplete checkout, scoped to the attempt's canonical path and to the empty
 * directories below the configured base.
 */
export class CreateRecovery {
  constructor(private readonly dependencies: CreateRecoveryDependencies) {}

  /** The ancestors a discard may remove, deepest first, stopping before the base. */
  parentCandidates(target: string): string[] {
    const base = this.dependencies.basePath();
    if (base === undefined) return [];
    const canonicalBase = path.resolve(base);
    const candidates: string[] = [];
    let current = path.dirname(target);
    while (current !== canonicalBase && containsPath(canonicalBase, current)) {
      candidates.push(current);
      const next = path.dirname(current);
      if (next === current) break;
      current = next;
    }
    return candidates;
  }

  /** The destination as the host sees it now, including the parents a discard may remove. */
  observe(attempt: CreateAttempt, repository: GitRepository): Promise<CheckoutState> {
    return this.dependencies.checkout.probe(repository, attempt.path, this.parentCandidates(attempt.path));
  }

  /**
   * The route one pass takes. It reads only; the caller performs the effects the
   * route names, because clearing the attempt and the registration are journal and
   * Git writes the coordinator owns.
   */
  async decide(input: { operation: ContextOperation; project: GitProject; repository: GitRepository; sessionIds: string[]; allowBranchReuse?: boolean }): Promise<CreateRoute> {
    const { operation, project, repository, sessionIds, allowBranchReuse = false } = input;
    if (operation.request.kind !== 'create') throw unverifiedAttempt();
    const attempt = CreateAttempt.of(operation);
    if (attempt === undefined) {
      if (operation.gitCompleted) throw unverifiedAttempt();
      return this.fresh(operation, project, repository, sessionIds, allowBranchReuse);
    }
    await attempt.assertVerified(project);
    const state = await this.observe(attempt, repository);
    if (state.registration === 'registered') return { kind: 'adopt' };
    if (state.directory === 'present') return { kind: 'incomplete', state };
    // Nothing survived at the destination: the attempt disarms, and a leftover
    // registration for that exact path is cleared before the new attempt.
    const fresh = await this.fresh(operation, project, repository, sessionIds, allowBranchReuse);
    if (fresh.kind === 'create') return { ...fresh, clearAttempt: true, ...(state.registration === 'orphan' ? { clearRegistration: attempt.path } : {}) };
    return fresh;
  }

  /** The route a creation takes when no attempt is retained for it. */
  private async fresh(operation: ContextOperation, project: GitProject, repository: GitRepository, sessionIds: string[], allowBranchReuse: boolean): Promise<CreateRoute> {
    const request = operation.request;
    if (request.kind !== 'create') throw unverifiedAttempt();
    if (request.mode !== 'new') {
      // An existing branch is selected by name; the tip is what the checkout gets.
      const tip = await this.dependencies.git.branchTip(project, request.branchName, sessionIds, repository);
      return { kind: 'create', ...(tip === undefined ? {} : { sourceCommit: tip }), reuseBranch: false, clearAttempt: false };
    }
    const source = request.sourceBranch ?? project.defaultBranch ?? 'HEAD';
    // A recorded attempt proves the commit it would have checked out; a legacy record
    // resolves the same source once and the caller persists that answer.
    const attempt = CreateAttempt.of(operation);
    const sourceCommit = attempt === undefined
      ? await this.dependencies.git.sourceCommit(project, source, sessionIds, repository)
      : await attempt.sourceCommit(project, branch => this.dependencies.git.sourceCommit(project, branch, sessionIds, repository));
    const tip = allowBranchReuse ? await this.dependencies.git.branchTip(project, request.branchName, sessionIds, repository) : undefined;
    const mode = retryModeFor(tip, sourceCommit);
    if (mode === 'create') return { kind: 'create', sourceCommit, reuseBranch: false, clearAttempt: false };
    if (mode === 'reuse') return { kind: 'create', sourceCommit, reuseBranch: true, branchTip: tip, clearAttempt: false };
    return { kind: 'reuse-blocked', branchName: request.branchName, expected: sourceCommit, actual: tip! };
  }

  /**
   * Remove the incomplete checkout a creation left. The target must be the attempt's
   * canonical destination, must not be a registered worktree, and must not be the
   * configured base, the project, the Git root, or an ancestor of any of them.
   */
  async discard(input: { attempt: CreateAttempt; project: GitProject; repository: GitRepository; sessionIds: string[] }): Promise<string[]> {
    const { attempt, project, repository, sessionIds } = input;
    const target = await resolveCanonicalPath(attempt.path, true);
    if (target !== attempt.path) throw unverifiedAttempt();
    assertWorktreeTarget(repository, target);
    this.assertOutsideBase(target);
    const state = await this.observe(attempt, repository);
    if (state.registration === 'registered') throw new KanbanError('CREATE_CHECKOUT_REGISTERED', 'The destination is a registered worktree; remove it through the worktree removal flow instead.', { path: target });
    const removed = new Set<string>();
    if (state.directory !== 'absent') {
      const info = await lstat(target);
      if (!info.isDirectory()) throw new KanbanError('CREATE_CHECKOUT_INCOMPLETE', 'The destination is not a directory; it will not be removed.', { path: target });
      await this.dependencies.git.assertPolicy(project, [target], sessionIds, true);
      // Re-read the registration immediately before the removal: a concurrent
      // external creation into the same path must win over our discard.
      repository.invalidate();
      const current = (await repository.registered()).find(item => item.path === target);
      if (current !== undefined && !current.prunable) throw new KanbanError('CREATE_CHECKOUT_REGISTERED', 'The destination became a registered worktree; it will not be removed.', { path: target });
      await rm(target, { recursive: true, force: true });
      removed.add(target);
    }
    if (state.registration === 'orphan') await this.dependencies.git.clearRegistration(project, target, sessionIds, repository);
    for (const parent of this.parentCandidates(target)) {
      try { await rmdir(parent); removed.add(parent); } catch { break; }
    }
    repository.invalidate();
    return [...removed];
  }

  /** The configured base and its ancestors are the user's directories, never a discard target. */
  private assertOutsideBase(target: string): void {
    const base = this.dependencies.basePath();
    if (base === undefined) return;
    const canonicalBase = path.resolve(base);
    if (target === canonicalBase || containsPath(target, canonicalBase)) {
      throw new KanbanError('UNSAFE_WORKTREE_TARGET', 'The discard target is the configured worktree base or one of its ancestors.', { path: target, basePath: canonicalBase });
    }
  }
}
