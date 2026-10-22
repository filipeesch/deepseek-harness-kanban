import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { KanbanError } from '../shared/errors.js';
import type { GitExecutor, GitPort, GitTree } from '../shared/ports.js';
import type { CreateWorktree, Project } from '../shared/types.js';

/** Resolve aliases, including the existing parent of a not-yet-created path. */
export async function canonicalPath(value: string, allowMissing = false): Promise<string> {
  if (!path.isAbsolute(value) || /[\0\r\n]/.test(value)) throw new KanbanError('INVALID_PATH', 'An absolute path without control characters is required.', { path: value });
  const candidate = path.resolve(value);
  try { return await realpath(candidate); }
  catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      const parent = path.dirname(candidate);
      if (parent !== candidate) return path.join(await canonicalPath(parent, true), path.basename(candidate));
    }
    throw new KanbanError('PATH_UNAVAILABLE', 'The directory cannot be resolved.', { path: candidate, cause: (error as NodeJS.ErrnoException).code });
  }
}

export function containsPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}

async function directory(value: string): Promise<string> {
  const canonical = await canonicalPath(value);
  if (!(await stat(canonical)).isDirectory()) throw new KanbanError('INVALID_DIRECTORY', 'The selected path is not a directory.', { path: canonical });
  return canonical;
}

async function exists(value: string): Promise<boolean> {
  try { await stat(value); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

interface RegisteredTree { path: string; locked: boolean }

function supportedBranchName(value: string): boolean {
  return value !== 'HEAD' && value !== '@' && !value.startsWith('-') && !value.startsWith('refs/');
}

/** Production execution is exclusively delegated to the injected confined executor. */
export class GitAdapter implements GitPort {
  constructor(private readonly executor: GitExecutor) {}

  async assertPolicy(project: Project, paths: string[], sessionIds: string[], write: boolean): Promise<void> {
    const canonical = await Promise.all(paths.map(value => canonicalPath(value, true)));
    await this.executor.assertPolicy(project, [...new Set(canonical)], sessionIds, write);
  }

  private async checked(project: Project, args: string[], sessions: string[], signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    const result = await this.executor.run(project, args, sessions, signal);
    if (result.exitCode !== 0) throw new KanbanError('GIT_FAILED', 'Git operation failed: ' + (result.stderr.trim() || result.stdout.trim() || 'exit ' + result.exitCode), { args, exitCode: result.exitCode, stderr: result.stderr });
    return result.stdout;
  }

  private async roots(project: Project, sessions: string[]): Promise<{ root: string; projectPath: string; common: string }> {
    const root = await directory(project.gitRootPath);
    const projectPath = await directory(project.projectPath);
    if (!containsPath(root, projectPath)) throw new KanbanError('PROJECT_OUTSIDE_GIT_ROOT', 'The project must be inside its configured Git root.');
    await this.assertPolicy(project, [root, projectPath], sessions, false);
    const actual = await directory((await this.checked(project, ['-C', root, 'rev-parse', '--show-toplevel'], sessions)).trim());
    if (actual !== root) throw new KanbanError('INVALID_GIT_ROOT', 'The configured Git root must be the repository checkout root.', { configured: root, actual });
    const common = await this.commonDirectory(project, root, sessions);
    await this.assertPolicy(project, [common], sessions, false);
    return { root, projectPath, common };
  }

  private async commonDirectory(project: Project, root: string, sessions: string[]): Promise<string> {
    const output = (await this.checked(project, ['-C', root, 'rev-parse', '--git-common-dir'], sessions)).trim();
    if (!output) throw new KanbanError('INVALID_GIT_OUTPUT', 'Git did not return a common directory.');
    return directory(path.resolve(root, output));
  }

  private assertTarget(root: string, projectPath: string, target: string, common: string): void {
    if (containsPath(target, root) || containsPath(target, projectPath) || containsPath(common, target) || containsPath(target, common)) {
      throw new KanbanError('UNSAFE_WORKTREE_TARGET', 'The worktree target must not be the base project, Git root, their ancestor, or Git metadata.', { path: target });
    }
  }

  private async registered(project: Project, root: string, sessions: string[]): Promise<RegisteredTree[]> {
    const output = await this.checked(project, ['-C', root, 'worktree', 'list', '--porcelain', '-z'], sessions);
    const records: RegisteredTree[] = [];
    let record: RegisteredTree | undefined;
    for (const field of output.split('\0')) {
      if (field.startsWith('worktree ')) { if (record) records.push(record); record = { path: await canonicalPath(field.slice(9), true), locked: false }; }
      else if (field === 'locked' || field.startsWith('locked ')) { if (record) record.locked = true; }
    }
    if (record) records.push(record);
    return records;
  }

  async projectDirectory(project: Project, worktreeRoot?: string): Promise<string> {
    const root = await directory(project.gitRootPath);
    const base = await directory(project.projectPath);
    if (!containsPath(root, base)) throw new KanbanError('PROJECT_OUTSIDE_GIT_ROOT', 'The project path escapes its Git root.');
    if (!worktreeRoot) return base;
    const tree = await directory(worktreeRoot);
    const target = await directory(path.join(tree, path.relative(root, base)));
    if (!containsPath(tree, target)) throw new KanbanError('PROJECT_OUTSIDE_WORKTREE', 'The project subdirectory escapes its worktree.');
    return target;
  }

  async branches(project: Project, sessionIds: string[]): Promise<string[]> {
    const { root } = await this.roots(project, sessionIds);
    const output = await this.checked(project, ['-C', root, 'for-each-ref', '--format=%(refname:strip=2)', 'refs/heads'], sessionIds);
    return [...new Set(output.split('\n').map(value => value.trim()).filter(value => value && supportedBranchName(value)))].sort();
  }

  async inspect(project: Project, value: string, sessionIds: string[]): Promise<GitTree> {
    const { root, projectPath, common } = await this.roots(project, sessionIds);
    const target = await directory(value);
    this.assertTarget(root, projectPath, target, common);
    await this.assertPolicy(project, [target], sessionIds, false);
    const actual = await directory((await this.checked(project, ['-C', target, 'rev-parse', '--show-toplevel'], sessionIds)).trim());
    if (actual !== target) throw new KanbanError('WORKTREE_ROOT_REQUIRED', 'Select the worktree root, not one of its subdirectories.', { path: target, root: actual });
    const targetCommon = await this.commonDirectory(project, target, sessionIds);
    if (targetCommon !== common) throw new KanbanError('REPOSITORY_MISMATCH', 'The selected worktree belongs to a different Git repository.', { path: target });
    const entry = (await this.registered(project, root, sessionIds)).find(item => item.path === target);
    if (!entry) throw new KanbanError('WORKTREE_NOT_REGISTERED', 'The selected checkout is not a registered worktree of this repository.', { path: target });
    const branch = (await this.checked(project, ['-C', target, 'branch', '--show-current'], sessionIds)).trim() || 'HEAD';
    const dirty = (await this.checked(project, ['-C', target, 'status', '--porcelain=v1', '--untracked-files=all', '-z'], sessionIds)).length > 0;
    return { path: target, branch, dirty, commonDirectory: common };
  }

  async create(project: Project, request: CreateWorktree, sessionIds: string[], signal?: AbortSignal): Promise<GitTree> {
    const { root, projectPath, common } = await this.roots(project, sessionIds);
    const target = await canonicalPath(request.path, true);
    this.assertTarget(root, projectPath, target, common);
    if (!request.branchName || !supportedBranchName(request.branchName) || request.branchName.startsWith('-') || /[\0\r\n]/.test(request.branchName)) throw new KanbanError('INVALID_BRANCH', 'A valid branch name is required.');
    await this.checked(project, ['-C', root, 'check-ref-format', 'refs/heads/' + request.branchName], sessionIds, signal);
    if (request.mode === 'existing') {
      try {
        await this.checked(project, ['-C', root, 'show-ref', '--verify', '--quiet', 'refs/heads/' + request.branchName], sessionIds, signal);
      } catch (error) {
        if (error instanceof KanbanError && error.code === 'GIT_FAILED' && error.details?.exitCode === 1) throw new KanbanError('LOCAL_BRANCH_REQUIRED', 'Existing-branch mode requires an existing local branch; remote refs are only valid as a new branch source.', { branchName: request.branchName });
        throw error;
      }
      await this.checked(project, ['-C', root, 'rev-parse', '--verify', '--end-of-options', 'refs/heads/' + request.branchName + '^{commit}'], sessionIds, signal);
    }
    await this.assertPolicy(project, [common, target], sessionIds, true);
    if (request.mode === 'new') {
      const source = request.sourceBranch ?? project.defaultBranch ?? 'HEAD';
      if (!source || /[\0\r\n]/.test(source)) throw new KanbanError('INVALID_BRANCH', 'A valid source branch is required.');
      const commit = (await this.checked(project, ['-C', root, 'rev-parse', '--verify', '--end-of-options', source + '^{commit}'], sessionIds, signal)).trim();
      await this.checked(project, ['-C', root, 'worktree', 'add', '-b', request.branchName, '--', target, commit], sessionIds, signal);
    } else {
      await this.checked(project, ['-C', root, 'worktree', 'add', '--', target, request.branchName], sessionIds, signal);
    }
    return this.inspect(project, target, sessionIds);
  }

  async remove(project: Project, value: string, discardChanges: boolean, sessionIds: string[], signal?: AbortSignal): Promise<void> {
    const { root, projectPath, common } = await this.roots(project, sessionIds);
    const target = await canonicalPath(value, true);
    this.assertTarget(root, projectPath, target, common);
    const entry = (await this.registered(project, root, sessionIds)).find(item => item.path === target);
    const present = await exists(target);
    if (!entry) {
      if (!present) return; // An interrupted, already-completed removal is safe to retry.
      throw new KanbanError('WORKTREE_NOT_REGISTERED', 'Refusing to remove a directory that is not a registered worktree.', { path: target });
    }
    if (entry.locked) throw new KanbanError('WORKTREE_LOCKED', 'The worktree is locked; resolve its Git lock before removal.', { path: target });
    if (present) {
      const tree = await this.inspect(project, target, sessionIds);
      if (tree.dirty && !discardChanges) throw new KanbanError('DISCARD_REQUIRED', 'Explicit confirmation is required to discard local worktree changes.', { path: target });
    }
    await this.assertPolicy(project, [common, target], sessionIds, true);
    const args = ['-C', root, 'worktree', 'remove'];
    if (discardChanges) args.push('--force');
    args.push('--', target);
    await this.checked(project, args, sessionIds, signal);
    if (await exists(target)) throw new KanbanError('WORKTREE_REMOVE_INCOMPLETE', 'Git reported removal but the worktree directory still exists.', { path: target });
  }
}
