import type { QuestionPage, QuestionRound, RoundPage } from '../shared/types.js';
import { KanbanError } from '../shared/errors.js';
import { validateQuestionPage } from './validation.js';

/** Structural input accepted by the published SDK's canonical SessionEvent union. */
export interface QuestionEvent { readonly type: string; readonly seq: number; readonly data: unknown }

type ProjectionEvent =
  | { kind: 'call'; seq: number; turn: number; callId: string; name: string }
  | { kind: 'ptc-start'; seq: number; callId: string; rootCallId: string; parentCallId: string }
  | { kind: 'native-page'; seq: number; turn: number; callId: string; page: QuestionPage }
  | { kind: 'ptc-page'; seq: number; callId: string; rootCallId: string; parentCallId: string; page: QuestionPage }
  | { kind: 'end'; seq: number; turn: number }
  | { kind: 'human'; seq: number };

/** Minimal projection data only: no transcripts, tool arguments, or human message text. */
export interface QuestionIndexSnapshot {
  version: 1;
  sessions: Array<{ sessionId: string; events: ProjectionEvent[] }>;
}

const EMPTY_ROUNDS: readonly QuestionRound[] = Object.freeze([]);
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
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

function buildRounds(sessionId: string, entries: Iterable<ProjectionEvent>): readonly QuestionRound[] {
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
  return freeze([...rounds].map(([turn, round]): QuestionRound => ({
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
  private rounds = new Map<string, readonly QuestionRound[]>();
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

  /** Includes incomplete rounds while questions are still arriving; no native tool is blocked. */
  pending(sessionId?: string): boolean { return this.getRounds(sessionId).some(round => !round.answered && round.pages.length > 0); }

  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  serialize(): QuestionIndexSnapshot {
    return { version: 1, sessions: [...this.events].sort(([a], [b]) => a.localeCompare(b)).map(([sessionId, events]) => ({
      sessionId, events: [...events.values()].sort((a, b) => a.seq - b.seq).map(event => copyEvent(event)),
    })) };
  }

  /** Replace atomically with validated projection data; completeness is reconstructed from actual end records. */
  load(snapshot: unknown): void {
    if (this.disposed) return;
    if (!object(snapshot) || snapshot.version !== 1 || !Array.isArray(snapshot.sessions)) throw new KanbanError('INVALID_QUESTION_INDEX', 'Unsupported question index snapshot.');
    const next = new Map<string, Map<number, ProjectionEvent>>();
    for (const value of snapshot.sessions) {
      if (!object(value) || !id(value.sessionId) || !Array.isArray(value.events) || next.has(value.sessionId)) throw new KanbanError('INVALID_QUESTION_INDEX', 'Invalid or duplicate question session.');
      const events = new Map<number, ProjectionEvent>();
      for (const stored of value.events) {
        const event = copyEvent(stored);
        if (events.has(event.seq)) throw new KanbanError('INVALID_QUESTION_INDEX', 'Duplicate question event sequence.');
        events.set(event.seq, event);
      }
      next.set(value.sessionId, events);
    }
    this.events = next;
    this.rounds.clear();
    this.allRounds = EMPTY_ROUNDS;
    for (const sessionId of next.keys()) this.rebuild(sessionId);
    this.emit();
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.events.clear();
    this.rounds.clear();
    this.allRounds = EMPTY_ROUNDS;
  }

  private rebuild(sessionId: string): void {
    this.rounds.set(sessionId, buildRounds(sessionId, this.events.get(sessionId)?.values() ?? []));
    this.allRounds = freeze([...this.rounds].sort(([a], [b]) => a.localeCompare(b)).flatMap(([, rounds]) => [...rounds]));
  }
  private emit(): void { for (const listener of [...this.listeners]) listener(); }
}
