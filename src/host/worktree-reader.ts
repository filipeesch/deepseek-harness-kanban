import { KanbanError } from '../shared/errors.js';
import type { GitExecutor, GitRepository, GitTree } from '../shared/ports.js';
import { createRepositoryCommands, identifyCheckout, type RepositoryCommands } from './git-repository.js';
import { requireDirectory } from './path-resolution.js';
import { assertWorktreeTarget } from './repository-layout.js';

function supportedBranchName(value: string): boolean {
  return value !== 'HEAD' && value !== '@' && !value.startsWith('-') && !value.startsWith('refs/');
}

/**
 * Every Git read an operation needs, over the repository context it resolved
 * once. A checkout is identified by the working-tree root and common directory
 * Git reports for it, never by comparing branch names.
 */
export class WorktreeReader {
  constructor(private readonly executor: GitExecutor) {}

  private commands(repo: GitRepository, sessionIds: string[]): RepositoryCommands {
    return createRepositoryCommands({ executor: this.executor, project: repo.project, sessionIds });
  }

  async inspect(repo: GitRepository, value: string, sessionIds: string[], signal?: AbortSignal): Promise<GitTree> {
    const commands = this.commands(repo, sessionIds);
    const target = await requireDirectory(value);
    assertWorktreeTarget(repo, target);
    await this.executor.assertPolicy(repo.project, [target], sessionIds, false);
    const identity = await identifyCheckout(commands, target, signal);
    if (identity.root !== target) throw new KanbanError('WORKTREE_ROOT_REQUIRED', 'Select the worktree root, not one of its subdirectories.', { path: target, root: identity.root });
    if (identity.commonDirectory !== repo.commonDirectory) throw new KanbanError('REPOSITORY_MISMATCH', 'The selected worktree belongs to a different Git repository.', { path: target });
    if (!await this.registered(repo, target)) throw new KanbanError('WORKTREE_NOT_REGISTERED', 'The selected checkout is not a registered worktree of this repository.', { path: target });
    const branch = await this.branch(commands, target, signal);
    const dirty = await this.isDirty(commands, target, signal);
    return { path: target, branch, dirty, commonDirectory: repo.commonDirectory };
  }

  /** The checkout's current branch, read in one invocation. */
  async branch(commands: RepositoryCommands, target: string, signal?: AbortSignal): Promise<string> {
    return (await commands.run(['-C', target, 'branch', '--show-current'], { signal })).trim() || 'HEAD';
  }

  /** Whether the checkout has tracked or untracked local changes. */
  async isDirty(commands: RepositoryCommands, target: string, signal?: AbortSignal): Promise<boolean> {
    const output = await commands.run(['-C', target, 'status', '--porcelain=v1', '--untracked-files=all', '-z'], { signal });
    return output.length > 0;
  }

  /** The one local-change read, used when the registration is already proven. */
  async localChanges(repo: GitRepository, target: string, sessionIds: string[], signal?: AbortSignal): Promise<boolean> {
    const commands = this.commands(repo, sessionIds);
    await this.executor.assertPolicy(repo.project, [target], sessionIds, false);
    return this.isDirty(commands, target, signal);
  }

  async branches(repo: GitRepository, sessionIds: string[], signal?: AbortSignal): Promise<string[]> {
    const output = await this.commands(repo, sessionIds).run(['-C', repo.root, 'for-each-ref', '--format=%(refname:strip=2)', 'refs/heads'], { signal });
    return [...new Set(output.split('\n').map(value => value.trim()).filter(value => value && supportedBranchName(value)))].sort();
  }

  /** The registration entry for one target, or undefined when this repository does not register it. */
  async registered(repo: GitRepository, target: string) {
    return (await repo.registered()).find(entry => entry.path === target);
  }
}
