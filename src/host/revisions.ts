import type { RevisionActor, RevisionBaseline, RevisionOrigin, BoardRevisionLog, RevisionCommit } from '../domain/revisions/log.js';
import { appendRevision, commitOf, createRevisionLog, headText, revisionOf, textAtRevision } from '../domain/revisions/log.js';
import type { RevisionStore } from './revision-storage.js';

/** One write the revision log records, with the document it replaced. */
export interface RevisionRecordInput {
  readonly hubId: string;
  readonly boardId: string;
  /** The document before the write; null when the board is being created. */
  readonly previous: string | null;
  readonly next: string;
  readonly actor: RevisionActor;
  readonly origin: RevisionOrigin;
}

/** One revision as a reader sees it. */
export interface RevisionView {
  /** The revision identity: its position in the board's whole history, stable across folding. */
  readonly revision: number;
  readonly at: string;
  readonly actor: RevisionActor;
  readonly origin: RevisionOrigin;
  readonly summary: string;
}

/** One page of a board's revisions. */
export interface RevisionList {
  readonly revisions: readonly RevisionView[];
  /** How many older revisions the log no longer holds. */
  readonly olderNotRetained: number;
  /** Where the retained history starts, and whether that start is the board's creation. */
  readonly historyStarts: RevisionBaseline;
  /** The revision a follow-up page starts after. */
  readonly nextBefore?: number;
}

export interface BoardRevisionsOptions {
  readonly store: RevisionStore;
  readonly now?: () => string;
  readonly report?: (error: unknown) => void;
  /** How many revisions one listing returns when the caller names none. */
  readonly pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 200;

function view(commit: RevisionCommit, revision: number): RevisionView {
  return { revision, at: commit.at, actor: commit.actor, origin: commit.origin, summary: commit.summary };
}

/**
 * One board's local revision log.
 *
 * Writes are recorded after the workflow it describes was committed, serialized
 * per board so two writes cannot read the same head and drop one another. A
 * recording failure is reported and never rolls back the write it describes: a
 * missing revision is the only loss, an invented one is never possible.
 */
export class BoardRevisions {
  private readonly tails = new Map<string, Promise<void>>();

  constructor(private readonly options: BoardRevisionsOptions) {}

  private serial<T>(key: string, run: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(run, run);
    this.tails.set(key, result.then(() => undefined, () => undefined));
    return result;
  }

  private now(): string {
    return this.options.now?.() ?? new Date().toISOString();
  }

  async record(input: RevisionRecordInput): Promise<void> {
    await this.serial(input.hubId + '/' + input.boardId, async () => {
      const existing = await this.options.store.load(input.boardId);
      const at = this.now();
      if (existing === undefined) {
        if (input.previous === null) {
          // A board created now starts its own history; nothing was lost.
          const created = createRevisionLog({ hubId: input.hubId, boardId: input.boardId, text: input.next, at, baseline: { kind: 'created', at } });
          await this.options.store.save({ ...created, commits: [{ from: 0, to: 0, at, actor: input.actor, origin: input.origin, summary: 'Created the board workflow.' }] });
          return;
        }
        // A board that already holds a document has a history this installation never saw.
        // Recording the first write as its creation would be a lie.
        const seeded = createRevisionLog({ hubId: input.hubId, boardId: input.boardId, text: input.previous, at, baseline: { kind: 'recovered', at } });
        await this.options.store.save(appendRevision(seeded, { text: input.next, at, actor: input.actor, origin: input.origin }));
        return;
      }
      await this.options.store.save(appendRevision(existing, { text: input.next, at, actor: input.actor, origin: input.origin }));
    });
  }

  /** The whole log one board holds, when it has one. */
  async read(boardId: string): Promise<BoardRevisionLog | undefined> {
    return this.options.store.load(boardId);
  }

  /** The document the most recent recorded write replaced, when the log retains it. */
  async previousText(boardId: string): Promise<string | undefined> {
    const log = await this.options.store.load(boardId);
    if (log === undefined || log.commits.length < 2) return undefined;
    return textAtRevision(log, revisionOf(log, log.commits.length - 2));
  }

  /** The document a retained revision holds, by its stable revision identity. */
  async textAt(boardId: string, revision: number): Promise<string | undefined> {
    const log = await this.options.store.load(boardId);
    if (log === undefined || commitOf(log, revision) === undefined) return undefined;
    return textAtRevision(log, revision);
  }

  /** What the board holds now. */
  async current(boardId: string): Promise<string | undefined> {
    const log = await this.options.store.load(boardId);
    return log === undefined ? undefined : headText(log);
  }

  async list(boardId: string, options: { readonly limit?: number; readonly before?: number } = {}): Promise<RevisionList> {
    const log = await this.options.store.load(boardId);
    if (log === undefined) return { revisions: [], olderNotRetained: 0, historyStarts: { kind: 'created', at: this.now() } };
    const numbered = log.commits.map((commit, index) => ({ commit, revision: revisionOf(log, index) }));
    const newestFirst = [...numbered].reverse();
    const remaining = options.before === undefined ? newestFirst : newestFirst.filter(entry => entry.revision < options.before!);
    const limit = Math.min(Math.max(options.limit ?? this.options.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const page = remaining.slice(0, limit);
    return {
      revisions: page.map(entry => view(entry.commit, entry.revision)),
      olderNotRetained: log.dropped,
      // A log written before baselines existed reads as recovered, never as a creation
      // this installation cannot prove.
      historyStarts: log.baseline ?? { kind: 'recovered', at: page[page.length - 1]?.commit.at ?? this.now() },
      ...(remaining.length > page.length ? { nextBefore: page[page.length - 1]!.revision } : {}),
    };
  }

  /**
   * Append a recovery revision when the stored workflow no longer matches the log
   * head, so a history never continues from a document it no longer describes.
   */
  async reconcile(input: { readonly hubId: string; readonly boardId: string; readonly storedText: string }): Promise<void> {
    await this.serial(input.hubId + '/' + input.boardId, async () => {
      const log = await this.options.store.load(input.boardId);
      if (log === undefined || headText(log) === input.storedText) return;
      const at = this.now();
      await this.options.store.save(appendRevision(log, { text: input.storedText, at, actor: { kind: 'operator' }, origin: 'recovery' }));
    });
  }

  /** Remove one board's log, or every log a Hub held. */
  async remove(boardId: string): Promise<void> { await this.options.store.delete(boardId); }
  async removeHub(hubId: string): Promise<void> { await this.options.store.deleteHub(hubId); }
}
