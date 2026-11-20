import { RemoteSnapshotStream, RemoteStreamCarrierError, type ClientRemote } from '@deepseek-ai/dsh-api-gateway/client';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots';
import type { NativeSessionStatusSource } from './client/session-status.js';
import { AttentionProjector, RunningSessions } from './client/kanban-attention.js';
import { allTasks } from './client/snapshot-normalize.js';
import { mergeSnapshotFrame, type MergedHostSnapshot } from './client/snapshot-merge.js';
import { ConversationReadState } from './client/conversation-read-state.js';
import type { KeyValueStorage } from './client/key-value-storage.js';
import type { KanbanRemote } from './remote.js';
import type { ClientApi, Command, HostSnapshot, KanbanSnapshot, Outcome, Problem, QuestionFeedFrame, QuestionRound, SharingCommand, SnapshotRequest, WorkflowExportRequest, WorkflowImportReadRequest } from './shared/types.js';
import { QuestionRoundCache, type QuestionRoundView } from './client/question-round-cache.js';
import { QuestionDraftState, type QuestionDraftPort } from './client/question-draft-state.js';
import { asProblem } from './client/problem.js';

/** The live board feed's availability; the only fact the board-update status presents. */
export interface BridgeStatus { error: Problem | null }
export type BridgeRemote = Pick<ClientRemote, '$stream'> & { kanban: KanbanRemote };
type Baseline = { kind: 'baseline'; snapshot: HostSnapshot };
type Update = { kind: 'update'; snapshot: HostSnapshot };
function closedSessions(snapshot: Pick<MergedHostSnapshot, 'state'>): Set<string> {
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
  private readonly health = observable<BridgeStatus>({ error: null });
  readonly status = this.health.source;
  readonly questions: QuestionRoundCache;
  readonly questionsView: HostObservable<QuestionRoundView>;
  private readonly snapshots = new Set<(snapshot: KanbanSnapshot) => void>();
  private readonly running = new RunningSessions();
  private readonly projector = new AttentionProjector();
  private host: MergedHostSnapshot | undefined;
  private merged: KanbanSnapshot | undefined;
  private clientEpoch = 0;
  private readonly readState: ConversationReadState;
  private readonly draftState: QuestionDraftState;
  /** The dock-facing draft surface; the cache stays unaware of drafts. */
  readonly questionDrafts: QuestionDraftPort;
  private readonly stopPagehide: (() => void) | undefined;
  private readonly composers = new Set<string>();
  private readonly stopStatus: () => void;
  private control: RemoteSnapshotStream<Baseline, Update>;
  private restarting: Promise<void> | undefined;
  private disposed = false;
  readonly api: ClientApi;
  constructor(private readonly remote: BridgeRemote, private readonly nativeStatus: NativeSessionStatusSource, options: { storage?: KeyValueStorage; report?: (error: unknown) => void } = {}) {
    this.readState = new ConversationReadState(options.storage);
    this.draftState = new QuestionDraftState({
      transport: { save: async request => { unwrap(await this.remote.kanban.saveQuestionDraft(request)); } },
      ...(options.report === undefined ? {} : { report: options.report }),
    });
    this.questionDrafts = this.draftState;
    const pagehide = typeof globalThis.window === 'undefined' ? undefined : () => this.draftState.flush();
    if (pagehide !== undefined) globalThis.window.addEventListener('pagehide', pagehide);
    this.stopPagehide = pagehide === undefined ? undefined : () => globalThis.window.removeEventListener('pagehide', pagehide);
    this.questions = new QuestionRoundCache({
      feed: { open: (sessionId, onFrame, onError) => this.openQuestionFeed(sessionId, onFrame, onError) },
      dismissal: { dismiss: async (sessionId, roundId) => unwrap(await this.remote.kanban.dismissQuestions({ sessionId, roundId })) },
    });
    this.questionsView = this.questions.view;
    this.control = this.makeControl();
    this.running.sync(this.nativeStatus.getSnapshot());
    this.stopStatus = nativeStatus.subscribe(() => {
      this.publish();
      const rising = this.running.sync(this.nativeStatus.getSnapshot());
      if (rising.length > 0) this.refreshAttention(rising);
    });
    this.api = {
      snapshot: (request?: SnapshotRequest) => this.unarySnapshot(() => remote.kanban.snapshot(request ?? {})),
      command: (command: Command) => this.unarySnapshot(() => remote.kanban.command(command)),
      sharing: (command: SharingCommand) => this.unarySnapshot(() => remote.kanban.sharing(command)),
      localDrive: async request => unwrap(await remote.kanban.localDrive(request)),
      scriptedReview: async (request: { boardId: string; stageId: string; taskId?: string }) => unwrap(await remote.kanban.scriptedReview(request)),
      scriptedVariables: async (taskId: string) => unwrap(await remote.kanban.scriptedVariables({ taskId })),
      branches: async (taskId: string) => unwrap(await remote.kanban.branches({ taskId })),
      modelCatalog: async (refresh = false) => unwrap(await remote.kanban.modelCatalog(refresh ? { refresh: true } : {})),
      mcpServers: async () => unwrap(await remote.kanban.mcpServers({})),
      // A host that predates the transfer surface exposes neither read, and the
      // Boards section then offers no transfer action instead of failing.
      ...(remote.kanban.exportWorkflows === undefined ? {} : { exportWorkflows: async (request: WorkflowExportRequest) => unwrap(await remote.kanban.exportWorkflows!(request)) }),
      ...(remote.kanban.readWorkflowImport === undefined ? {} : { readWorkflowImport: async (request: WorkflowImportReadRequest) => unwrap(await remote.kanban.readWorkflowImport!(request)) }),
      ...(remote.kanban.readTaskAttachment === undefined ? {} : { readTaskAttachment: async (request: { hubId?: string; taskId: string; attachmentId: string }) => unwrap(await remote.kanban.readTaskAttachment(request)) }),
      ...(remote.kanban.saveQuestionAttachment === undefined ? {} : { saveQuestionAttachment: async (request: { sessionId: string; name: string; data: string }) => unwrap(await remote.kanban.saveQuestionAttachment(request)) }),
      ...(remote.kanban.readQuestionAttachment === undefined ? {} : { readQuestionAttachment: async (request: { sessionId: string; id: string }) => unwrap(await remote.kanban.readQuestionAttachment(request)) }),
      ...(remote.kanban.removeQuestionAttachment === undefined ? {} : { removeQuestionAttachment: async (request: { sessionId: string; id: string }) => { unwrap(await remote.kanban.removeQuestionAttachment(request)); } }),
      worktreeDefault: async (taskId: string) => unwrap(await remote.kanban.worktreeDefault({ taskId })),
      detectProject: async (path: string) => unwrap(await remote.kanban.detectProject({ path })),
      // A host that predates the Session diagnosis exposes neither method, and the seat
      // then presents the state without actions instead of failing on every press.
      ...(remote.kanban.sessionInspect === undefined ? {} : { sessionInspect: async (sessionId: string) => unwrap(await remote.kanban.sessionInspect({ sessionId })) }),
      ...(remote.kanban.sessionRepair === undefined ? {} : { sessionRepair: async (sessionId: string) => unwrap(await remote.kanban.sessionRepair({ sessionId })) }),
      subscribe: (listener) => {
        this.snapshots.add(listener);
        // A late-mounted surface paints from the snapshot the client already holds instead
        // of waiting for a host round trip; the bridge remains the only source of truth.
        if (this.merged !== undefined) {
          try { listener(this.merged); } catch { /* One consumer cannot take down the replay. */ }
        }
        return () => this.snapshots.delete(listener);
      },
    };
  }
  /**
   * Apply one requested response. A rejection stays a fact for the caller that asked for
   * it: every surface reports its own failure, so it never replaces the board feed's
   * availability, and an expected refusal on behalf of a caller cannot surface as one.
   */
  private async unarySnapshot(request: () => Promise<RemoteResult<Outcome<HostSnapshot>>>): Promise<KanbanSnapshot> {
    const epoch = this.clientEpoch;
    const response = unwrap(await request());
    const { commandReceipt, workflowImport, ...snapshot } = response;
    if (epoch === this.clientEpoch) this.accept(snapshot);
    // An old in-flight response cannot relabel its former host state as a new baseline.
    if (!this.merged) throw new Error('The Kanban stream generation changed before a current snapshot was available. Retry the request.');
    // Identity belongs to the admitted command even when a newer feed model has won,
    // so the receipt and the import outcome are reattached to whatever state the
    // client holds now instead of being lost to a newer frame.
    return {
      ...this.merged,
      ...(commandReceipt === undefined ? {} : { commandReceipt }),
      ...(workflowImport === undefined ? {} : { workflowImport }),
    };
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
      replace: (frame) => this.accept(frame.snapshot, true, true),
      update: (frame) => this.accept(frame.snapshot, false, true), failed: (error) => this.fail(error),
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
  private fail(error: unknown): void { if (!this.disposed) this.health.set({ error: asProblem(error) }); }
  /**
   * Apply one frame or requested response. Only a frame that arrived on the live feed can
   * report the feed as available: a response a surface requested applies its state, but its
   * success must never hide a dead feed.
   */
  private accept(snapshot: HostSnapshot, baseline = false, fromFeed = false): void {
    if (this.disposed || (!baseline && this.host && snapshot.sequence < this.host.sequence)) return;
    const previous = this.host;
    let merged: MergedHostSnapshot;
    try {
      merged = mergeSnapshotFrame(previous, snapshot, baseline);
    } catch (error) {
      // A frame that cannot be merged must not leave the board presenting a stale state:
      // report it, ask for one fresh unary snapshot, and restart the live stream.
      this.fail(error);
      void this.unarySnapshot(() => this.remote.kanban.snapshot({})).catch(() => undefined);
      this.retry();
      return;
    }
    if (baseline) this.clientEpoch++;
    // A close transition uses the facts the reader last saw, so a turn that settles
    // after the close is still presented as unread.
    this.acknowledgeClosed(previous, merged);
    this.host = merged;
    if (baseline) this.readState.prune(new Set(allTasks(merged).flatMap(task => task.sessionIds)));
    this.readState.flush();
    if (fromFeed) this.health.set({ error: null });
    this.publish();
  }
  /** A conversation whose tab just closed acknowledges the turn that had already settled. */
  private acknowledgeClosed(previous: MergedHostSnapshot | undefined, next: MergedHostSnapshot): void {
    // A conversation already closed before this bridge started has no observed close
    // transition; its settled turn stays unread until the conversation is reopened and read.
    if (previous === undefined) return;
    const before = closedSessions(previous);
    for (const task of allTasks(next)) {
      for (const sessionId of task.closedSessionIds) {
        if (before.has(sessionId)) continue;
        this.readState.close(sessionId);
      }
    }
  }
  private publish(): void {
    if (this.disposed || !this.host) return;
    this.readState.sync(this.host.conversations);
    const { attention, conversationAttention } = this.projector.project(this.host, this.nativeStatus.getSnapshot(), sessionId => this.readState.acknowledged(sessionId));
    const { conversations: _conversations, ...base } = this.host;
    this.merged = { ...base, attention, conversationAttention, clientEpoch: this.clientEpoch };
    for (const listener of [...this.snapshots]) { try { listener(this.merged); } catch { /* Keep sibling consumers alive. */ } }
  }
  /** Conversations started running: re-read only those conversations on the host. */
  private refreshAttention(sessionIds: readonly string[]): void {
    void this.unarySnapshot(() => this.remote.kanban.snapshot({ refreshSessionIds: [...sessionIds] })).catch(() => undefined);
  }
  /** Acknowledge only the actually mounted/read drawer session, without native mainView writes. */
  viewSession(id: string): () => void {
    const release = this.readState.view(id);
    this.publish();
    this.readState.flush();
    return release;
  }
  /**
   * Acknowledge the settled turn of every given conversation without displaying it.
   * The board's mark-all-read action uses this, so clearing a board needs no host
   * round trip and no new command.
   */
  markAllRead(sessionIds: readonly string[]): void {
    if (this.disposed || !this.host) return;
    // The tracker acknowledges what its last sync recorded, so refresh from the host
    // facts before marking a batch that was never displayed.
    this.readState.sync(this.host.conversations);
    for (const sessionId of sessionIds) this.readState.markRead(sessionId);
    this.readState.flush();
    this.publish();
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
    const remaining = await this.questions.dismiss(sessionId, roundId);
    // A successful dismissal retires every unresolved round, but a stale target only
    // retires the displayed one; keep exactly the rounds the cache still presents so a
    // newer round's draft survives.
    const live = this.questions.view.getSnapshot().rounds.filter(round => round.sessionId === sessionId).map(round => round.id);
    this.draftState.retainSession(sessionId, live);
    return remaining;
  }

  private openQuestionFeed(sessionId: string, onFrame: (frame: QuestionFeedFrame) => void, onError: (error: Problem) => void): () => void {
    const remote = this.remote;
    // Drafts hydrate before the frame reaches the cache, so the dock renders the
    // restored answer in the same paint as its round; answered rounds retire theirs.
    const deliver = (frame: QuestionFeedFrame): void => {
      if (frame.drafts !== undefined) this.draftState.hydrate(sessionId, frame.drafts);
      this.draftState.retire(frame.rounds.filter(round => round.answered).map(round => round.id));
      onFrame(frame);
    };
    const feed = remote.$stream<QuestionFeedFrame>({
      name: 'Question rounds',
      open: async function* (signal) {
        for await (const frame of remote.kanban.questionsFollow({ sessionId }, signal)) yield frame;
      },
      ended: (accepted) => accepted ? new RemoteStreamCarrierError('Question rounds stream ended; reconnecting.') : new Error('Question rounds stream ended before its opening frame.'),
      carrierFailed: (error) => onError(asProblem(error)),
    });
    const control = new RemoteSnapshotStream<QuestionFeedFrame, QuestionFeedFrame>(feed, {
      name: 'Question rounds',
      isSnapshot: (frame): frame is QuestionFeedFrame => frame.kind === 'baseline',
      replace: deliver,
      update: deliver,
      failed: error => onError(asProblem(error)),
    });
    control.start();
    return () => { control.dispose().catch(error => onError(asProblem(error))); };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true; this.stopStatus(); this.stopPagehide?.(); this.snapshots.clear(); this.composers.clear();
    this.questions.dispose(); this.draftState.dispose(); this.health.clear();
    await this.restarting; await this.control.dispose();
  }
}
