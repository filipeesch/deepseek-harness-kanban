import { randomUUID } from 'node:crypto';
import { KanbanError } from '../shared/errors.js';

/**
 * One reviewed candidate a conversation may apply.
 *
 * The snapshot is immutable: it carries the exact bytes, the base it was composed
 * from, the Hub revision that base was read at, and the digest of the candidate.
 * Nothing in it points at live board state, so a later read cannot substitute the
 * current document for the previewed one.
 */
export interface WorkflowPreviewSnapshot {
  readonly id: string;
  /** The conversation that created it; another conversation cannot read or apply it. */
  readonly conversationId: string;
  readonly hubId: string;
  readonly boardId: string;
  /** The Hub revision the base document was read at. */
  readonly hubRevision: number;
  readonly baseSha256: string;
  /** The SHA-256 of the candidate UTF-8 bytes. */
  readonly sha256: string;
  /** The exact candidate document. */
  readonly candidate: string;
  /** The textual diff from the exact base to the candidate. */
  readonly diff: string;
  /** The reviewed report exactly as it was shaped for the caller. */
  readonly reportText: string;
  /** The reviewed card impact exactly as it was computed. */
  readonly impactText: string;
  /** How many structured operations produced the candidate. */
  readonly operations: number;
  readonly createdAt: number;
}

export interface WorkflowPreviewStoreOptions {
  /** How long an unused preview is retrievable. */
  readonly ttlMs?: number;
  /** How many previews one conversation may hold; the oldest is dropped first. */
  readonly maxPerConversation?: number;
  /** How many previews the process retains at all. */
  readonly maxEntries?: number;
  readonly now?: () => number;
  readonly id?: () => string;
}

/** How long a preview stays retrievable unless the composition overrides it. */
export const PREVIEW_TTL_MS = 30 * 60 * 1000;
/** How many previews one conversation keeps unless the composition overrides it. */
export const PREVIEWS_PER_CONVERSATION = 5;
/** How many previews the process keeps unless the composition overrides it. */
export const PREVIEWS_TOTAL = 20;

/**
 * The bounded, expiring, conversation-scoped previews an architect may apply.
 *
 * The store is memory only: previewing writes no board, no revision, no task, and
 * no publication. A restart therefore forgets every preview, which is what makes a
 * preview handle safe to treat as an opaque review artifact rather than a draft.
 */
export class WorkflowPreviewStore {
  private readonly previews = new Map<string, WorkflowPreviewSnapshot>();

  constructor(private readonly options: WorkflowPreviewStoreOptions = {}) {}

  private get now(): number { return (this.options.now ?? Date.now)(); }
  private get ttl(): number { return this.options.ttlMs ?? PREVIEW_TTL_MS; }
  private get perConversation(): number { return Math.max(1, this.options.maxPerConversation ?? PREVIEWS_PER_CONVERSATION); }
  private get total(): number { return Math.max(1, this.options.maxEntries ?? PREVIEWS_TOTAL); }

  /** Drop every preview that outlived its retention, oldest first. */
  private prune(): void {
    const expired = this.now - this.ttl;
    for (const [id, preview] of this.previews) {
      if (preview.createdAt <= expired) this.previews.delete(id);
    }
    while (this.previews.size >= this.total) {
      const oldest = this.previews.keys().next();
      if (oldest.done === true) break;
      this.previews.delete(oldest.value);
    }
  }

  /**
   * Keep one reviewed candidate and return it with its opaque identity. The oldest
   * preview of the same conversation goes first once that conversation holds its
   * bound, so a long session cannot accumulate candidates.
   */
  keep(input: Omit<WorkflowPreviewSnapshot, 'id' | 'createdAt'>): WorkflowPreviewSnapshot {
    this.prune();
    const held = [...this.previews.values()].filter(preview => preview.conversationId === input.conversationId);
    while (held.length >= this.perConversation) {
      const oldest = held.shift();
      if (oldest !== undefined) this.previews.delete(oldest.id);
    }
    const preview: WorkflowPreviewSnapshot = { ...input, id: (this.options.id ?? randomUUID)(), createdAt: this.now };
    this.previews.set(preview.id, preview);
    return preview;
  }

  /**
   * The exact preview a conversation holds. An unknown, expired, or foreign handle
   * is refused with the reason, and a foreign one is left in place for its owner.
   */
  get(id: string, conversationId: string): WorkflowPreviewSnapshot {
    const preview = this.previews.get(id);
    if (preview === undefined) {
      throw new KanbanError('PREVIEW_NOT_FOUND', 'The preview does not exist or was already dropped. Create a new preview.');
    }
    if (preview.conversationId !== conversationId) {
      throw new KanbanError('PREVIEW_NOT_OWNED', 'The preview was created by another conversation; a preview is readable and applicable only where it was created.');
    }
    if (preview.createdAt <= this.now - this.ttl) {
      this.previews.delete(id);
      throw new KanbanError('PREVIEW_EXPIRED', 'The preview expired. Create a new preview and review it before applying.');
    }
    return preview;
  }

  /** How many previews the store currently holds, for a test or a diagnostic. */
  get size(): number { return this.previews.size; }
}
