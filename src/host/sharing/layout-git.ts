import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { KanbanError } from '../../shared/errors.js';
import {
  boardLogPath, readLayoutStamp, serializeLayoutStamp,
  SHARED_BOARD_DIRECTORY, SHARED_BOARD_EXTENSION, SHARED_BOARD_KEY_PATTERN, SHARED_LAYOUT_FILE, SHARED_LAYOUT_VERSION,
} from '../../domain/sharing/layout.js';
import { appendEvents, decodeBoardLog, encodeBoardLog, headToken, type BoardLog } from '../../domain/journal/log.js';
import type { BoardChange } from '../../domain/journal/event.js';
import { GitClone } from './git-clone.js';
import type { AppendOptions, BoardLogSnapshot, LayoutStampSnapshot, SharedLayoutStore } from './ports.js';
import type { SharingCommandRunner } from './command-runner.js';

/**
 * The published layout in a Git repository: the layout stamp beside one board log per
 * board, committed and pushed through the team files' clone.
 *
 * A commit is the optimistic token, so a stale publish is refused by Git rather than by
 * a comparison the plugin could get wrong.
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

  async readStamp(): Promise<LayoutStampSnapshot | null> {
    const commit = await this.commit();
    if (commit === null) return null;
    // The check is the only thing that refreshes the clone, so it also brings the
    // checked-out team files to the fetched head when nothing local is modified.
    if (await this.clone.isClean()) await this.clone.resetHard(commit);
    const text = await this.clone.showFile(commit, SHARED_LAYOUT_FILE);
    if (text === null) return null;
    return { version: readLayoutStamp(text).version };
  }

  async writeStamp(version: number, options: { expectedVersion: number | null }): Promise<LayoutStampSnapshot> {
    if (version !== SHARED_LAYOUT_VERSION) throw new KanbanError('SHARING_INVALID_DOCUMENT', 'This installation writes a single layout version.');
    const commit = await this.commit();
    const text = commit === null ? null : await this.clone.showFile(commit, SHARED_LAYOUT_FILE);
    const current = text === null ? null : readLayoutStamp(text).version;
    if (current !== options.expectedVersion) {
      throw new KanbanError('SHARING_STALE_TOKEN', 'The team configuration changed since it was read. Get the team updates before publishing.', { expected: options.expectedVersion ?? 'none', actual: current ?? 'none' });
    }
    await this.writeAndPush([SHARED_LAYOUT_FILE], { [SHARED_LAYOUT_FILE]: serializeLayoutStamp() }, commit, 'Update published Kanban layout');
    return { version };
  }

  async listLogs(): Promise<readonly { key: string; probe: string }[]> {
    const commit = await this.commit();
    if (commit === null) return [];
    const names = await this.clone.listDirectory(commit, SHARED_BOARD_DIRECTORY);
    const listed: Array<{ key: string; probe: string }> = [];
    for (const name of names) {
      if (!name.endsWith(SHARED_BOARD_EXTENSION)) continue;
      const key = name.slice(0, -SHARED_BOARD_EXTENSION.length);
      if (!SHARED_BOARD_KEY_PATTERN.test(key)) continue;
      // One commit covers the whole tree, so the commit is the probe for every log.
      listed.push({ key, probe: commit });
    }
    return listed;
  }

  async probe(key: string): Promise<string | null> {
    const commit = await this.commit();
    if (commit === null) return null;
    return (await this.clone.hasFile(commit, boardLogPath(key))) ? commit : null;
  }

  async readLog(key: string): Promise<BoardLogSnapshot | null> {
    const commit = await this.commit();
    if (commit === null) return null;
    const text = await this.clone.showFile(commit, boardLogPath(key));
    if (text === null) return null;
    const log = parseLog(text, key);
    return { probe: commit, head: headToken(log), log };
  }

  async createLog(key: string, log: BoardLog): Promise<BoardLogSnapshot> {
    const commit = await this.commit();
    if (commit !== null && await this.clone.hasFile(commit, boardLogPath(key))) {
      throw new KanbanError('SHARING_STALE_TOKEN', 'The board already has a published log.', { key });
    }
    const head = await this.writeAndPush([boardLogPath(key)], { [boardLogPath(key)]: encodeBoardLog(log) }, commit, 'Publish Kanban board');
    return { probe: head, head: headToken(log), log };
  }

  async appendChanges(key: string, changes: readonly BoardChange[], options: AppendOptions): Promise<BoardLogSnapshot> {
    options.signal?.throwIfAborted();
    const current = await this.readLog(key);
    if (current === null) throw new KanbanError('SHARING_BOARD_LOG_MISSING', 'The board has no published log.', { key });
    if (current.head !== options.expectedHead) {
      throw new KanbanError('SHARING_STALE_TOKEN', 'The board changed since it was read. Get the team updates before publishing.', { key, expected: options.expectedHead ?? 'none', actual: current.head });
    }
    const log = appendEvents(current.log, changes, options.at);
    const commit = await this.commit();
    // The fetch above may have moved the branch after the head was read. Re-read the log
    // at the exact commit the push will extend, so a teammate's append is never replaced.
    if (commit !== null) {
      const fresh = await this.clone.showFile(commit, boardLogPath(key));
      if (fresh !== null && headToken(parseLog(fresh, key)) !== current.head) {
        throw new KanbanError('SHARING_STALE_TOKEN', 'The board changed since it was read. Get the team updates before publishing.', { key });
      }
    }
    const head = await this.writeAndPush([boardLogPath(key)], { [boardLogPath(key)]: encodeBoardLog(log) }, commit, options.message);
    return { probe: head, head: headToken(log), log };
  }

  /** Write the given paths into the clone at the fetched commit, then commit and push them. */
  private async writeAndPush(paths: readonly string[], files: Readonly<Record<string, string>>, commit: string | null, message: string): Promise<string> {
    const branch = await this.clone.branchName();
    if (commit !== null && await this.clone.isClean()) await this.clone.resetHard(commit);
    for (const relative of paths) {
      const target = path.join(this.clone.path, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, files[relative] ?? '', 'utf8');
    }
    const committed = await this.clone.commitPaths(paths, message);
    if (committed) await this.clone.push(branch);
    const head = await this.clone.currentHead() ?? await this.clone.remoteHead() ?? commit;
    if (head === null) throw new KanbanError('SHARING_FAILED', 'The published board could not be committed.');
    return head;
  }
}

function parseLog(text: string, key: string): BoardLog {
  const decoded = decodeBoardLog(text);
  if (!decoded.ok) {
    if (decoded.reason === 'unsupported-version') throw new KanbanError('SHARING_DOCUMENT_VERSION_UNSUPPORTED', 'The team configuration was written by a newer plugin version. Update the plugin to read or publish it.', { key, version: decoded.version });
    if (decoded.reason === 'unknown-kind') throw new KanbanError('SHARING_DOCUMENT_VERSION_UNSUPPORTED', 'The team configuration carries a change this plugin does not know. Update the plugin to read or publish it.', { key, kind: decoded.kind });
    throw new KanbanError('SHARING_INVALID_DOCUMENT', 'The board log is invalid.', { key, message: decoded.message });
  }
  return decoded.log;
}