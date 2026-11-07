import { mkdir, readdir, rm, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { SHARED_DOCUMENT_FILE, parseSharedDocument, serializeSharedDocument, sharedDocumentToken, type SharedHubDocument } from '../../domain/sharing/document.js';
import { isDomainId } from '../../domain/validation.js';
import { KanbanError } from '../../shared/errors.js';
import type { CommandResult } from '../../shared/ports.js';
import { defaultSharingCommandRunner, type SharingCommandRunner } from './command-runner.js';
import type { ProviderState, SharingBinding, SharingProviderDescriptor } from './provider.js';
import type { SharedConfigStore, SharedDocumentSnapshot } from './store.js';

export { SHARED_DOCUMENT_FILE } from '../../domain/sharing/document.js';
export { sharingRoot } from './root.js';
export type { SharingCommandRunner } from './command-runner.js';
const CLONE_TIMEOUT_MS = 120_000;
const FETCH_TIMEOUT_MS = 60_000;
const PUSH_TIMEOUT_MS = 60_000;
const WRITE_TIMEOUT_MS = 20_000;

const AUTH_FAILURE = /authentication failed|could not read username|permission denied \(publickey\)|terminal prompts disabled|invalid username or password|repository not found|403 forbidden/i;
const UNREACHABLE_FAILURE = /could not resolve host|unable to access|connection refused|connection timed out|network is unreachable|no such file or directory|does not appear to be a git repository|does not exist|operation exceeded|timed out/i;
const MISSING_PATH = /does not exist|exists on disk, but not in|path .* not in/i;

function failure(action: string, result: CommandResult): KanbanError {
  const stderr = (result.stderr || result.stdout).trim();
  if (AUTH_FAILURE.test(stderr)) return new KanbanError('SHARING_AUTH', 'The team repository rejected the credentials available on this machine. Configure Git credentials and try again.', { action, exitCode: result.exitCode, stderr });
  if (UNREACHABLE_FAILURE.test(stderr)) return new KanbanError('SHARING_UNREACHABLE', 'The team repository could not be reached. Check the address and the network.', { action, exitCode: result.exitCode, stderr });
  return new KanbanError('SHARING_FAILED', 'The publishing operation could not be completed.', { action, exitCode: result.exitCode, stderr });
}

async function exists(value: string): Promise<boolean> {
  try { await lstat(value); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

function clonePathFor(root: string, hubId: string): string {
  if (!isDomainId(hubId)) throw new KanbanError('SHARING_INVALID_HUB', 'The Hub identifier cannot be used for a publishing workspace.');
  return path.join(root, hubId);
}

export class GitSharedConfigStore implements SharedConfigStore {
  private readonly runner: SharingCommandRunner;
  private ready: Promise<void> | undefined;
  constructor(private readonly options: { root: string; hubId: string; repository: string; runner?: SharingCommandRunner }) {
    this.runner = options.runner ?? defaultSharingCommandRunner;
  }

  private get clonePath(): string { return clonePathFor(this.options.root, this.options.hubId); }

  private git(args: string[], timeoutMs: number, cwd = this.clonePath): Promise<CommandResult> {
    return this.runner(['git', ...args], cwd, timeoutMs);
  }

  private async require(args: string[], timeoutMs: number, cwd = this.clonePath): Promise<string> {
    const result = await this.git(args, timeoutMs, cwd);
    if (result.exitCode !== 0) throw failure(args[0] ?? 'git', result);
    return result.stdout;
  }

  async ensure(): Promise<void> {
    if (this.ready === undefined) {
      this.ready = this.prepare().catch(error => { this.ready = undefined; throw error; });
    }
    return this.ready;
  }

  private async prepare(): Promise<void> {
    const clonePath = this.clonePath;
    if (await exists(path.join(clonePath, '.git'))) {
      const remote = await this.git(['remote', 'get-url', 'origin'], WRITE_TIMEOUT_MS);
      if (remote.exitCode !== 0) throw failure('remote', remote);
      if (remote.stdout.trim() !== this.options.repository) {
        // The managed workspace is plugin-owned and reproducible; a binding change
        // replaces it instead of leaving an unrecoverable mismatch.
        await this.destroy();
        return this.prepare();
      }
      return;
    }
    if (await exists(clonePath)) {
      const entries = await readdir(clonePath).catch(() => [] as string[]);
      if (entries.length > 0) throw new KanbanError('SHARING_CLONE_CONFLICT', 'The managed publishing workspace path already holds unrelated files.', { path: clonePath });
    }
    await mkdir(path.dirname(clonePath), { recursive: true });
    const result = await this.git(['clone', '--quiet', '--', this.options.repository, clonePath], CLONE_TIMEOUT_MS, path.dirname(clonePath));
    if (result.exitCode !== 0) throw failure('clone', result);
  }

  private async fetch(): Promise<void> {
    const result = await this.git(['fetch', '--prune', '--quiet', 'origin'], FETCH_TIMEOUT_MS);
    if (result.exitCode !== 0) throw failure('fetch', result);
  }

  /** Commit of the remote default branch, or null for a repository with no commits. */
  private async remoteHead(): Promise<string | null> {
    const head = await this.git(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/HEAD'], WRITE_TIMEOUT_MS);
    if (head.exitCode === 0 && head.stdout.trim()) return head.stdout.trim();
    for (const branch of ['main', 'master']) {
      const value = await this.git(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/' + branch], WRITE_TIMEOUT_MS);
      if (value.exitCode === 0 && value.stdout.trim()) return value.stdout.trim();
    }
    return null;
  }

  private async branchName(): Promise<string> {
    const remote = await this.git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], WRITE_TIMEOUT_MS);
    if (remote.exitCode === 0 && remote.stdout.trim()) return remote.stdout.trim().replace(/^origin\//, '');
    const current = await this.git(['symbolic-ref', '--short', 'HEAD'], WRITE_TIMEOUT_MS);
    if (current.exitCode === 0 && current.stdout.trim()) return current.stdout.trim();
    return 'main';
  }

  private async rawAt(commit: string): Promise<string | null> {
    const result = await this.git(['show', commit + ':' + SHARED_DOCUMENT_FILE], WRITE_TIMEOUT_MS);
    if (result.exitCode === 0) return result.stdout;
    if (MISSING_PATH.test(result.stderr)) return null;
    throw failure('show', result);
  }

  async read(signal?: AbortSignal, _cached?: SharedDocumentSnapshot | null): Promise<SharedDocumentSnapshot | null> {
    signal?.throwIfAborted();
    await this.ensure();
    await this.fetch();
    const commit = await this.remoteHead();
    if (commit === null) return null;
    const raw = await this.rawAt(commit);
    if (raw === null) return null;
    const document = parseSharedDocument(raw);
    return { token: sharedDocumentToken(document), document };
  }

  state(): ProviderState { return {}; }

  async write(document: SharedHubDocument, options: { expectedToken: string | null; message: string }, signal?: AbortSignal): Promise<{ token: string }> {
    signal?.throwIfAborted();
    await this.ensure();
    await this.fetch();
    const commit = await this.remoteHead();
    const raw = commit === null ? null : await this.rawAt(commit);
    const current = raw === null ? null : sharedDocumentToken(parseSharedDocument(raw));
    if (current !== options.expectedToken) {
      throw new KanbanError('SHARING_STALE_TOKEN', 'The team configuration changed since it was read. Get the team updates before publishing.', { expected: options.expectedToken ?? 'none', actual: current ?? 'none' });
    }
    const branch = await this.branchName();
    if (commit !== null) await this.require(['reset', '--hard', '--quiet', commit], WRITE_TIMEOUT_MS);
    await writeFile(path.join(this.clonePath, SHARED_DOCUMENT_FILE), serializeSharedDocument(document), 'utf8');
    await this.require(['add', '--', SHARED_DOCUMENT_FILE], WRITE_TIMEOUT_MS);
    const committed = await this.git(['-c', 'user.name=DeepSeek Harness', '-c', 'user.email=dsh-kanban@localhost', 'commit', '--quiet', '-m', options.message], WRITE_TIMEOUT_MS);
    if (committed.exitCode !== 0) {
      if (/nothing to commit|no changes added/i.test(committed.stdout + committed.stderr)) return { token: sharedDocumentToken(document) };
      throw failure('commit', committed);
    }
    const pushed = await this.git(['push', '--quiet', 'origin', 'HEAD:refs/heads/' + branch], PUSH_TIMEOUT_MS);
    if (pushed.exitCode !== 0) {
      if (/non-fast-forward|rejected|fetch first/i.test(pushed.stderr)) throw new KanbanError('SHARING_STALE_TOKEN', 'The team configuration changed while this installation was publishing. Get the team updates before publishing.', { branch });
      throw failure('publish', pushed);
    }
    return { token: sharedDocumentToken(document) };
  }

  async destroy(): Promise<void> {
    const clonePath = this.clonePath;
    if (path.dirname(clonePath) !== path.resolve(this.options.root) || path.basename(clonePath) !== this.options.hubId) {
      throw new KanbanError('SHARING_CLONE_UNSAFE', 'Refusing to remove a directory outside the managed publishing root.');
    }
    await rm(clonePath, { recursive: true, force: true });
    this.ready = undefined;
  }
}

/** The Git storage descriptor: explicit publish, repository address, managed clone. */
export function createGitProviderDescriptor(options: { root: string; runner?: SharingCommandRunner }): SharingProviderDescriptor {
  return {
    id: 'git',
    label: 'Git repository',
    syncMode: 'explicit',
    defaultIntervalMinutes: 5,
    requiresAuthorization: false,
    normalizeSettings(settings) {
      const repository = (settings.repository ?? '').trim();
      if (repository.length === 0 || repository.length > 2048 || /[\0\r\n]/.test(repository)) throw new KanbanError('INVALID_INPUT', 'A repository address is required.');
      return { repository };
    },
    describe(binding) { return binding.settings.repository ?? ''; },
    createStore(hubId, binding, state) {
      if (binding.provider !== 'git') throw new KanbanError('SHARING_UNSUPPORTED_STORAGE', 'The configured team storage is not supported by the Git provider.', { provider: binding.provider });
      const repository = binding.settings.repository;
      if (!repository) throw new KanbanError('INVALID_INPUT', 'A repository address is required.');
      return new GitSharedConfigStore({ root: options.root, hubId, repository, ...(options.runner === undefined ? {} : { runner: options.runner }) });
    },
    normalizeState(state) { return state; },
  };
}
