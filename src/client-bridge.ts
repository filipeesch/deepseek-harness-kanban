import { RemoteSnapshotStream, RemoteStreamCarrierError, type ClientRemote } from '@deepseek-ai/dsh-api-gateway/client';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots';
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client';
import type { KanbanRemote } from './remote.js';
import type { ClientApi, Command, KanbanSnapshot, Outcome, Problem, QuestionRound, Task } from './shared/types.js';
import { projectTaskAttention, ReminderTracker } from './client/attention.js';

export interface BridgeStatus { error: Problem | null; connected: boolean }
export interface QuestionView { rounds: readonly QuestionRound[]; errors: ReadonlyMap<string, Problem> }
export type BridgeRemote = Pick<ClientRemote, '$stream'> & { kanban: KanbanRemote };
type Baseline = { kind: 'baseline'; snapshot: KanbanSnapshot };
function allTasks(snapshot: KanbanSnapshot): Task[] { return snapshot.state.hubs.flatMap(hub => hub.tasks); }
type Update = { kind: 'update'; snapshot: KanbanSnapshot };
function problem(error: unknown): Problem {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return { code: 'code' in error && typeof error.code === 'string' ? error.code : 'CLIENT_ERROR', message: String(error.message) };
  }
  return { code: 'CLIENT_ERROR', message: String(error) };
}
/** Native transport result wraps the plugin's independent business Outcome. Unwrap BOTH. */
export function unwrap<T>(result: RemoteResult<Outcome<T>>): T {
  if (!result.ok) throw result.error;
  if (!result.value.ok) throw Object.assign(new Error(result.value.error.message), result.value.error);
  return result.value.value;
}
function observable<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  const source: HostObservable<T> = { getSnapshot: () => value, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  return { source, set(next: T) { value = next; for (const listener of [...listeners]) { try { listener(); } catch { /* One consumer cannot take down other native surfaces. */ } } }, clear() { listeners.clear(); } };
}
/** One plugin-owned native feed; ordinary chats and Kanban share the same prepared question cache. */
export class ClientBridge {
  private readonly health = observable<BridgeStatus>({ error: null, connected: false });
  readonly status = this.health.source;
  private readonly questionState = observable<QuestionView>({ rounds: [], errors: new Map() });
  readonly questionsView = this.questionState.source;
  private readonly snapshots = new Set<(snapshot: KanbanSnapshot) => void>();
  private readonly runningSessions = new Set<string>();
  private host: KanbanSnapshot | undefined;
  private merged: KanbanSnapshot | undefined;
  private clientEpoch = 0;
  private rounds: readonly QuestionRound[] = [];
  private readonly prepared = new Map<string, Promise<readonly QuestionRound[]>>();
  private readonly questionSessions = new Set<string>();
  private readonly dismissed = new Set<string>();
  private readonly reminders = new ReminderTracker();
  private readonly composers = new Set<string>();
  private readonly stopStatus: () => void;
  private control: RemoteSnapshotStream<Baseline, Update>;
  private restarting: Promise<void> | undefined;
  private disposed = false;
  readonly api: ClientApi;
  constructor(private readonly remote: BridgeRemote, private readonly nativeStatus: HostObservable<SessionStatusSnapshot>) {
    this.control = this.makeControl();
    this.reminders.sync(this.nativeStatus.getSnapshot());
    this.syncRunning(this.nativeStatus.getSnapshot());
    this.stopStatus = nativeStatus.subscribe(() => {
      this.reminders.sync(this.nativeStatus.getSnapshot());
      this.publish();
      if (this.syncRunning(this.nativeStatus.getSnapshot())) this.refreshAttention();
    });
    this.api = {
      snapshot: () => this.unarySnapshot(() => remote.kanban.snapshot()),
      command: (command: Command) => this.unarySnapshot(() => remote.kanban.command(command)),
      branches: async (taskId: string) => unwrap(await remote.kanban.branches({ taskId })),
      worktreeDefault: async (taskId: string) => unwrap(await remote.kanban.worktreeDefault({ taskId })),
      detectProject: async (path: string) => unwrap(await remote.kanban.detectProject({ path })),
      subscribe: (listener) => { this.snapshots.add(listener); return () => this.snapshots.delete(listener); },
    };
  }
  private async unarySnapshot(request: () => Promise<RemoteResult<Outcome<KanbanSnapshot>>>): Promise<KanbanSnapshot> {
    const epoch = this.clientEpoch;
    try {
      const response = unwrap(await request());
      const { commandReceipt, ...snapshot } = response;
      if (epoch === this.clientEpoch) this.accept(snapshot);
      // An old in-flight response cannot relabel its former host state as a new baseline.
      if (!this.merged) throw new Error('The Kanban stream generation changed before a current snapshot was available. Retry the request.');
      // Identity belongs to the admitted command even when a newer feed model has won.
      return commandReceipt ? { ...this.merged, commandReceipt } : this.merged;
    } catch (error) {
      if (epoch === this.clientEpoch) this.fail(error);
      throw error;
    }
  }
  private makeControl(): RemoteSnapshotStream<Baseline, Update> {
    const remote = this.remote;
    const feed = remote.$stream<Baseline | Update>({
      name: 'Kanban board',
      open: async function* (signal) {
        let first = true;
        for await (const snapshot of remote.kanban.follow(signal)) {
          yield { kind: first ? 'baseline' as const : 'update' as const, snapshot };
          first = false;
        }
      },
      ended: (accepted) => accepted ? new RemoteStreamCarrierError('Kanban state stream ended; reconnecting.') : new Error('Kanban state stream ended before its opening snapshot.'),
      carrierFailed: (error) => this.fail(error),
    });
    return new RemoteSnapshotStream(feed, {
      name: 'Kanban board', isSnapshot: (frame): frame is Baseline => frame.kind === 'baseline',
      replace: (frame) => this.accept(frame.snapshot, true),
      update: (frame) => this.accept(frame.snapshot), failed: (error) => this.fail(error),
    });
  }
  start(): void { if (!this.disposed && !this.restarting) this.control.start(); }
  retry(): void {
    if (this.disposed || this.restarting) return;
    // A terminal failed consumer cannot be restarted; replace its owned logical supervisor.
    const old = this.control;
    this.restarting = (async () => {
      await old.dispose();
      if (!this.disposed) { this.control = this.makeControl(); this.control.start(); }
    })().catch(error => this.fail(error)).finally(() => { this.restarting = undefined; });
  }
  private fail(error: unknown): void { if (!this.disposed) this.health.set({ error: problem(error), connected: false }); }
  private accept(snapshot: KanbanSnapshot, baseline = false): void {
    if (this.disposed || (!baseline && this.host && snapshot.sequence < this.host.sequence)) return;
    if (baseline) { this.clientEpoch++; this.prepared.clear(); }
    this.host = snapshot;
    if (snapshot.questionRounds !== undefined) { this.rounds = snapshot.questionRounds.filter(round => !this.dismissed.has(round.id)); this.publishQuestions(); }
    this.health.set({ error: null, connected: true });
    this.publish();
    // Ordinary chats are absent from host startup replay; refresh their tracked histories in each new epoch.
    if (baseline) for (const id of this.questionSessions) void this.prepareQuestions(id).catch(() => undefined);
  }
  private publish(): void {
    if (this.disposed || !this.host) return;
    const attention: KanbanSnapshot['attention'] = { ...this.host.attention };
    const statuses = this.nativeStatus.getSnapshot();
    for (const task of allTasks(this.host)) {
      attention[task.id] = projectTaskAttention(this.host.attention[task.id], statuses, this.reminders, task.sessionIds);
    }
    this.merged = { ...this.host, attention, questionRounds: [...this.rounds], clientEpoch: this.clientEpoch };
    for (const listener of [...this.snapshots]) { try { listener(this.merged); } catch { /* Keep sibling consumers alive. */ } }
  }
  /** A conversation started running: ask the host for a freshly projected attention snapshot. */
  private refreshAttention(): void {
    void this.unarySnapshot(() => this.remote.kanban.snapshot()).catch(() => undefined);
  }
  /** Track the native running sessions, returning true when any conversation starts a turn. */
  private syncRunning(statuses: SessionStatusSnapshot): boolean {
    let rising = false;
    const seen = new Set<string>();
    for (const [id, status] of statuses) {
      const key = String(id);
      seen.add(key);
      if (status.running === true) {
        if (!this.runningSessions.has(key)) rising = true;
        this.runningSessions.add(key);
      }
    }
    for (const id of [...this.runningSessions]) if (!seen.has(id)) this.runningSessions.delete(id);
    return rising;
  }
  /** Acknowledge only the actually mounted/read drawer session, without native mainView writes. */
  viewSession(id: string): () => void {
    const release = this.reminders.view(id);
    this.publish();
    return release;
  }
  /** Prevent two plugin occurrences from mounting the same native composer simultaneously. */
  claimComposer(id: string): (() => void) | undefined {
    if (this.composers.has(id) || this.disposed) return undefined;
    this.composers.add(id); let active = true;
    return () => { if (active) { active = false; this.composers.delete(id); } };
  }
  assertSubmissionAllowed(id: string): void {
    const task = this.host ? allTasks(this.host).find(entry => entry.sessionIds.includes(id) && entry.operation && entry.operation.phase !== 'waiting' && entry.operation.phase !== 'failed') : undefined;
    if (task) throw Object.assign(new Error('This conversation is switching project context. Wait for the active operation before submitting an answer.'), { code: 'CONTEXT_MIGRATION_ACTIVE' });
  }
  async prepareQuestions(id: string): Promise<readonly QuestionRound[]> {
    if (this.disposed) return [];
    this.questionSessions.add(id);
    const existing = this.prepared.get(id); if (existing) return existing;
    const before = this.host?.sequence; const epoch = this.clientEpoch;
    this.questionError(id);
    const work: Promise<readonly QuestionRound[]> = Promise.resolve().then(async () => {
      try {
        const rounds = unwrap(await this.remote.kanban.questions({ sessionId: id }));
        if (this.disposed) return [];
        if (this.clientEpoch !== epoch) return this.prepareQuestions(id);
        if (this.host?.sequence === before) {
          const current = this.rounds.filter(round => round.sessionId === id && !this.dismissed.has(round.id));
          const visible = rounds.filter(round => !this.dismissed.has(round.id));
          const incoming = new Set(visible.map(round => round.id));
          const merged = visible.map(round => {
            const known = current.find(old => old.id === round.id);
            return known && (known.answered || known.complete && !round.complete) ? known : round;
          });
          this.rounds = [...this.rounds.filter(round => round.sessionId !== id), ...merged, ...current.filter(round => !incoming.has(round.id))];
          this.publishQuestions(); this.publish();
        }
        return this.rounds.filter(round => round.sessionId === id);
      } catch (error) {
        if (this.disposed) return [];
        if (this.clientEpoch !== epoch) return this.prepareQuestions(id);
        if (this.prepared.get(id) === work) this.prepared.delete(id);
        this.questionError(id, problem(error));
        throw error;
      }
    });
    this.prepared.set(id, work); return work;
  }
  /** Dismiss the displayed round and every other unresolved round in that conversation. */
  async dismissQuestions(sessionId: string, roundId: string): Promise<readonly QuestionRound[]> {
    if (this.disposed) return [];
    let remaining: readonly QuestionRound[];
    let missing = false;
    try {
      remaining = unwrap(await this.remote.kanban.dismissQuestions({ sessionId, roundId }));
    } catch (error) {
      if ((error as { code?: unknown }).code !== 'QUESTION_ROUND_NOT_FOUND') throw error;
      // The displayed round was already answered or dismissed elsewhere. Do not hide
      // unrelated unresolved rounds that the host did not actually dismiss.
      missing = true;
      remaining = this.rounds.filter(round => round.sessionId === sessionId && round.id !== roundId);
    }
    if (this.disposed) return [];
    if (!missing) for (const round of this.rounds) if (round.sessionId === sessionId && !round.answered) this.dismissed.add(round.id);
    this.dismissed.add(roundId);
    this.rounds = [...this.rounds.filter(round => round.sessionId !== sessionId), ...remaining.filter(round => !this.dismissed.has(round.id))];
    this.prepared.delete(sessionId);
    this.publishQuestions(); this.publish();
    return this.rounds.filter(round => round.sessionId === sessionId);
  }

  private questionError(id: string, error?: Problem): void {
    const previous = this.questionsView.getSnapshot(); const errors = new Map(previous.errors);
    if (error) errors.set(id, error); else errors.delete(id);
    this.questionState.set({ ...previous, errors });
  }
  private publishQuestions(): void {
    this.questionState.set({ rounds: this.rounds, errors: this.questionsView.getSnapshot().errors });
  }
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true; this.stopStatus(); this.snapshots.clear(); this.composers.clear(); this.prepared.clear(); this.questionSessions.clear(); this.dismissed.clear();
    this.health.clear(); this.questionState.clear();
    await this.restarting; await this.control.dispose();
  }
}
