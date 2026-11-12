import type { ConversationFacts, HubSharingView, KanbanState, SharingAuthView } from '../shared/types.js';
import type { HubRepository } from './hub-repository.js';
import type { GoogleDriveAuthCoordinator } from './sharing/auth-coordinator.js';

const DEFAULT_AUTH_TTL_MS = 5_000;

/** Execution authority and source references are host-private, never ordinary state. */
export function publicKanbanState(state: KanbanState): KanbanState {
  for (const hub of state.hubs) {
    for (const task of hub.tasks) delete task.deterministic;
    for (const board of hub.boards) delete board.localStageIdentities;
  }
  return state;
}

export interface SnapshotAssemblerOptions {
  hubs: Pick<HubRepository, 'snapshot'>;
  /** The team-sharing views for every Hub, when publishing is available. */
  sharing?: () => Record<string, HubSharingView>;
  sharingAuth?: GoogleDriveAuthCoordinator;
  authTtlMs?: number;
  now?: () => number;
  /** Called after a background authorization refresh so the caller can publish it. */
  onChange?: () => void;
  report?: (error: unknown) => void;
}

export interface SnapshotParts {
  state: KanbanState;
  stateRevision: number;
  conversations: Record<string, ConversationFacts>;
  sharing: Record<string, HubSharingView>;
  sharingAuth?: SharingAuthView;
}

/**
 * The sharing projection only reads board names, workflow documents, and task-column
 * counts. A stable signature of exactly those fields lets the assembler keep the cached
 * views across a state change that cannot alter them (an auto-mode flag, a task title).
 */
function sharingSignature(state: KanbanState): number {
  let hash = 2166136261;
  const mix = (value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 0x2c;
    hash = Math.imul(hash, 16777619);
  };
  for (const hub of state.hubs) {
    mix(hub.id);
    for (const board of hub.boards) mix(board.id + board.name + board.workflowYaml);
    const counts = new Map<string, number>();
    for (const task of hub.tasks) counts.set(task.boardId + ':' + task.columnId, (counts.get(task.boardId + ':' + task.columnId) ?? 0) + 1);
    for (const [key, count] of [...counts].sort(([left], [right]) => left.localeCompare(right))) mix(key + count);
  }
  return hash;
}

/**
 * Composes one snapshot from independently cached parts. The Hub state is cached until
 * a repository change bumps its revision, team-sharing views until the sharing state
 * changes or the sharing projection changes, and the authorization view until it is
 * explicitly refreshed or its background refresh completes. No part of this collaborator
 * reads Session history, and no snapshot call blocks on a stale authorization view.
 */
export class SnapshotAssembler {
  private stateCache: KanbanState | undefined;
  private revision = 0;
  private sharingCache: Record<string, HubSharingView> | undefined;
  private sharingKey: number | undefined;
  private authCache: SharingAuthView | undefined;
  private authAt = Number.NEGATIVE_INFINITY;
  private authRefresh: Promise<void> | undefined;
  private authRefreshGeneration = -1;
  private authGeneration = 0;
  private authQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: SnapshotAssemblerOptions) {}

  /** The repository changed: recompute the state and bump its revision. */
  invalidateState(): void {
    this.stateCache = undefined;
    this.revision += 1;
  }

  /** The authorization surface changed outside a command; the next snapshot re-reads it. */
  invalidateAuth(): void {
    this.authGeneration += 1;
    this.authCache = undefined;
    this.authAt = Number.NEGATIVE_INFINITY;
  }

  /** Only the publishing state changed. */
  invalidateSharing(): void {
    this.sharingCache = undefined;
    this.sharingKey = undefined;
  }

  async assemble(conversations: Record<string, ConversationFacts>, options: { refreshAuth?: boolean; allowAuthRefresh?: boolean } = {}): Promise<SnapshotParts> {
    // Await the authorization view first: the state and its revision must be captured
    // together, after that await, or a Hub write during the await would label the old
    // state with the new revision and the client would never receive the new state.
    const sharingAuth = await this.auth(options.refreshAuth === true, options.allowAuthRefresh !== false);
    const state = this.stateCache ??= publicKanbanState(this.options.hubs.snapshot());
    const stateRevision = this.revision;
    const key = sharingSignature(state);
    if (this.sharingCache === undefined || this.sharingKey !== key) {
      this.sharingCache = this.options.sharing?.() ?? {};
      this.sharingKey = key;
    }
    return {
      state,
      stateRevision,
      conversations,
      sharing: this.sharingCache,
      ...(sharingAuth === undefined ? {} : { sharingAuth }),
    };
  }

  private async auth(force: boolean, allowRefresh = true): Promise<SharingAuthView | undefined> {
    const auth = this.options.sharingAuth;
    if (auth === undefined) return undefined;
    if (this.authCache === undefined || force) {
      // A command response must not trigger an authorization read; it reports the
      // cached view (or omits it) and the next publication settles it.
      if (!allowRefresh && !force) return this.authCache;
      await this.refreshAuth(auth);
      return this.authCache;
    }
    if (!allowRefresh) return this.authCache;
    const now = (this.options.now ?? Date.now)();
    const ttl = this.options.authTtlMs ?? DEFAULT_AUTH_TTL_MS;
    if (now - this.authAt >= ttl && this.authRefresh === undefined) {
      // Stale is good enough for a snapshot: refresh in the background and publish it
      // instead of making every card command wait for a credential-store read.
      void this.refreshAuth(auth)
        .then(() => { this.invalidateSharing(); this.options.onChange?.(); })
        .catch(error => this.options.report?.(error));
    }
    return this.authCache;
  }

  private refreshAuth(auth: GoogleDriveAuthCoordinator): Promise<void> {
    // Join only a refresh from the current authorization generation. An OAuth or
    // disconnect event bumps the generation, so a pre-event read cannot satisfy the
    // next snapshot or overwrite the new view when it completes.
    if (this.authRefresh !== undefined && this.authRefreshGeneration === this.authGeneration) return this.authRefresh;
    const generation = this.authGeneration;
    // Physical refreshes are serialized: the coordinator owns mutable state, so an old
    // read that finishes last must never overwrite a newer status. A queued run whose
    // generation was superseded skips; the newer queued run refreshes the current state.
    const run = this.authQueue.then(async () => {
      if (generation !== this.authGeneration) return;
      await auth.refresh();
      if (generation !== this.authGeneration) return;
      this.authCache = auth.view();
      this.authAt = (this.options.now ?? Date.now)();
    });
    this.authQueue = run.catch(() => undefined);
    const tracked = run.finally(() => {
      if (this.authRefresh === tracked) {
        this.authRefresh = undefined;
        this.authRefreshGeneration = -1;
      }
    });
    this.authRefresh = tracked;
    this.authRefreshGeneration = generation;
    return tracked;
  }
}
