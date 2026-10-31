import { RemoteSnapshotStream, RemoteStreamCarrierError, type ClientRemote } from '@deepseek-ai/dsh-api-gateway/client';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots';
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { KanbanRemote } from './remote.js';
import type { Attention, ClientApi, Command, HostSnapshot, KanbanSnapshot, Outcome, Problem, QuestionFeedFrame, QuestionRound, Task } from './shared/types.js';
import { EMPTY_CONVERSATION_FACTS } from './shared/types.js';
import { aggregateTaskAttention, projectConversation } from './client/attention-projection.js';
import { ConversationReadTracker } from './client/conversation-read-tracker.js';
import { browserStorage, type KeyValueStorage } from './client/key-value-storage.js';
import { QuestionRoundCache, type QuestionRoundView } from './client/question-round-cache.js';
import { ReadAcknowledgments } from './client/read-acknowledgments.js';

export interface BridgeStatus { error: Problem | null; connected: boolean }
export type BridgeRemote = Pick<ClientRemote, '$stream'> & { kanban: KanbanRemote };
type Baseline = { kind: 'baseline'; snapshot: HostSnapshot };
function allTasks(snapshot: Pick<HostSnapshot, 'state'>): Task[] { return snapshot.state.hubs.flatMap(hub => hub.tasks); }
type Update = { kind: 'update'; snapshot: HostSnapshot };
function problem(error: unknown): Problem {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return { code: 'code' in error && typeof error.code === 'string' ? error.code : 'CLIENT_ERROR', message: String(error.message) };
  }
  return { code: 'CLIENT_ERROR', message: String(error) };
}
function closedSessions(snapshot: Pick<HostSnapshot, 'state'>): Set<string> {
  return new Set(allTasks(snapshot).flatMap(task => task.closedSessionIds));
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
  readonly questions: QuestionRoundCache;
  readonly questionsView: HostObservable<QuestionRoundView>;
  private readonly snapshots = new Set<(snapshot: KanbanSnapshot) => void>();
  private readonly runningSessions = new Set<string>();
  private host: HostSnapshot | undefined;
  private merged: KanbanSnapshot | undefined;
  private clientEpoch = 0;
  private readonly progress: ReadAcknowledgments;
  private readonly reads: ConversationReadTracker;
  private readonly composers = new Set<string>();
  private readonly stopStatus: () => void;
  private control: RemoteSnapshotStream<Baseline, Update>;
  private restarting: Promise<void> | undefined;
  private disposed = false;
  readonly api: ClientApi;
  constructor(private readonly remote: BridgeRemote, private readonly nativeStatus: HostObservable<SessionStatusSnapshot>, options: { storage?: KeyValueStorage } = {}) {
    this.progress = new ReadAcknowledgments(options.storage ?? browserStorage());
    this.reads = new ConversationReadTracker(this.progress);
    this.questions = new QuestionRoundCache({
      feed: { open: (sessionId, onFrame, onError) => this.openQuestionFeed(sessionId, onFrame, onError) },
      dismissal: { dismiss: async (sessionId, roundId) => unwrap(await this.remote.kanban.dismissQuestions({ sessionId, roundId })) },
    });
    this.questionsView = this.questions.view;
    this.control = this.makeControl();
    this.syncRunning(this.nativeStatus.getSnapshot());
    this.stopStatus = nativeStatus.subscribe(() => {
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
  private async unarySnapshot(request: () => Promise<RemoteResult<Outcome<HostSnapshot>>>): Promise<KanbanSnapshot> {
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
  private accept(snapshot: HostSnapshot, baseline = false): void {
    if (this.disposed || (!baseline && this.host && snapshot.sequence < this.host.sequence)) return;
    const previous = this.host;
    if (baseline) this.clientEpoch++;
    // A close transition uses the facts the reader last saw, so a turn that settles
    // after the close is still presented as unread.
    this.acknowledgeClosed(previous, snapshot);
    this.host = snapshot;
    if (baseline) this.pruneReads(snapshot);
    this.progress.flush();
    this.health.set({ error: null, connected: true });
    this.publish();
  }
  /** A conversation whose tab just closed acknowledges the turn that had already settled. */
  private acknowledgeClosed(previous: HostSnapshot | undefined, next: HostSnapshot): void {
    // A conversation already closed before this bridge started has no observed close
    // transition; its settled turn stays unread until the conversation is reopened and read.
    if (previous === undefined) return;
    const before = closedSessions(previous);
    for (const task of allTasks(next)) {
      for (const sessionId of task.closedSessionIds) {
        if (before.has(sessionId)) continue;
        this.reads.close(sessionId);
      }
    }
  }
  private pruneReads(snapshot: HostSnapshot): void {
    this.progress.prune(new Set(allTasks(snapshot).flatMap(task => task.sessionIds)));
  }
  private publish(): void {
    if (this.disposed || !this.host) return;
    const statuses = this.nativeStatus.getSnapshot();
    this.reads.sync(this.host.conversations);
    const conversationAttention: Record<string, Attention> = {};
    for (const task of allTasks(this.host)) {
      for (const sessionId of task.sessionIds) {
        if (conversationAttention[sessionId]) continue;
        const facts = this.host.conversations[sessionId] ?? EMPTY_CONVERSATION_FACTS;
        conversationAttention[sessionId] = projectConversation(facts, statuses.get(sessionId as SessionId), this.reads.acknowledged(sessionId));
      }
    }
    const attention: Record<string, Attention> = {};
    for (const task of allTasks(this.host)) {
      attention[task.id] = aggregateTaskAttention(task.sessionIds.flatMap(sessionId => conversationAttention[sessionId] ? [conversationAttention[sessionId]!] : []));
    }
    const { conversations: _conversations, ...base } = this.host;
    this.merged = { ...base, attention, conversationAttention, clientEpoch: this.clientEpoch };
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
    const release = this.reads.view(id);
    this.publish();
    this.progress.flush();
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
  /** Track one conversation's question feed; the returned release closes it when the last holder leaves. */
  trackQuestions(id: string): () => void {
    return this.disposed ? () => {} : this.questions.track(id);
  }
  /** Reopen a failed question feed without dropping the rounds already shown. */
  retryQuestions(id: string): void {
    if (!this.disposed) this.questions.retry(id);
  }
  /** Record that the host accepted the submission; a dropped round may now confirm it. */
  settleSubmission(id: string): void {
    if (!this.disposed) this.questions.settle(id);
  }
  /** Dismiss the displayed round and every other unresolved round in that conversation. */
  async dismissQuestions(sessionId: string, roundId: string): Promise<readonly QuestionRound[]> {
    if (this.disposed) return [];
    return this.questions.dismiss(sessionId, roundId);
  }

  private openQuestionFeed(sessionId: string, onFrame: (frame: QuestionFeedFrame) => void, onError: (error: Problem) => void): () => void {
    const remote = this.remote;
    const feed = remote.$stream<QuestionFeedFrame>({
      name: 'Question rounds',
      open: async function* (signal) {
        for await (const frame of remote.kanban.questionsFollow({ sessionId }, signal)) yield frame;
      },
      ended: (accepted) => accepted ? new RemoteStreamCarrierError('Question rounds stream ended; reconnecting.') : new Error('Question rounds stream ended before its opening frame.'),
      carrierFailed: (error) => onError(problem(error)),
    });
    const control = new RemoteSnapshotStream<QuestionFeedFrame, QuestionFeedFrame>(feed, {
      name: 'Question rounds',
      isSnapshot: (frame): frame is QuestionFeedFrame => frame.kind === 'baseline',
      replace: frame => onFrame(frame),
      update: frame => onFrame(frame),
      failed: error => onError(problem(error)),
    });
    control.start();
    return () => { control.dispose().catch(error => onError(problem(error))); };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true; this.stopStatus(); this.snapshots.clear(); this.composers.clear();
    this.questions.dispose(); this.health.clear();
    await this.restarting; await this.control.dispose();
  }
}
