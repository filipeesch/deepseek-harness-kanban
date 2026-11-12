import { mkdir, readdir, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { isDomainId } from '../../domain/validation.js';
import { KanbanError } from '../../shared/errors.js';
import type { CommandResult } from '../../shared/ports.js';
import { defaultSharingCommandRunner, type SharingCommandRunner } from './command-runner.js';

const CLONE_TIMEOUT_MS = 120_000;
const FETCH_TIMEOUT_MS = 60_000;
const PUSH_TIMEOUT_MS = 60_000;
const WRITE_TIMEOUT_MS = 20_000;
/** The identity every plugin-created commit carries; the plugin never uses the user's. */
const COMMIT_IDENTITY = ['-c', 'user.name=DeepSeek Harness', '-c', 'user.email=dsh-kanban@localhost'];

const AUTH_FAILURE = /authentication failed|could not read username|permission denied \(publickey\)|terminal prompts disabled|invalid username or password|repository not found|403 forbidden/i;
const UNREACHABLE_FAILURE = /could not resolve host|unable to access|connection refused|connection timed out|network is unreachable|no such file or directory|does not appear to be a git repository|does not exist|operation exceeded|timed out/i;
const MISSING_PATH = /does not exist|exists on disk, but not in|path .* not in/i;

/** Map a failed Git invocation onto the condition the interface must report. */
export function gitFailure(action: string, result: CommandResult): KanbanError {
  const stderr = (result.stderr || result.stdout).trim();
  if (AUTH_FAILURE.test(stderr)) return new KanbanError('SHARING_AUTH', 'The team repository rejected the credentials available on this machine. Configure Git credentials and try again.', { action, exitCode: result.exitCode, stderr });
  if (UNREACHABLE_FAILURE.test(stderr)) return new KanbanError('SHARING_UNREACHABLE', 'The team repository could not be reached. Check the address and the network.', { action, exitCode: result.exitCode, stderr });
  return new KanbanError('SHARING_FAILED', 'The publishing operation could not be completed.', { action, exitCode: result.exitCode, stderr });
}

async function exists(value: string): Promise<boolean> {
  try { await lstat(value); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function clonePathFor(root: string, hubId: string): string {
  if (!isDomainId(hubId)) throw new KanbanError('SHARING_INVALID_HUB', 'The Hub identifier cannot be used for a publishing workspace.');
  return path.join(root, hubId);
}

export interface GitCloneOptions {
  root: string;
  hubId: string;
  repository: string;
  runner?: SharingCommandRunner;
}

/**
 * One plugin-owned clone of a Hub's team repository. Document publishing and
 * team file writes share it, so neither owns Git mechanics of its own and the
 * per-Hub lane is the only thing that has to keep them apart.
 */
export class GitClone {
  private readonly runner: SharingCommandRunner;
  private ready: Promise<void> | undefined;

  constructor(private readonly options: GitCloneOptions) {
    this.runner = options.runner ?? defaultSharingCommandRunner;
  }

  get path(): string { return clonePathFor(this.options.root, this.options.hubId); }

  get repository(): string { return this.options.repository; }

  /** One Git invocation inside the clone. */
  run(args: string[], timeoutMs = WRITE_TIMEOUT_MS): Promise<CommandResult> {
    return this.runner(['git', ...args], this.path, timeoutMs);
  }

  /** One Git invocation that must succeed. */
  async require(args: string[], timeoutMs = WRITE_TIMEOUT_MS): Promise<string> {
    const result = await this.run(args, timeoutMs);
    if (result.exitCode !== 0) throw gitFailure(args[0] ?? 'git', result);
    return result.stdout;
  }

  ensure(): Promise<void> {
    if (this.ready === undefined) this.ready = this.prepare().catch(error => { this.ready = undefined; throw error; });
    return this.ready;
  }

  private async prepare(): Promise<void> {
    const clonePath = this.path;
    if (await exists(path.join(clonePath, '.git'))) {
      const remote = await this.run(['remote', 'get-url', 'origin']);
      if (remote.exitCode !== 0) throw gitFailure('remote', remote);
      if (remote.stdout.trim() !== this.options.repository) {
        // The managed workspace is plugin-owned and reproducible; a binding change
        // replaces it instead of leaving an unrecoverable mismatch.
        await this.destroy();
        return this.ensure();
      }
      return;
    }
    if (await exists(clonePath)) {
      const entries = await readdir(clonePath).catch(() => [] as string[]);
      if (entries.length > 0) throw new KanbanError('SHARING_CLONE_CONFLICT', 'The managed publishing workspace path already holds unrelated files.', { path: clonePath });
    }
    await mkdir(path.dirname(clonePath), { recursive: true });
    const result = await this.runner(['git', 'clone', '--quiet', '--', this.options.repository, clonePath], path.dirname(clonePath), CLONE_TIMEOUT_MS);
    if (result.exitCode !== 0) throw gitFailure('clone', result);
  }

  async fetch(): Promise<void> {
    const result = await this.run(['fetch', '--prune', '--quiet', 'origin'], FETCH_TIMEOUT_MS);
    if (result.exitCode !== 0) throw gitFailure('fetch', result);
  }

  /** Commit of the remote default branch, or null for a repository with no commits. */
  async remoteHead(): Promise<string | null> {
    const head = await this.run(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/HEAD']);
    if (head.exitCode === 0 && head.stdout.trim()) return head.stdout.trim();
    for (const branch of ['main', 'master']) {
      const value = await this.run(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/' + branch]);
      if (value.exitCode === 0 && value.stdout.trim()) return value.stdout.trim();
    }
    return null;
  }

  /** The commit the clone currently has checked out, when it has one. */
  async currentHead(): Promise<string | null> {
    const head = await this.run(['rev-parse', '--verify', '--quiet', 'HEAD']);
    return head.exitCode === 0 && head.stdout.trim() ? head.stdout.trim() : null;
  }

  async branchName(): Promise<string> {
    const remote = await this.run(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
    if (remote.exitCode === 0 && remote.stdout.trim()) return remote.stdout.trim().replace(/^origin\//, '');
    const current = await this.run(['symbolic-ref', '--short', 'HEAD']);
    if (current.exitCode === 0 && current.stdout.trim()) return current.stdout.trim();
    return 'main';
  }

  /** The bytes of one path at one commit, or null when that commit does not have it. */
  async showFile(commit: string, relativePath: string): Promise<string | null> {
    const result = await this.run(['show', commit + ':' + relativePath]);
    if (result.exitCode === 0) return result.stdout;
    if (MISSING_PATH.test(result.stderr)) return null;
    throw gitFailure('show', result);
  }

  /** The names directly inside one directory at one commit, or an empty list. */
  async listDirectory(commit: string, relativePath: string): Promise<string[]> {
    const result = await this.run(['ls-tree', '--name-only', commit + ':' + relativePath]);
    if (result.exitCode !== 0) {
      if (MISSING_PATH.test(result.stderr)) return [];
      return [];
    }
    return result.stdout.split(String.fromCharCode(10)).map(name => name.trim()).filter(name => name.length > 0);
  }

  /** Whether one path exists at one commit, without reading its content. */
  async hasFile(commit: string, relativePath: string): Promise<boolean> {
    const result = await this.run(['cat-file', '-e', commit + ':' + relativePath]);
    return result.exitCode === 0;
  }

  async resetHard(commit: string): Promise<void> { await this.require(['reset', '--hard', '--quiet', commit]); }

  /** Whether no tracked file is modified, so a hard reset cannot discard local work. */
  async isClean(): Promise<boolean> {
    const status = await this.run(['status', '--porcelain', '--untracked-files=no']);
    return status.exitCode === 0 && status.stdout.trim().length === 0;
  }

  /** Stage the given paths and commit them; false when Git found nothing to commit. */
  async commitPaths(paths: readonly string[], message: string, options: { all?: boolean } = {}): Promise<boolean> {
    if (paths.length > 0) await this.require(options.all === true ? ['add', '-A', '--', ...paths] : ['add', '--', ...paths]);
    const committed = await this.run([...COMMIT_IDENTITY, 'commit', '--quiet', '-m', message]);
    if (committed.exitCode === 0) return true;
    if (/nothing to commit|no changes added/i.test(committed.stdout + committed.stderr)) return false;
    throw gitFailure('commit', committed);
  }

  /** Commit what is already staged, which is how a removal records itself. */
  async commitStaged(message: string): Promise<boolean> {
    const committed = await this.run([...COMMIT_IDENTITY, 'commit', '--quiet', '-m', message]);
    if (committed.exitCode === 0) return true;
    if (/nothing to commit|no changes added/i.test(committed.stdout + committed.stderr)) return false;
    throw gitFailure('commit', committed);
  }

  async push(branch: string): Promise<void> {
    const pushed = await this.run(['push', '--quiet', 'origin', 'HEAD:refs/heads/' + branch], PUSH_TIMEOUT_MS);
    if (pushed.exitCode === 0) return;
    if (/non-fast-forward|rejected|fetch first/i.test(pushed.stderr)) throw new KanbanError('SHARING_STALE_TOKEN', 'The team storage changed while this installation was publishing. Get the team updates before publishing.', { branch });
    throw gitFailure('publish', pushed);
  }

  async destroy(): Promise<void> {
    const clonePath = this.path;
    if (path.dirname(clonePath) !== path.resolve(this.options.root) || path.basename(clonePath) !== this.options.hubId) {
      throw new KanbanError('SHARING_CLONE_UNSAFE', 'Refusing to remove a directory outside the managed publishing root.');
    }
    await rm(clonePath, { recursive: true, force: true });
    this.ready = undefined;
  }
}