import path from 'node:path';
import { KanbanError } from '../shared/errors.js';
import type { GitDeadline, GitExecutor, GitRepository, RegisteredWorktree } from '../shared/ports.js';
import type { GitProject } from '../shared/types.js';
import { resolveCanonicalPath, requireDirectory } from './path-resolution.js';
import { containsPath } from './repository-layout.js';

/** One bounded Git invocation bound to a project and its conversation policies. */
export interface RepositoryCommands {
  run(args: string[], options?: { signal?: AbortSignal; write?: boolean; deadline?: GitDeadline }): Promise<string>;
}

/** The executor, project, and conversation set one repository operation runs against. */
export interface RepositoryCommandsInput {
  executor: GitExecutor;
  project: GitProject;
  sessionIds: string[];
}

export function createRepositoryCommands(input: RepositoryCommandsInput): RepositoryCommands {
  const { executor, project, sessionIds } = input;
  return {
    async run(args, options = {}) {
      const signal = options.signal;
      signal?.throwIfAborted();
      const result = await executor.run(project, args, sessionIds, signal, options.write === true, options.deadline);
      if (result.exitCode !== 0) throw new KanbanError('GIT_FAILED', 'Git operation failed: ' + (result.stderr.trim() || result.stdout.trim() || 'exit ' + result.exitCode), { args, exitCode: result.exitCode, stderr: result.stderr });
      return result.stdout;
    },
  };
}

async function canonicalOrNull(value: string): Promise<string | null> {
  try { return await resolveCanonicalPath(value, true); }
  catch { return null; }
}

/**
 * One operation's resolved repository facts. The registered worktrees are
 * resolved on demand and refreshed only when a Git worktree mutation invalidates
 * them, so an operation pays for the registration it actually reads.
 */
export class RepositoryFacts implements GitRepository {
  private worktrees: RegisteredWorktree[] | undefined;

  constructor(
    readonly project: GitProject,
    readonly root: string,
    readonly projectPath: string,
    readonly commonDirectory: string,
    private readonly commands: RepositoryCommands,
  ) {}

  async registered(): Promise<readonly RegisteredWorktree[]> {
    if (this.worktrees !== undefined) return this.worktrees;
    const output = await this.commands.run(['-C', this.root, 'worktree', 'list', '--porcelain', '-z']);
    const records: RegisteredWorktree[] = [];
    let record: RegisteredWorktree | undefined;
    for (const field of output.split('\0')) {
      if (field.startsWith('worktree ')) {
        if (record) records.push(record);
        // A prunable registration names a directory Git no longer sees; its path is
        // still canonicalized so an attempt can target exactly that registration.
        const resolved = await canonicalOrNull(field.slice(9));
        record = resolved === null ? undefined : { path: resolved, locked: false, prunable: false };
      } else if (field === 'locked' || field.startsWith('locked ')) { if (record) record.locked = true; }
      else if (field === 'prunable' || field.startsWith('prunable ')) { if (record) record.prunable = true; }
    }
    if (record) records.push(record);
    this.worktrees = records;
    return records;
  }

  invalidate(): void { this.worktrees = undefined; }

  /** The registration for one target, or undefined when this repository does not register it. */
  async registeredFor(target: string): Promise<RegisteredWorktree | undefined> {
    return (await this.registered()).find(entry => entry.path === target);
  }

  /** The bounded command runner this operation's Git calls share. */
  runnable(): RepositoryCommands { return this.commands; }

}

/**
 * Resolve the one repository context an operation reuses: the configured root and
 * project path, the common directory Git reports, and the rules between them.
 */
export async function resolveRepository(
  executor: GitExecutor,
  project: GitProject,
  sessionIds: string[],
  signal?: AbortSignal,
): Promise<GitRepository> {
  signal?.throwIfAborted();
  const root = await requireDirectory(project.gitRootPath);
  const projectPath = await requireDirectory(project.projectPath);
  if (!containsPath(root, projectPath)) throw new KanbanError('PROJECT_OUTSIDE_GIT_ROOT', 'The project must be inside its configured Git root.');
  await executor.assertPolicy(project, [root, projectPath], sessionIds, false);
  const commands = createRepositoryCommands({ executor, project, sessionIds });
  const reported = await requireDirectory((await commands.run(['-C', root, 'rev-parse', '--show-toplevel'], { signal })).trim());
  if (reported !== root) throw new KanbanError('INVALID_GIT_ROOT', 'The configured Git root must be the repository checkout root.', { configured: root, actual: reported });
  const commonOutput = (await commands.run(['-C', root, 'rev-parse', '--git-common-dir'], { signal })).trim();
  if (!commonOutput) throw new KanbanError('INVALID_GIT_OUTPUT', 'Git did not return a common directory.');
  const commonDirectory = await requireDirectory(path.resolve(root, commonOutput));
  await executor.assertPolicy(project, [commonDirectory], sessionIds, false);
  return new RepositoryFacts(project, root, projectPath, commonDirectory, commands);
}

/**
 * Target identity inside one checkout. Git reports the working-tree root and the
 * common directory in a single invocation, so a checkout is proven to belong to
 * this repository without re-reading the repository's own metadata.
 */
export async function identifyCheckout(commands: RepositoryCommands, target: string, signal?: AbortSignal): Promise<{ root: string; commonDirectory: string }> {
  const output = (await commands.run(['-C', target, 'rev-parse', '--show-toplevel', '--git-common-dir'], { signal })).trim();
  const [reported, common] = output.split('\n');
  if (!reported || !common) throw new KanbanError('INVALID_GIT_OUTPUT', 'Git did not return the checkout identity.');
  return { root: await requireDirectory(reported.trim()), commonDirectory: await requireDirectory(path.resolve(target, common.trim())) };
}
/** The project's directory inside one checkout, preserving a monorepo project's subdirectory. */
export async function resolveProjectDirectory(project: GitProject, worktreeRoot?: string): Promise<string> {
  const root = await requireDirectory(project.gitRootPath);
  const base = await requireDirectory(project.projectPath);
  if (!containsPath(root, base)) throw new KanbanError('PROJECT_OUTSIDE_GIT_ROOT', 'The project path escapes its Git root.');
  if (!worktreeRoot) return base;
  const tree = await requireDirectory(worktreeRoot);
  const target = await requireDirectory(path.join(tree, path.relative(root, base)));
  if (!containsPath(tree, target)) throw new KanbanError('PROJECT_OUTSIDE_WORKTREE', 'The project subdirectory escapes its worktree.');
  return target;
}