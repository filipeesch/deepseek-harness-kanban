import { KanbanError } from '../shared/errors.js';
import type { GitExecutor, GitRepository, GitTree } from '../shared/ports.js';
import type { CreateWorktree } from '../shared/types.js';
import { createRepositoryCommands, type RepositoryCommands } from './git-repository.js';
import { resolveCanonicalPath } from './path-resolution.js';
import { entryExists } from './paths.js';
import { assertWorktreeTarget } from './repository-layout.js';
import { WorktreeReader } from './worktree-reader.js';

function supportedBranchName(value: string): boolean {
  return value !== 'HEAD' && value !== '@' && !value.startsWith('-') && !value.startsWith('refs/');
}

function validBranchName(value: string): boolean {
  return Boolean(value) && supportedBranchName(value) && !value.startsWith('-') && !/[\0\r\n]/.test(value);
}

/**
 * Every Git write an operation needs, over the repository context it resolved
 * once. Each write invalidates the context's registration, so the next read sees
 * the repository as Git left it.
 */
export class WorktreeWriter {
  private readonly reader: WorktreeReader;

  constructor(private readonly executor: GitExecutor) {
    this.reader = new WorktreeReader(executor);
  }

  private commands(repo: GitRepository, sessionIds: string[]): RepositoryCommands {
    return createRepositoryCommands({ executor: this.executor, project: repo.project, sessionIds });
  }

  /**
   * Create the checkout. The caller may pass the commit it already persisted as the
   * attempt's proof, so the write checks out exactly what was proven rather than
   * resolving the source a second time.
   */
  async create(repo: GitRepository, request: CreateWorktree, sessionIds: string[], signal?: AbortSignal, options: { sourceCommit?: string; beforeWrite?: () => void } = {}): Promise<GitTree> {
    const commands = this.commands(repo, sessionIds);
    const target = await resolveCanonicalPath(request.path, true);
    assertWorktreeTarget(repo, target);
    if (!validBranchName(request.branchName)) throw new KanbanError('INVALID_BRANCH', 'A valid branch name is required.');
    await commands.run(['-C', repo.root, 'check-ref-format', 'refs/heads/' + request.branchName], { signal });
    await this.requireLocalBranch(repo, commands, request, signal);
    await this.executor.assertPolicy(repo.project, [repo.commonDirectory, target], sessionIds, true);
    if (request.mode === 'new') {
      const source = request.sourceBranch ?? repo.project.defaultBranch ?? 'HEAD';
      if (!source || /[\0\r\n]/.test(source)) throw new KanbanError('INVALID_BRANCH', 'A valid source branch is required.');
      const commit = options.sourceCommit ?? (await commands.run(['-C', repo.root, 'rev-parse', '--verify', '--end-of-options', source + '^{commit}'], { signal })).trim();
      options.beforeWrite?.();
      await commands.run(['-C', repo.root, 'worktree', 'add', '-b', request.branchName, '--', target, commit], { signal, write: true, deadline: 'write' });
    } else {
      options.beforeWrite?.();
      await commands.run(['-C', repo.root, 'worktree', 'add', '--', target, request.branchName], { signal, write: true, deadline: 'write' });
    }
    repo.invalidate();
    // The add command created exactly this checkout; its branch is the only fact
    // worth reading back, and a fresh checkout has no local changes.
    const branch = await this.reader.branch(commands, target, signal);
    return { path: target, branch, dirty: false, commonDirectory: repo.commonDirectory };
  }

  /** Clear one registration whose directory is gone, targeting that exact path only. */
  async clearRegistration(repo: GitRepository, value: string, sessionIds: string[], signal?: AbortSignal): Promise<void> {
    const commands = this.commands(repo, sessionIds);
    const target = await resolveCanonicalPath(value, true);
    assertWorktreeTarget(repo, target);
    await this.executor.assertPolicy(repo.project, [repo.commonDirectory], sessionIds, true);
    await commands.run(['-C', repo.root, 'worktree', 'remove', '--', target], { signal, write: true, deadline: 'write' });
    repo.invalidate();
  }

  /** Existing-branch creation refuses a branch that is not local, before any write. */
  private async requireLocalBranch(repo: GitRepository, commands: RepositoryCommands, request: CreateWorktree, signal?: AbortSignal): Promise<void> {
    if (request.mode !== 'existing') return;
    try {
      await commands.run(['-C', repo.root, 'show-ref', '--verify', '--quiet', 'refs/heads/' + request.branchName], { signal });
    } catch (error) {
      if (error instanceof KanbanError && error.code === 'GIT_FAILED' && error.details?.exitCode === 1) throw new KanbanError('LOCAL_BRANCH_REQUIRED', 'Existing-branch mode requires an existing local branch; remote refs are only valid as a new branch source.', { branchName: request.branchName });
      throw error;
    }
    await commands.run(['-C', repo.root, 'rev-parse', '--verify', '--end-of-options', 'refs/heads/' + request.branchName + '^{commit}'], { signal });
  }

  /**
   * The refusals a removal must decide before anything else is mutated. An absent
   * checkout is tolerated: it counts as already removed.
   */
  async assertRemovable(repo: GitRepository, value: string, sessionIds: string[]): Promise<void> {
    const target = await resolveCanonicalPath(value, true);
    assertWorktreeTarget(repo, target);
    const entry = await this.reader.registered(repo, target);
    const present = await entryExists(target);
    if (!entry) {
      // An interrupted, already-completed removal is safe to retry.
      if (!present) return;
      throw new KanbanError('WORKTREE_NOT_REGISTERED', 'Refusing to remove a directory that is not a registered worktree.', { path: target });
    }
    if (entry.locked) throw new KanbanError('WORKTREE_LOCKED', 'The worktree is locked; resolve its Git lock before removal.', { path: target });
  }

  async remove(repo: GitRepository, value: string, discardChanges: boolean, sessionIds: string[], signal?: AbortSignal, options: { verifiedClean?: boolean } = {}): Promise<void> {
    const commands = this.commands(repo, sessionIds);
    const target = await resolveCanonicalPath(value, true);
    await this.assertRemovable(repo, target, sessionIds);
    // assertRemovable threw for every refusal, so a still-absent registration means
    // an interrupted removal that already completed.
    if (!await this.reader.registered(repo, target)) return;
    const present = await entryExists(target);
    // Discard consent already decides the outcome, so the local-change scan is
    // only read when it can still refuse the removal.
    // A caller that already read the working tree in this execution does not pay
    // for a second scan; Git still refuses a dirty tree without --force.
    if (present && !discardChanges && options.verifiedClean !== true && await this.reader.localChanges(repo, target, sessionIds, signal)) {
      throw new KanbanError('DISCARD_REQUIRED', 'Explicit confirmation is required to discard local worktree changes.', { path: target });
    }
    await this.executor.assertPolicy(repo.project, [repo.commonDirectory, target], sessionIds, true);
    const args = ['-C', repo.root, 'worktree', 'remove'];
    if (discardChanges) args.push('--force');
    args.push('--', target);
    await commands.run(args, { signal, write: true, deadline: 'write' });
    repo.invalidate();
    if (await entryExists(target)) throw new KanbanError('WORKTREE_REMOVE_INCOMPLETE', 'Git reported removal but the worktree directory still exists.', { path: target });
  }

  async repair(repo: GitRepository, worktreePaths: string[], sessionIds: string[], signal?: AbortSignal): Promise<void> {
    const commands = this.commands(repo, sessionIds);
    const existing: string[] = [];
    for (const value of worktreePaths) {
      const target = await resolveCanonicalPath(value, true);
      if (await entryExists(target)) existing.push(target);
    }
    // A checkout that no longer exists cannot be repaired; its binding records the error instead.
    if (existing.length === 0) return;
    await this.executor.assertPolicy(repo.project, [repo.commonDirectory, ...existing], sessionIds, true);
    await commands.run(['-C', repo.root, 'worktree', 'repair', ...existing], { signal, write: true, deadline: 'write' });
    repo.invalidate();
  }
}

