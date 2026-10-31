import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots';
import type { Problem, QuestionFeedFrame, QuestionRound } from '../shared/types.js';

/** One conversation's supervised question projection. Opening returns its close handle. */
export interface QuestionFeedPort {
  open(sessionId: string, onFrame: (frame: QuestionFeedFrame) => void, onError: (problem: Problem) => void): () => void;
}
/** The host-owned dismissal command, kept separate so the cache does not know the transport. */
export interface QuestionDismissPort {
  dismiss(sessionId: string, roundId: string): Promise<readonly QuestionRound[]>;
}
export interface QuestionRoundView {
  rounds: readonly QuestionRound[];
  errors: ReadonlyMap<string, Problem>;
}
export interface QuestionRoundCacheOptions {
  feed: QuestionFeedPort;
  dismissal: QuestionDismissPort;
}

const EMPTY_VIEW: QuestionRoundView = Object.freeze({ rounds: Object.freeze([]), errors: new Map() });

function observable<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  const source: HostObservable<T> = {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  return {
    source,
    set(next: T) { if (Object.is(value, next)) return; value = next; for (const listener of [...listeners]) { try { listener(); } catch { /* One consumer cannot take down other native surfaces. */ } } },
    clear() { listeners.clear(); },
  };
}

function problemOf(error: unknown): Problem {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return {
      code: 'code' in error && typeof error.code === 'string' ? error.code : 'CLIENT_ERROR',
      message: String(error.message),
    };
  }
  return { code: 'CLIENT_ERROR', message: String(error) };
}

function ordered(rounds: readonly QuestionRound[]): readonly QuestionRound[] {
  return [...rounds].sort((left, right) =>
    left.sessionId.localeCompare(right.sessionId)
    || Number(left.turnId) - Number(right.turnId)
    || left.id.localeCompare(right.id));
}

/**
 * Owns every conversation's question rounds, the optimistic submission suppression,
 * dismissals, and feed errors. Transport and host commands arrive through ports.
 */
interface Submission { sessionId: string; settled: boolean; present: boolean }
export class QuestionRoundCache {
  private readonly state = observable<QuestionRoundView>(EMPTY_VIEW);
  readonly view = this.state.source;
  private rounds: readonly QuestionRound[] = [];
  private errors = new Map<string, Problem>();
  private readonly refs = new Map<string, number>();
  private readonly closers = new Map<string, () => void>();
  private readonly generations = new Map<string, number>();
  private readonly dismissed = new Set<string>();
  private readonly submitted = new Map<string, Submission>();
  private focused: string | undefined;
  private disposed = false;

  constructor(private readonly options: QuestionRoundCacheOptions) {}

  /** Start tracking a conversation; each call returns its own idempotent release. */
  track(sessionId: string): () => void {
    if (this.disposed) return () => {};
    const count = (this.refs.get(sessionId) ?? 0) + 1;
    this.refs.set(sessionId, count);
    if (count === 1) this.open(sessionId);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = this.refs.get(sessionId) ?? 0;
      if (current <= 1) { this.refs.delete(sessionId); this.close(sessionId); }
      else this.refs.set(sessionId, current - 1);
    };
  }

  /** Reopen a failed feed without dropping the rounds already shown; untracked sessions stay closed. */
  retry(sessionId: string): void {
    if (this.disposed || !this.refs.has(sessionId)) return;
    this.open(sessionId);
  }

  isSubmitted(roundId: string): boolean { return this.submitted.has(roundId); }

  /** The round a failed admission wants back on screen, ahead of newer rounds. */
  get focusedRoundId(): string | undefined { return this.focused; }

  /** Mark a valid submission before admission settles; the feed confirms it later. */
  submit(roundId: string): void {
    if (this.disposed) return;
    const round = this.rounds.find(candidate => candidate.id === roundId);
    if (!round) return;
    this.submitted.set(roundId, { sessionId: round.sessionId, settled: false, present: true });
    if (this.focused === roundId) this.focused = undefined;
    this.publish();
  }

  /**
   * Mark the admission accepted. If the feed already dropped the round while the
   * admission was in flight, the drop is the confirmation; otherwise suppression
   * waits for an answered frame.
   */
  settle(roundId: string): void {
    if (this.disposed) return;
    const entry = this.submitted.get(roundId);
    if (!entry) return;
    entry.settled = true;
    if (!entry.present) {
      this.submitted.delete(roundId);
      this.rounds = this.rounds.filter(round => round.id !== roundId);
      if (this.focused === roundId) this.focused = undefined;
    }
    this.publish();
  }

  /** Restore a round whose admission failed; its mounted form keeps the draft. */
  rollback(roundId: string): void {
    if (this.disposed) return;
    if (this.submitted.delete(roundId)) this.focused = roundId;
    this.publish();
  }

  /** Dismiss the displayed round and every unresolved round in that conversation. */
  async dismiss(sessionId: string, roundId: string): Promise<readonly QuestionRound[]> {
    if (this.disposed) return [];
    const unresolved = this.rounds.filter(round => round.sessionId === sessionId && !round.answered).map(round => round.id);
    let remaining: readonly QuestionRound[];
    let missing = false;
    try {
      remaining = await this.options.dismissal.dismiss(sessionId, roundId);
    } catch (error) {
      if ((error as { code?: unknown }).code !== 'QUESTION_ROUND_NOT_FOUND') throw error;
      // The displayed round was already answered or dismissed elsewhere. Do not hide
      // unrelated unresolved rounds that the host did not actually dismiss.
      missing = true;
      remaining = this.rounds.filter(round => round.sessionId === sessionId && round.id !== roundId);
    }
    if (this.disposed) return [];
    if (!missing) for (const id of unresolved) { this.dismissed.add(id); this.submitted.delete(id); }
    this.dismissed.add(roundId);
    this.submitted.delete(roundId);
    if (this.focused === roundId) this.focused = undefined;
    this.rounds = ordered([...this.rounds.filter(round => round.sessionId !== sessionId), ...remaining.filter(round => !this.dismissed.has(round.id))]);
    this.errors.delete(sessionId);
    this.publish();
    return this.rounds.filter(round => round.sessionId === sessionId);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const close of this.closers.values()) close();
    this.closers.clear(); this.refs.clear(); this.generations.clear(); this.dismissed.clear(); this.submitted.clear();
    this.focused = undefined; this.rounds = []; this.errors = new Map();
    this.state.set(EMPTY_VIEW); this.state.clear();
  }

  private open(sessionId: string): void {
    // Closing first invalidates any frame still in flight from the previous stream.
    this.close(sessionId);
    const generation = this.generations.get(sessionId) ?? 0;
    try {
      this.closers.set(sessionId, this.options.feed.open(
        sessionId,
        frame => { if (this.generations.get(sessionId) === generation) this.apply(sessionId, frame); },
        error => { if (this.generations.get(sessionId) === generation) this.fail(sessionId, error); },
      ));
    } catch (error) {
      this.closers.delete(sessionId);
      this.fail(sessionId, problemOf(error));
    }
    this.publish();
  }

  private close(sessionId: string): void {
    const close = this.closers.get(sessionId);
    this.closers.delete(sessionId);
    this.generations.set(sessionId, (this.generations.get(sessionId) ?? 0) + 1);
    close?.();
    this.errors.delete(sessionId);
  }

  private apply(sessionId: string, frame: QuestionFeedFrame): void {
    if (this.disposed) return;
    const incoming = frame.rounds;
    for (const [roundId, entry] of [...this.submitted]) {
      if (entry.sessionId !== sessionId) continue;
      const round = incoming.find(candidate => candidate.id === roundId);
      // An answered projection confirms the submission. Absence only confirms it
      // after admission settled; before that the local round must survive a rollback.
      if (round?.answered) { this.submitted.delete(roundId); if (this.focused === roundId) this.focused = undefined; continue; }
      entry.present = round !== undefined;
      if (entry.settled && !entry.present) { this.submitted.delete(roundId); if (this.focused === roundId) this.focused = undefined; }
    }
    const kept = this.rounds.filter(round => round.sessionId === sessionId
      && this.submitted.has(round.id)
      && !this.dismissed.has(round.id)
      && !incoming.some(candidate => candidate.id === round.id));
    const next = ordered([...this.rounds.filter(round => round.sessionId !== sessionId), ...incoming.filter(round => !this.dismissed.has(round.id)), ...kept]);
    this.rounds = next;
    this.errors.delete(sessionId);
    this.publish();
  }

  private fail(sessionId: string, error: Problem): void {
    if (this.disposed) return;
    this.errors.set(sessionId, error);
    this.publish();
  }

  private publish(): void {
    this.state.set({ rounds: this.rounds, errors: this.errors });
  }
}
