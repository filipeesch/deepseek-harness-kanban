import type { GitExecutor, GitPort, GitRepository, GitTree } from '../shared/ports.js';
import type { CreateWorktree, GitProject } from '../shared/types.js';
import { resolveCanonicalPath } from './path-resolution.js';
import { entryExists } from './paths.js';
import { resolveProjectDirectory, resolveRepository } from './git-repository.js';
import { WorktreeReader } from './worktree-reader.js';
import { WorktreeWriter } from './worktree-writer.js';

/** Canonical resolution lives in one place; the alias keeps the historical Git-facing name. */
export { resolveCanonicalPath as canonicalPath } from './path-resolution.js';
/** The containment rule is a pure path fact; it is re-exported for its Git-facing callers. */
export { containsPath } from './repository-layout.js';

/**
 * The Git port over the injected confined executor. Each call either reuses the
 * repository context its caller resolved for the operation, or resolves one for
 * itself when the call is a single read.
 */
export class GitAdapter implements GitPort {
  private readonly reader: WorktreeReader;
  private readonly writer: WorktreeWriter;

  constructor(private readonly executor: GitExecutor) {
    this.reader = new WorktreeReader(executor);
    this.writer = new WorktreeWriter(executor);
  }

  async assertPolicy(project: GitProject, paths: string[], sessionIds: string[], write: boolean): Promise<void> {
    const canonical = await Promise.all(paths.map(value => resolveCanonicalPath(value, true)));
    await this.executor.assertPolicy(project, [...new Set(canonical)], sessionIds, write);
  }

  resolve(project: GitProject, sessionIds: string[], signal?: AbortSignal): Promise<GitRepository> {
    return resolveRepository(this.executor, project, sessionIds, signal);
  }

  private async use<T>(project: GitProject, sessionIds: string[], repository: GitRepository | undefined, run: (repository: GitRepository) => Promise<T>): Promise<T> {
    return run(repository ?? await this.resolve(project, sessionIds));
  }

  branches(project: GitProject, sessionIds: string[], repository?: GitRepository): Promise<string[]> {
    return this.use(project, sessionIds, repository, found => this.reader.branches(found, sessionIds));
  }

  sourceCommit(project: GitProject, sourceBranch: string, sessionIds: string[], repository?: GitRepository): Promise<string> {
    return this.use(project, sessionIds, repository, found => this.reader.sourceCommit(found, sourceBranch, sessionIds));
  }

  branchTip(project: GitProject, branchName: string, sessionIds: string[], repository?: GitRepository): Promise<string | undefined> {
    return this.use(project, sessionIds, repository, found => this.reader.branchTip(found, branchName, sessionIds));
  }

  clearRegistration(project: GitProject, value: string, sessionIds: string[], repository?: GitRepository): Promise<void> {
    return this.use(project, sessionIds, repository, found => this.writer.clearRegistration(found, value, sessionIds));
  }

  inspect(project: GitProject, value: string, sessionIds: string[], repository?: GitRepository): Promise<GitTree> {
    return this.use(project, sessionIds, repository, found => this.reader.inspect(found, value, sessionIds));
  }

  async assertRemovable(project: GitProject, value: string, sessionIds: string[], repository?: GitRepository): Promise<void> {
    return this.use(project, sessionIds, repository, found => this.writer.assertRemovable(found, value, sessionIds));
  }

  async localChanges(project: GitProject, value: string, sessionIds: string[], repository?: GitRepository): Promise<boolean> {
    const target = await resolveCanonicalPath(value, true);
    // An absent checkout cannot carry local changes; the Git removal path treats it as completed.
    if (!await entryExists(target)) return false;
    return this.use(project, sessionIds, repository, found => this.reader.localChanges(found, target, sessionIds));
  }

  create(project: GitProject, request: CreateWorktree, sessionIds: string[], signal?: AbortSignal, repository?: GitRepository, options?: { sourceCommit?: string; beforeWrite?: () => void }): Promise<GitTree> {
    return this.use(project, sessionIds, repository, found => this.writer.create(found, request, sessionIds, signal, options));
  }

  remove(project: GitProject, value: string, discardChanges: boolean, sessionIds: string[], signal?: AbortSignal, repository?: GitRepository, options?: { verifiedClean?: boolean }): Promise<void> {
    return this.use(project, sessionIds, repository, found => this.writer.remove(found, value, discardChanges, sessionIds, signal, options));
  }

  repair(project: GitProject, worktreePaths: string[], sessionIds: string[], signal?: AbortSignal, repository?: GitRepository): Promise<void> {
    return this.use(project, sessionIds, repository, found => this.writer.repair(found, worktreePaths, sessionIds, signal));
  }

  projectDirectory(project: GitProject, worktreeRoot?: string): Promise<string> {
    return resolveProjectDirectory(project, worktreeRoot);
  }
}