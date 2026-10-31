import type { QuestionPage, QuestionRound, RoundPage } from '../shared/types.js';
import { KanbanError } from '../shared/errors.js';
import { validateQuestionPage } from './validation.js';

/** Structural input accepted by the published SDK's canonical SessionEvent union. */
export interface QuestionEvent { readonly type: string; readonly seq: number; readonly data: unknown }

export type ProjectionEvent =
  | { kind: 'call'; seq: number; turn: number; callId: string; name: string }
  | { kind: 'ptc-start'; seq: number; callId: string; rootCallId: string; parentCallId: string }
  | { kind: 'native-page'; seq: number; turn: number; callId: string; page: QuestionPage }
  | { kind: 'ptc-page'; seq: number; callId: string; rootCallId: string; parentCallId: string; page: QuestionPage }
  | { kind: 'end'; seq: number; turn: number }
  | { kind: 'human'; seq: number };

/** Minimal projection data only: no transcripts, tool arguments, or human message text. */
export interface QuestionIndexSnapshot {
  version: 1;
  sessions: Array<{ sessionId: string; events: ProjectionEvent[]; dismissedTurns?: number[] }>;
}

/** One conversation's durable projection record, independent of board or task state. */
export interface QuestionSessionRecord {
  version: 1;
  sessionId: string;
  events: ProjectionEvent[];
  dismissedTurns?: number[];
}

const EMPTY_ROUNDS: readonly QuestionRound[] = Object.freeze([]);
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function turnList(value: unknown, label: string): number[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(turn => !integer(turn))) throw new KanbanError('INVALID_QUESTION_INDEX', label + ' must be an array of nonnegative turn numbers.');
  const result = [...new Set(value)].sort((a, b) => a - b);
  if (result.length !== value.length) throw new KanbanError('INVALID_QUESTION_INDEX', label + ' must not contain duplicate turns.');
  return result;
}
function id(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function pageOf(meta: unknown): QuestionPage | undefined {
  if (!object(meta) || meta.kind !== 'kanban.question-page' || meta.version !== 1) return undefined;
  try { return validateQuestionPage(meta.page); } catch { return undefined; }
}

function normalize(event: QuestionEvent): ProjectionEvent | undefined {
  if (!event || !integer(event.seq) || !object(event.data)) return undefined;
  const d = event.data;
  switch (event.type) {
    case 'tool/call':
      if (integer(d.turn) && id(d.callId) && id(d.name)) return { kind: 'call', seq: event.seq, turn: d.turn, callId: d.callId, name: d.name };
      break;
    case 'tool/result': {
      const message = d.message;
      if (!integer(d.turn) || !object(message) || message.role !== 'tool' || message.isError === true || !id(message.toolCallId)) break;
      if (!object(message.source) || message.source.kind !== 'tool' || message.source.callId !== message.toolCallId) break;
      const page = pageOf(d.meta);
      if (page) return { kind: 'native-page', seq: event.seq, turn: d.turn, callId: message.toolCallId, page };
      break;
    }
    case 'tool/ptc-dispatch-start':
      if (id(d.subCallId) && id(d.rootCallId) && id(d.parentCallId)) return { kind: 'ptc-start', seq: event.seq, callId: d.subCallId, rootCallId: d.rootCallId, parentCallId: d.parentCallId };
      break;
    case 'tool/ptc-dispatch': {
      if (d.isError !== false || !id(d.subCallId) || !id(d.rootCallId) || !id(d.parentCallId)) break;
      const page = pageOf(d.meta);
      if (page) return { kind: 'ptc-page', seq: event.seq, callId: d.subCallId, rootCallId: d.rootCallId, parentCallId: d.parentCallId, page };
      break;
    }
    case 'turn/end':
      if (integer(d.turn)) return { kind: 'end', seq: event.seq, turn: d.turn };
      break;
    case 'user/message':
      // Runtime context and goal continuations are user-role messages, not human answers.
      if (d.role === 'user' && object(d.source) && d.source.kind === 'user') return { kind: 'human', seq: event.seq };
      break;
  }
  return undefined;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function copyEvent(value: unknown): ProjectionEvent {
  if (!object(value) || !integer(value.seq)) throw new KanbanError('INVALID_QUESTION_INDEX', 'Invalid question projection event.');
  const seq = value.seq;
  if (value.kind === 'human') return { kind: 'human', seq };
  if (value.kind === 'end' && integer(value.turn)) return { kind: 'end', seq, turn: value.turn };
  if (value.kind === 'call' && integer(value.turn) && id(value.callId) && id(value.name)) return { kind: 'call', seq, turn: value.turn, callId: value.callId, name: value.name };
  if (value.kind === 'native-page' && integer(value.turn) && id(value.callId)) return { kind: 'native-page', seq, turn: value.turn, callId: value.callId, page: validateQuestionPage(value.page) };
  if ((value.kind === 'ptc-start' || value.kind === 'ptc-page') && id(value.callId) && id(value.rootCallId) && id(value.parentCallId)) {
    const base = { seq, callId: value.callId, rootCallId: value.rootCallId, parentCallId: value.parentCallId };
    return value.kind === 'ptc-start' ? { kind: 'ptc-start', ...base } : { kind: 'ptc-page', ...base, page: validateQuestionPage(value.page) };
  }
  throw new KanbanError('INVALID_QUESTION_INDEX', 'Unknown or malformed question projection event.');
}

function buildRounds(sessionId: string, entries: Iterable<ProjectionEvent>, dismissedTurns: ReadonlySet<number> = new Set()): readonly QuestionRound[] {
  const events = [...entries].sort((a, b) => a.seq - b.seq);
  const calls = events.filter((e): e is Extract<ProjectionEvent, { kind: 'call' }> => e.kind === 'call');
  const starts = events.filter((e): e is Extract<ProjectionEvent, { kind: 'ptc-start' }> => e.kind === 'ptc-start');
  const ends = events.filter((e): e is Extract<ProjectionEvent, { kind: 'end' }> => e.kind === 'end');
  const humans = events.filter(e => e.kind === 'human');
  const rounds = new Map<number, { pages: Map<string, RoundPage>; latestResult: number; firstResult: number }>();
  for (const event of events) {
    if (event.kind !== 'native-page' && event.kind !== 'ptc-page') continue;
    let turn: number;
    let sequence: number;
    if (event.kind === 'native-page') {
      turn = event.turn;
      const call = calls.findLast(call => call.callId === event.callId && call.turn === turn && call.seq < event.seq);
      sequence = call?.seq ?? event.seq;
    } else {
      // A PTC settlement has no turn field. Only its actual native root call proves ownership.
      const root = calls.findLast(call => call.callId === event.rootCallId && call.seq < event.seq);
      if (!root || ends.some(end => end.turn === root.turn && end.seq > root.seq && end.seq < event.seq)) continue;
      const start = starts.findLast(start => start.callId === event.callId && start.seq < event.seq);
      if (start && (start.rootCallId !== event.rootCallId || start.parentCallId !== event.parentCallId)) continue;
      turn = root.turn;
      sequence = start?.seq ?? event.seq;
    }
    const round = rounds.get(turn) ?? { pages: new Map<string, RoundPage>(), latestResult: -1, firstResult: Number.POSITIVE_INFINITY };
    if (!round.pages.has(event.callId)) {
      round.pages.set(event.callId, { callId: event.callId, sequence, page: event.page });
      round.latestResult = Math.max(round.latestResult, event.seq);
      round.firstResult = Math.min(round.firstResult, event.seq);
    }
    rounds.set(turn, round);
  }
  return freeze([...rounds].filter(([turn]) => !dismissedTurns.has(turn)).map(([turn, round]): QuestionRound => ({
    id: 'question-round:' + sessionId + ':' + turn,
    sessionId,
    turnId: String(turn),
    pages: [...round.pages.values()].sort((a, b) => a.sequence - b.sequence || a.callId.localeCompare(b.callId)),
    complete: ends.some(end => end.turn === turn && end.seq > round.latestResult),
    // A free-text reply also retires a live round; late pages cannot resurrect it.
    answered: humans.some(human => human.seq > round.firstResult),
  })).sort((a, b) => Number(a.turnId) - Number(b.turnId)));
}

/** Canonical-event projection independent of native registration, storage, and presentation. */
export class QuestionIndex {
  private events = new Map<string, Map<number, ProjectionEvent>>();
  private dismissed = new Map<string, Set<number>>();
  private rounds = new Map<string, readonly QuestionRound[]>();
  private revisions = new Map<string, number>();
  private allRounds: readonly QuestionRound[] = EMPTY_ROUNDS;
  private listeners = new Set<() => void>();
  private disposed = false;

  constructor(snapshot?: unknown) { if (snapshot !== undefined) this.load(snapshot); }

  /** Returns whether new relevant canonical information was admitted. Replay duplicates are no-ops. */
  apply(sessionId: string, event: QuestionEvent): boolean {
    if (this.disposed || !id(sessionId)) return false;
    const entry = normalize(event);
    if (!entry) return false;
    const session = this.events.get(sessionId) ?? new Map<number, ProjectionEvent>();
    if (session.has(entry.seq)) return false;
    session.set(entry.seq, entry);
    this.events.set(sessionId, session);
    this.rebuild(sessionId);
    this.emit();
    return true;
  }

  /** Stable snapshots between changes, suitable for useSyncExternalStore consumers. */
  getRounds(sessionId?: string): readonly QuestionRound[] {
    return sessionId === undefined ? this.allRounds : this.rounds.get(sessionId) ?? EMPTY_ROUNDS;
  }

  /** Monotonic per-conversation projection revision; unrelated sessions never advance it. */
  revisionOf(sessionId: string): number { return this.revisions.get(sessionId) ?? 0; }

  /** Includes incomplete rounds while questions are still arriving; no native tool is blocked. */
  pending(sessionId?: string): boolean { return this.getRounds(sessionId).some(round => !round.answered && round.pages.length > 0); }

  /** Restore previously dismissed turns when a durable write could not be completed. */
  undismiss(sessionId: string, turns: readonly number[]): void {
    const dismissed = this.dismissed.get(sessionId);
    if (!dismissed) return;
    let changed = false;
    for (const turn of turns) if (dismissed.delete(turn)) changed = true;
    if (!changed) return;
    if (dismissed.size === 0) this.dismissed.delete(sessionId);
    this.rebuild(sessionId);
  }

  /** Permanently hide every supplied round in one conversation. Returns how many turns were newly dismissed. */
  dismiss(sessionId: string, roundIds: readonly string[]): number {
    if (this.disposed || !id(sessionId) || !Array.isArray(roundIds)) return 0;
    const prefix = 'question-round:' + sessionId + ':';
    const dismissed = new Set(this.dismissed.get(sessionId) ?? []);
    let added = 0;
    for (const roundId of roundIds) {
      if (typeof roundId !== 'string' || !roundId.startsWith(prefix)) continue;
      const turn = Number(roundId.slice(prefix.length));
      if (!Number.isSafeInteger(turn) || turn < 0 || dismissed.has(turn)) continue;
      dismissed.add(turn);
      added += 1;
    }
    if (added === 0) return 0;
    this.dismissed.set(sessionId, dismissed);
    this.rebuild(sessionId);
    this.emit();
    return added;
  }

  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  serialize(): QuestionIndexSnapshot {
    const sessionIds = new Set([...this.events.keys(), ...this.dismissed.keys()]);
    return { version: 1, sessions: [...sessionIds].sort((a, b) => a.localeCompare(b)).map(sessionId => {
      const dismissedTurns = this.dismissed.get(sessionId);
      return {
        sessionId,
        events: this.serializeEvents(sessionId),
        ...(dismissedTurns && dismissedTurns.size > 0 ? { dismissedTurns: [...dismissedTurns].sort((a, b) => a - b) } : {}),
      };
    }) };
  }

  /** One conversation's projection record, or undefined when it holds no events or dismissals. */
  serializeSession(sessionId: string): QuestionSessionRecord | undefined {
    const events = this.events.get(sessionId);
    const dismissedTurns = this.dismissed.get(sessionId);
    if ((!events || events.size === 0) && (!dismissedTurns || dismissedTurns.size === 0)) return undefined;
    return {
      version: 1,
      sessionId,
      events: this.serializeEvents(sessionId),
      ...(dismissedTurns && dismissedTurns.size > 0 ? { dismissedTurns: [...dismissedTurns].sort((a, b) => a - b) } : {}),
    };
  }

  /** Drop stored question-page payloads for dismissed turns while retaining call/end/human evidence. */
  private serializeEvents(sessionId: string): ProjectionEvent[] {
    const events = [...(this.events.get(sessionId)?.values() ?? [])].sort((a, b) => a.seq - b.seq);
    const dismissedTurns = this.dismissed.get(sessionId);
    if (!dismissedTurns || dismissedTurns.size === 0) return events.map(event => copyEvent(event));
    const calls = events.filter((event): event is Extract<ProjectionEvent, { kind: 'call' }> => event.kind === 'call');
    return events.filter(event => {
      if (event.kind === 'native-page') return !dismissedTurns.has(event.turn);
      if (event.kind === 'ptc-page') {
        const root = calls.findLast(call => call.callId === event.rootCallId);
        return root === undefined || !dismissedTurns.has(root.turn);
      }
      return true;
    }).map(event => copyEvent(event));
  }

  /**
   * Merge one durable record, validating every event before touching state.
   * Existing sequences win so canonical replay stays authoritative.
   */
  restoreSession(record: unknown): boolean {
    if (this.disposed) return false;
    if (!object(record) || record.version !== 1 || !id(record.sessionId) || !Array.isArray(record.events)) throw new KanbanError('INVALID_QUESTION_INDEX', 'Invalid question session record.');
    const sessionId = record.sessionId;
    const incoming = new Map<number, ProjectionEvent>();
    for (const stored of record.events) {
      const event = copyEvent(stored);
      if (incoming.has(event.seq)) throw new KanbanError('INVALID_QUESTION_INDEX', 'Duplicate question event sequence.');
      incoming.set(event.seq, event);
    }
    const restoredDismissed = turnList(record.dismissedTurns, 'dismissedTurns');
    const current = this.events.get(sessionId);
    const merged = current ? new Map(current) : new Map<number, ProjectionEvent>();
    let changed = false;
    for (const [seq, event] of incoming) if (!merged.has(seq)) { merged.set(seq, event); changed = true; }
    const dismissed = new Set(this.dismissed.get(sessionId) ?? []);
    for (const turn of restoredDismissed) if (!dismissed.has(turn)) { dismissed.add(turn); changed = true; }
    if (!changed) return false;
    this.events.set(sessionId, merged);
    if (dismissed.size > 0) this.dismissed.set(sessionId, dismissed);
    this.rebuild(sessionId);
    this.emit();
    return true;
  }

  /** Replace atomically with validated projection data; completeness is reconstructed from actual end records. */
  load(snapshot: unknown): void {
    if (this.disposed) return;
    if (!object(snapshot) || snapshot.version !== 1 || !Array.isArray(snapshot.sessions)) throw new KanbanError('INVALID_QUESTION_INDEX', 'Unsupported question index snapshot.');
    const next = new Map<string, Map<number, ProjectionEvent>>();
    const nextDismissed = new Map<string, Set<number>>();
    for (const value of snapshot.sessions) {
      if (!object(value) || !id(value.sessionId) || !Array.isArray(value.events) || next.has(value.sessionId)) throw new KanbanError('INVALID_QUESTION_INDEX', 'Invalid or duplicate question session.');
      const events = new Map<number, ProjectionEvent>();
      for (const stored of value.events) {
        const event = copyEvent(stored);
        if (events.has(event.seq)) throw new KanbanError('INVALID_QUESTION_INDEX', 'Duplicate question event sequence.');
        events.set(event.seq, event);
      }
      next.set(value.sessionId, events);
      const dismissed = turnList(value.dismissedTurns, 'dismissedTurns');
      if (dismissed.length > 0) nextDismissed.set(value.sessionId, new Set(dismissed));
    }
    this.events = next;
    this.dismissed = nextDismissed;
    this.rounds.clear();
    this.revisions.clear();
    this.allRounds = EMPTY_ROUNDS;
    for (const sessionId of new Set([...next.keys(), ...nextDismissed.keys()])) this.rebuild(sessionId);
    this.emit();
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.events.clear();
    this.dismissed.clear();
    this.rounds.clear();
    this.revisions.clear();
    this.allRounds = EMPTY_ROUNDS;
  }

  private rebuild(sessionId: string): void {
    this.rounds.set(sessionId, buildRounds(sessionId, this.events.get(sessionId)?.values() ?? [], this.dismissed.get(sessionId)));
    this.revisions.set(sessionId, (this.revisions.get(sessionId) ?? 0) + 1);
    this.allRounds = freeze([...this.rounds].sort(([a], [b]) => a.localeCompare(b)).flatMap(([, rounds]) => [...rounds]));
  }
  private emit(): void { for (const listener of [...this.listeners]) listener(); }
}
