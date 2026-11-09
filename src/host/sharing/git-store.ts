import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SHARED_DOCUMENT_FILE, parseSharedDocument, serializeSharedDocument, sharedDocumentToken, type SharedHubDocument } from '../../domain/sharing/document.js';
import { KanbanError } from '../../shared/errors.js';
import { TEAM_FILES_DIRECTORY } from '../../shared/types.js';
import type { SharingCommandRunner } from './command-runner.js';
import { GitClone } from './git-clone.js';
import { GitTeamFileStore } from './git-team-file-store.js';
import type { ProviderState, SharingBinding, SharingProviderDescriptor } from './provider.js';
import type { SharedConfigStore, SharedDocumentSnapshot } from './store.js';
import type { TeamFileStore } from './team-file-store.js';

export { SHARED_DOCUMENT_FILE } from '../../domain/sharing/document.js';
export { sharingRoot } from './root.js';
export type { SharingCommandRunner } from './command-runner.js';

export interface GitSharedConfigStoreOptions { root: string; hubId: string; repository: string; runner?: SharingCommandRunner }

/** The document half of a Git binding: one whole document on the clone's default branch. */
export class GitSharedConfigStore implements SharedConfigStore {
  private readonly clone: GitClone;

  constructor(options: GitSharedConfigStoreOptions) {
    this.clone = new GitClone({ root: options.root, hubId: options.hubId, repository: options.repository, ...(options.runner === undefined ? {} : { runner: options.runner }) });
  }

  state(): ProviderState { return {}; }

  ensure(): Promise<void> { return this.clone.ensure(); }

  async read(signal?: AbortSignal, _cached?: SharedDocumentSnapshot | null): Promise<SharedDocumentSnapshot | null> {
    signal?.throwIfAborted();
    await this.clone.ensure();
    await this.clone.fetch();
    const commit = await this.clone.remoteHead();
    if (commit === null) return null;
    // The automatic check is the only thing that refreshes the clone for
    // reading, so it also brings the checked-out team files to the fetched head
    // when no tracked file is modified locally.
    if (await this.clone.isClean()) await this.clone.resetHard(commit);
    const raw = await this.clone.showFile(commit, SHARED_DOCUMENT_FILE);
    if (raw === null) return null;
    const document = parseSharedDocument(raw);
    return { token: sharedDocumentToken(document), document };
  }

  async write(document: SharedHubDocument, options: { expectedToken: string | null; message: string }, signal?: AbortSignal): Promise<{ token: string }> {
    signal?.throwIfAborted();
    const clone = this.clone;
    await clone.ensure();
    await clone.fetch();
    const commit = await clone.remoteHead();
    const raw = commit === null ? null : await clone.showFile(commit, SHARED_DOCUMENT_FILE);
    const current = raw === null ? null : sharedDocumentToken(parseSharedDocument(raw));
    if (current !== options.expectedToken) {
      throw new KanbanError('SHARING_STALE_TOKEN', 'The team configuration changed since it was read. Get the team updates before publishing.', { expected: options.expectedToken ?? 'none', actual: current ?? 'none' });
    }
    const branch = await clone.branchName();
    if (commit !== null) await clone.resetHard(commit);
    await writeFile(path.join(clone.path, SHARED_DOCUMENT_FILE), serializeSharedDocument(document), 'utf8');
    const committed = await clone.commitPaths([SHARED_DOCUMENT_FILE], options.message);
    if (!committed) return { token: sharedDocumentToken(document) };
    await clone.push(branch);
    return { token: sharedDocumentToken(document) };
  }

  destroy(): Promise<void> { return this.clone.destroy(); }
}

/** The Git storage descriptor: explicit publish, repository address, managed clone. */
export function createGitProviderDescriptor(options: { root: string; runner?: SharingCommandRunner }): SharingProviderDescriptor {
  const cloneFor = (hubId: string, binding: SharingBinding): GitClone => {
    const repository = binding.settings.repository;
    if (!repository) throw new KanbanError('INVALID_INPUT', 'A repository address is required.');
    return new GitClone({ root: options.root, hubId, repository, ...(options.runner === undefined ? {} : { runner: options.runner }) });
  };
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
    createStore(hubId, binding) {
      if (binding.provider !== 'git') throw new KanbanError('SHARING_UNSUPPORTED_STORAGE', 'The configured team storage is not supported by the Git provider.', { provider: binding.provider });
      const repository = binding.settings.repository;
      if (!repository) throw new KanbanError('INVALID_INPUT', 'A repository address is required.');
      return new GitSharedConfigStore({ root: options.root, hubId, repository, ...(options.runner === undefined ? {} : { runner: options.runner }) });
    },
    createFileStore(hubId, binding): TeamFileStore {
      if (binding.provider !== 'git') throw new KanbanError('SHARING_UNSUPPORTED_STORAGE', 'The configured team storage is not supported by the Git provider.', { provider: binding.provider });
      return new GitTeamFileStore({ clone: cloneFor(hubId, binding), directory: TEAM_FILES_DIRECTORY });
    },
    normalizeState(state) { return state; },
  };
}
