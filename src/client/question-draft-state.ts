import type { QuestionDraftContent, StoredQuestionDraft } from '../shared/types.js';

/** One queued draft write; a null draft clears the round's stored draft. */
export interface QuestionDraftSaveRequest {
  sessionId: string;
  roundId: string;
  draft: QuestionDraftContent | null;
}

/** The write side of the draft transport; the bridge owns the remote call. */
export interface QuestionDraftTransport {
  save(request: QuestionDraftSaveRequest): Promise<unknown>;
}

/** The dock-facing draft surface: restore a round's draft and report changes. */
export interface QuestionDraftPort {
  read(roundId: string): StoredQuestionDraft | undefined;
  update(sessionId: string, roundId: string, draft: QuestionDraftContent): void;
  clear(sessionId: string, roundId: string): void;
  flush(): void;
}

export interface QuestionDraftStateOptions {
  transport: QuestionDraftTransport;
  /** Coalescing window for one round's writes. */
  delayMs?: number;
  now?: () => string;
  /** Reported, never thrown: a draft write is best effort. */
  report?: (error: unknown) => void;
}

export const QUESTION_DRAFT_SAVE_DELAY_MS = 400;

interface Entry { sessionId: string; draft: StoredQuestionDraft }

function copyContent(draft: QuestionDraftContent): QuestionDraftContent {
  const answers: QuestionDraftContent['answers'] = {};
  for (const [callId, answer] of Object.entries(draft.answers)) {
    answers[callId] = { choices: [...answer.choices], text: answer.text, other: answer.other, notes: answer.notes };
  }
  return { answers, generalNotes: draft.generalNotes, active: draft.active === null ? null : { ...draft.active } };
}
function copyStored(draft: StoredQuestionDraft): StoredQuestionDraft {
  return { ...copyContent(draft), updatedAt: draft.updatedAt };
}

/**
 * One cache of conversation-scoped question drafts, hydrated from the round feed
 * baseline and written back through a debounced transport. A round edited locally
 * is never overwritten by a later hydration, and every write is best effort: a
 * failed save is reported and the in-memory draft remains authoritative until the
 * surface unmounts.
 */
export class QuestionDraftState {
  private readonly drafts = new Map<string, Entry>();
  /** Rounds written locally since the page started; hydration must not overwrite them. */
  private readonly local = new Set<string>();
  private readonly pending = new Map<string, QuestionDraftSaveRequest>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private disposed = false;

  constructor(private readonly options: QuestionDraftStateOptions) {}

  /** Restore one conversation's drafts; a locally edited round keeps its local value. */
  hydrate(sessionId: string, drafts: Readonly<Record<string, StoredQuestionDraft>>): void {
    if (this.disposed) return;
    for (const [roundId, draft] of Object.entries(drafts)) {
      if (this.local.has(roundId)) continue;
      this.drafts.set(roundId, { sessionId, draft: copyStored(draft) });
    }
  }

  /** The restored draft of one round, or undefined when nothing was stored. */
  read(roundId: string): StoredQuestionDraft | undefined {
    const entry = this.drafts.get(roundId);
    return entry === undefined ? undefined : copyStored(entry.draft);
  }

  /** Record a draft change and coalesce its transport write. */
  update(sessionId: string, roundId: string, draft: QuestionDraftContent): void {
    if (this.disposed) return;
    const content = copyContent(draft);
    this.drafts.set(roundId, { sessionId, draft: { ...content, updatedAt: this.now() } });
    this.local.add(roundId);
    this.schedule({ sessionId, roundId, draft: content });
  }

  /** Drop one round's draft locally and clear it on the host. */
  clear(sessionId: string, roundId: string): void {
    if (this.disposed) return;
    this.drafts.delete(roundId);
    this.local.add(roundId);
    this.cancel(roundId);
    this.send({ sessionId, roundId, draft: null });
  }

  /**
   * Drop the drafts of one conversation whose rounds are no longer presented, keeping
   * the drafts of rounds that remain unresolved (a stale dismissal can preserve them).
   */
  retainSession(sessionId: string, roundIds: readonly string[]): void {
    if (this.disposed) return;
    const keep = new Set(roundIds);
    for (const [roundId, entry] of [...this.drafts]) {
      if (entry.sessionId !== sessionId || keep.has(roundId)) continue;
      this.drafts.delete(roundId);
      this.local.add(roundId);
      this.cancel(roundId);
    }
    for (const write of [...this.pending.values()]) {
      if (write.sessionId === sessionId && !keep.has(write.roundId)) this.cancel(write.roundId);
    }
  }

  /** Drop local copies of rounds the host has retired (answered). */
  retire(roundIds: readonly string[]): void {
    if (this.disposed) return;
    for (const roundId of roundIds) {
      // Retiring is final: a baseline produced before the answer must not resurrect it.
      this.drafts.delete(roundId);
      this.local.add(roundId);
      this.cancel(roundId);
    }
  }

  /** Send every queued write now, for unmount and pagehide. */
  flush(): void {
    for (const write of [...this.pending.values()]) this.send(write);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear(); this.pending.clear(); this.drafts.clear(); this.local.clear();
  }

  private now(): string { return (this.options.now ?? (() => new Date().toISOString()))(); }

  private schedule(write: QuestionDraftSaveRequest): void {
    this.pending.set(write.roundId, write);
    const existing = this.timers.get(write.roundId);
    if (existing !== undefined) clearTimeout(existing);
    this.timers.set(write.roundId, setTimeout(() => this.send(write), this.options.delayMs ?? QUESTION_DRAFT_SAVE_DELAY_MS));
  }

  private cancel(roundId: string): void {
    this.pending.delete(roundId);
    const timer = this.timers.get(roundId);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.timers.delete(roundId);
  }

  private send(write: QuestionDraftSaveRequest): void {
    this.pending.delete(write.roundId);
    const timer = this.timers.get(write.roundId);
    if (timer !== undefined) { clearTimeout(timer); this.timers.delete(write.roundId); }
    if (this.disposed) return;
    void this.options.transport.save(write).catch(error => this.options.report?.(error));
  }
}
