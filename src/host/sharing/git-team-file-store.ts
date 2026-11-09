import path from 'node:path';
import { KanbanError } from '../../shared/errors.js';
import { TEAM_FILES_DIRECTORY } from '../../shared/types.js';
import { TEAM_FILE_MAX_INPUT_BYTES } from '../team-files/limits.js';
import type { GitClone } from './git-clone.js';
import { TeamFileDirectory } from './team-file-directory.js';
import type { TeamFileContent, TeamFileEntry, TeamFileReadOptions, TeamFileStore, TeamFileWrite, TeamFileWriteOptions } from './team-file-store.js';

function changed(relative: string, reset?: string): KanbanError {
  return new KanbanError(
    'TEAM_FILE_CHANGED',
    'The team file "' + relative + '" changed in the team storage since this clone was updated. Read it again before writing.',
    { path: relative, ...(reset === undefined ? {} : { reset }) },
  );
}

function publicationFailed(relative: string, code: string, reset: string, cause?: string): KanbanError {
  return new KanbanError(
    'TEAM_FILE_WRITE_FAILED',
    'The team file "' + relative + '" could not be published.',
    { path: relative, code, reset, ...(cause === undefined ? {} : { cause }) },
  );
}

/** A Git transport failure, reported in the team-file shape the tool contract names. */
function transportFailure(relative: string, error: unknown): KanbanError {
  if (error instanceof KanbanError && error.code.startsWith('TEAM_FILE_')) return error;
  const code = error instanceof KanbanError ? error.code : 'SHARING_FAILED';
  const cause = error instanceof Error ? error.message : String(error);
  return publicationFailed(relative, code, 'skipped', cause);
}

/**
 * A team files directory inside the plugin-managed clone. It composes the same
 * filesystem mechanics a folder binding uses with the clone's publication
 * protocol: fetch first, refuse a file the team changed, adopt the fetched head
 * so the push is a fast-forward, then commit and push immediately. A refused
 * push returns the clone to the fetched head, so the clone never keeps a commit
 * this installation did not publish.
 */
export class GitTeamFileStore implements TeamFileStore {
  private readonly clone: GitClone;
  private readonly directoryName: string;
  private readonly directoryStore: TeamFileDirectory;

  constructor(options: { clone: GitClone; directory?: string }) {
    this.clone = options.clone;
    this.directoryName = options.directory ?? TEAM_FILES_DIRECTORY;
    this.directoryStore = new TeamFileDirectory(path.join(options.clone.path, this.directoryName));
  }

  get path(): string { return this.directoryStore.path; }

  async ensure(): Promise<void> {
    await this.clone.ensure();
    await this.directoryStore.ensure();
  }

  async list(): Promise<TeamFileEntry[]> {
    await this.clone.ensure();
    return this.directoryStore.list();
  }

  async read(relative: string, options?: TeamFileReadOptions): Promise<TeamFileContent | null> {
    await this.clone.ensure();
    return this.directoryStore.read(relative, options);
  }

  async head(): Promise<string | undefined> {
    await this.clone.ensure();
    return (await this.clone.currentHead()) ?? undefined;
  }

  async create(relative: string, content: string): Promise<TeamFileWrite> {
    const base = await this.adoptFetchedBase(relative);
    await this.directoryStore.ensure();
    const written = await this.directoryStore.create(relative, content);
    const head = await this.publish([this.teamPath(relative)], 'create ' + this.teamPath(relative), base, false, relative);
    return { ...written, ...(head === undefined ? {} : { head }) };
  }

  async write(relative: string, content: string, options: TeamFileWriteOptions): Promise<TeamFileWrite> {
    const base = await this.adoptFetchedBase(relative);
    await this.directoryStore.ensure();
    const written = await this.directoryStore.write(relative, content);
    const head = await this.publish([this.teamPath(relative)], options.operation + ' ' + this.teamPath(relative), base, false, relative);
    return { ...written, ...(head === undefined ? {} : { head }) };
  }

  async move(from: string, to: string, options: TeamFileWriteOptions): Promise<{ path: string }> {
    const base = await this.adoptFetchedBase(from);
    const moved = await this.directoryStore.move(from, to);
    await this.publish([this.directoryName], options.operation + ' ' + this.teamPath(from), base, true, from);
    return { path: moved.path };
  }

  private teamPath(relative: string): string { return this.directoryName + '/' + relative; }

  /**
   * Fetch, compare the target with the clone's copy (the content the caller
   * read), and move the clone to the fetched head. Comparing first keeps the
   * refusal truthful; resetting afterwards makes the publish a fast-forward even
   * when unrelated files changed on the team side, and makes a refusal
   * recoverable because the next read sees the team's content.
   */
  private async adoptFetchedBase(relative: string): Promise<string | null> {
    let base: string | null;
    let remote: string | null;
    try {
      await this.clone.ensure();
      await this.clone.fetch();
      base = await this.clone.remoteHead();
      remote = base === null ? null : await this.clone.showFile(base, this.teamPath(relative));
    } catch (error) {
      // Every transport failure of the protocol reaches the caller in the
      // team-file shape, with the storage's own code preserved.
      throw transportFailure(relative, error);
    }
    const local = await this.directoryStore.read(relative, { maxBytes: TEAM_FILE_MAX_INPUT_BYTES });
    if (!sameFile(remote, local)) throw changed(relative, await this.tryReset(base));
    const reset = await this.tryReset(base);
    if (reset === 'failed') throw publicationFailed(relative, 'SHARING_FAILED', reset, 'The clone could not be brought to the fetched head.');
    return base;
  }

  private async tryReset(commit: string | null): Promise<'skipped' | 'done' | 'failed'> {
    if (commit === null) return 'skipped';
    try { await this.clone.resetHard(commit); return 'done'; }
    catch { return 'failed'; }
  }

  private async publish(paths: string[], message: string, base: string | null, all: boolean, relative: string): Promise<string | undefined> {
    const branch = await this.clone.branchName();
    try {
      await this.clone.commitPaths(paths, message, { all });
      await this.clone.push(branch);
    } catch (error) {
      // Surfaced, never swallowed: a failed rollback means the clone holds an
      // unpublished commit, which the caller must know about instead of being
      // handed an ordinary retryable refusal.
      const reset = await this.tryReset(base);
      const code = error instanceof KanbanError ? error.code : 'SHARING_FAILED';
      const cause = error instanceof Error ? error.message : String(error);
      if (reset !== 'failed' && error instanceof KanbanError && error.code === 'SHARING_STALE_TOKEN') throw changed(relative, reset);
      throw publicationFailed(relative, code, reset, cause);
    }
    return (await this.clone.currentHead()) ?? undefined;
  }
}

function sameFile(remote: string | null, local: TeamFileContent | null): boolean {
  if (remote === null) return local === null;
  if (local === null) return false;
  return Buffer.from(remote, 'utf8').equals(Buffer.from(local.bytes));
}
