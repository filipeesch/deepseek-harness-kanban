import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { KanbanError } from '../../shared/errors.js';
import {
  boardLogPath, readSharedConfiguration, serializeSharedManifest, sharedManifestToken,
  SHARED_MANIFEST_FILE, type SharedHubManifest,
} from '../../domain/sharing/manifest.js';
import { appendEvents, createBoardLog, headToken, readBoardLogText, type BoardLogFile } from '../../domain/journal/log.js';
import type { BoardChange } from '../../domain/journal/event.js';
import { GitClone } from './git-clone.js';
import type { AppendOptions, BoardLogSnapshot, ManifestSnapshot, SharedLayoutStore } from './ports.js';
import type { SharingCommandRunner } from './command-runner.js';

/**
 * The published layout in a Git repository: the manifest and one board log per
 * board, committed and pushed together with the team files' clone.
 *
 * A commit is the optimistic token for both halves, so a stale publish is refused
 * by Git rather than by a comparison the plugin could get wrong.
 */
export interface GitLayoutStoreOptions {
  readonly root: string;
  readonly hubId: string;
  readonly repository: string;
  readonly runner?: SharingCommandRunner;
}

export class GitLayoutStore implements SharedLayoutStore {
  private readonly clone: GitClone;

  constructor(options: GitLayoutStoreOptions) {
    this.clone = new GitClone({ root: options.root, hubId: options.hubId, repository: options.repository, ...(options.runner === undefined ? {} : { runner: options.runner }) });
  }

  state(): Record<string, unknown> { return {}; }

  review(): null { return null; }

  ensure(): Promise<void> { return this.clone.ensure(); }

  destroy(): Promise<void> { return this.clone.destroy(); }

  /**
   * The remote head as of now. Every public operation fetches first, so this store
   * never decides on a commit another installation has already moved past.
   */
  private async commit(): Promise<string | null> {
    await this.clone.ensure();
    await this.clone.fetch();
    return this.clone.remoteHead();
  }

  async readManifest(_signal?: AbortSignal, cached?: ManifestSnapshot | null): Promise<ManifestSnapshot | null> {
    const commit = await this.commit();
    if (commit === null) return null;
    // The check is the only thing that refreshes the clone, so it also brings the
    // checked-out team files to the fetched head when nothing local is modified.
    if (await this.clone.isClean()) await this.clone.resetHard(commit);
    const text = await this.clone.showFile(commit, SHARED_MANIFEST_FILE);
    if (text === null) return null;
    const read = readSharedConfiguration(text);
    const token = sharedManifestToken(read.manifest);
    if (cached !== null && cached !== undefined && cached.token === token) return cached;
    return { token, manifest: read.manifest, legacyWorkflows: read.legacyWorkflows };
  }

  async writeManifest(manifest: SharedHubManifest, options: { expectedToken: string | null; message: string }, signal?: AbortSignal): Promise<{ token: string }> {
    signal?.throwIfAborted();
    const commit = await this.commit();
    const text = commit === null ? null : await this.clone.showFile(commit, SHARED_MANIFEST_FILE);
    const current = text === null ? null : sharedManifestToken(readSharedConfiguration(text).manifest);
    if (current !== options.expectedToken) {
      throw new KanbanError('SHARING_STALE_TOKEN', 'The team configuration changed since it was read. Get the team updates before publishing.', { expected: options.expectedToken ?? 'none', actual: current ?? 'none' });
    }
    const token = sharedManifestToken(manifest);
    await this.writeAndPush([SHARED_MANIFEST_FILE], { [SHARED_MANIFEST_FILE]: serializeSharedManifest(manifest) }, commit, options.message);
    return { token };
  }

  async probe(key: string): Promise<string | null> {
    const commit = await this.commit();
    if (commit === null) return null;
    return (await this.clone.hasFile(commit, boardLogPath(key))) ? commit : null;
  }

  async readLog(key: string, _signal?: AbortSignal, cached?: BoardLogSnapshot | null): Promise<BoardLogSnapshot | null> {
    const commit = await this.commit();
    if (commit === null) return null;
    const text = await this.clone.showFile(commit, boardLogPath(key));
    if (text === null) return null;
    const log = this.parse(text, key);
    const head = headToken(log);
    if (cached !== null && cached !== undefined && cached.head === head) return cached;
    return { probe: commit, head, log };
  }

  async createLog(key: string, text: string): Promise<BoardLogSnapshot> {
    const commit = await this.commit();
    if (commit !== null && await this.clone.hasFile(commit, boardLogPath(key))) {
      throw new KanbanError('SHARING_STALE_TOKEN', 'The board already has a published log.', { key });
    }
    const log = createBoardLog(text);
    await this.writeAndPush([boardLogPath(key)], { [boardLogPath(key)]: this.serialize(log) }, commit, 'Publish Kanban board');
    return { probe: '', head: headToken(log), log };
  }

  async appendChanges(key: string, changes: readonly BoardChange[], options: AppendOptions): Promise<BoardLogSnapshot> {
    options.signal?.throwIfAborted();
    const current = await this.readLog(key, options.signal);
    if (current === null) throw new KanbanError('SHARING_BOARD_LOG_MISSING', 'The board has no published log.', { key });
    if (current.head !== options.expectedHead) {
      throw new KanbanError('SHARING_STALE_TOKEN', 'The board changed since it was read. Get the team updates before publishing.', { key, expected: options.expectedHead ?? 'none', actual: current.head });
    }
    const log = appendEvents(current.log, changes, options.at);
    const commit = await this.commit();
    await this.writeAndPush([boardLogPath(key)], { [boardLogPath(key)]: this.serialize(log) }, commit, options.message);
    return { probe: '', head: headToken(log), log };
  }

  async removeLog(key: string): Promise<void> {
    const relative = boardLogPath(key);
    await this.clone.ensure();
    const commit = await this.commit();
    if (commit === null) return;
    if (!await this.clone.hasFile(commit, relative)) return;
    const branch = await this.clone.branchName();
    if (await this.clone.isClean()) await this.clone.resetHard(commit);
    await this.clone.require(['rm', '--quiet', '--', relative]);
    // `git rm` staged exactly this deletion, so the commit takes the index as it is.
    const committed = await this.clone.commitStaged('Remove Kanban board');
    if (committed) await this.clone.push(branch);
  }

  /** Write the given paths into the clone at the fetched commit, then commit and push them. */
  private async writeAndPush(paths: readonly string[], files: Readonly<Record<string, string>>, commit: string | null, message: string): Promise<void> {
    const branch = await this.clone.branchName();
    if (commit !== null && await this.clone.isClean()) await this.clone.resetHard(commit);
    for (const relative of paths) {
      const target = path.join(this.clone.path, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, files[relative] ?? '', 'utf8');
    }
    const committed = await this.clone.commitPaths(paths, message);
    if (committed) await this.clone.push(branch);
  }

  private parse(text: string, key: string): BoardLogFile {
    const decoded = readBoardLogText(text);
    if (!decoded.ok) {
      if (decoded.reason === 'unsupported-version') throw new KanbanError('SHARING_DOCUMENT_VERSION_UNSUPPORTED', 'The team configuration was written by a newer plugin version. Update the plugin to read or publish it.', { key, version: decoded.version });
      if (decoded.reason === 'unknown-kind') throw new KanbanError('SHARING_DOCUMENT_VERSION_UNSUPPORTED', 'The team configuration carries a change this plugin does not know. Update the plugin to read or publish it.', { key, kind: decoded.kind });
      throw new KanbanError('SHARING_INVALID_DOCUMENT', 'The board log is invalid.', { key, message: decoded.message });
    }
    return decoded.log;
  }

  /** The log is stored as YAML, like the manifest, so a team can read it. */
  private serialize(log: BoardLogFile): string {
    return stringifyYaml({ version: log.version, snapshot: { seq: log.snapshot.seq, text: log.snapshot.text }, events: log.events }, { lineWidth: 0 });
  }
}
