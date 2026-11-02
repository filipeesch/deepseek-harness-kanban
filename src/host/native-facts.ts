import type { BackgroundActivity, BackgroundKind, ConversationFacts, PendingUserWorkKind, SettledTurn } from '../shared/types.js';
import { pendingUserWork } from '../domain/pending-user-work.js';
import type { ConversationFactsFold } from './conversation-facts.js';

/** One family reported by the public `workspace/session-activity` waterfall. */
export interface ActivityEntry {
  readonly kind: string;
  readonly items?: ReadonlyArray<{ readonly id?: string; readonly label?: string }>;
}
/** The native inspection facts this module depends on, kept structural for direct tests. */
export interface InspectionLike {
  readonly meta: { readonly cwd?: string };
  readonly events: ReadonlyArray<{ readonly type: string; readonly seq: number; readonly data: unknown }>;
}
export interface ProjectionLike { readonly values?: unknown }
export interface NativeFactsDeps {
  activity(sessionId: string): Promise<readonly ActivityEntry[]>;
  projections(sessionId: string): Promise<ProjectionLike | null | undefined>;
  inspect(sessionId: string): Promise<InspectionLike>;
  /** Incremental facts for a live Session; absent for a not-live Session. */
  liveFacts?(sessionId: string): ConversationFactsFold | undefined;
  /** User messages queued for a later turn, read from the same projection hydration; absent keeps the read to the other facts. */
  queuedPrompts?(sessionId: string, projection: ProjectionLike | null | undefined): number;
}
export interface ConversationFactsSource { read(sessionId: string): Promise<ConversationFacts> }

/** The native pending kinds, ordered by the shared value builder. */
function nativeKinds(question: boolean, approval: boolean): PendingUserWorkKind[] {
  const kinds: PendingUserWorkKind[] = [];
  if (question) kinds.push('native-question');
  if (approval) kinds.push('approval');
  return kinds;
}

/** Families that count as owned agent execution: the conversation's own turn and its descendants. */
const AGENT_KINDS = new Set(['turn', 'subagent']);
/** Families that count as background work outliving the turn. */
const BACKGROUND_KINDS = new Set<BackgroundKind>(['job', 'schedule']);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Split the activity families: agent execution (own turn or descendants) and the remaining background work. */
export function partitionActivity(entries: readonly ActivityEntry[]): Pick<ConversationFacts, 'running' | 'background'> {
  let running = false;
  const background: BackgroundActivity[] = [];
  for (const entry of entries) {
    const kind = typeof entry.kind === 'string' ? entry.kind : '';
    if (AGENT_KINDS.has(kind)) { running = true; continue; }
    if (!BACKGROUND_KINDS.has(kind as BackgroundKind)) continue;
    const items = Array.isArray(entry.items) ? entry.items : [];
    if (items.length === 0) { background.push({ kind: kind as BackgroundKind, label: kind }); continue; }
    for (const item of items) {
      const label = typeof item?.label === 'string' && item.label.trim() ? item.label.trim()
        : typeof item?.id === 'string' && item.id.trim() ? item.id.trim() : kind;
      background.push({ kind: kind as BackgroundKind, label });
    }
  }
  return { running, background };
}

/** A pending native question is visible in its projection; approvals have no standard projection. */
function pendingUserQuestion(projection: ProjectionLike | null | undefined): boolean {
  const values = record(projection?.values) ? projection.values : undefined;
  const questions = values?.['userQuestions'];
  return record(questions) && Array.isArray(questions.active) && questions.active.length > 0;
}

/** A conversation awaits a reply while a native question or approval is still open. */
/** A pending native approval remains open until its decision or the turn boundary that clears it. */
export function inspectedApprovals(inspection: InspectionLike): boolean {
  const approvals = new Set<string>();
  for (const event of inspection.events) {
    if (event.type === 'turn/end') approvals.clear();
    if (!record(event.data) || typeof event.data.id !== 'string') continue;
    if (event.type === 'approval/asked') approvals.add(event.data.id);
    if (event.type === 'approval/decided') approvals.delete(event.data.id);
  }
  return approvals.size > 0;
}

export function nativePending(projection: ProjectionLike | null | undefined, inspection: InspectionLike): boolean {
  return pendingUserQuestion(projection) || inspectedApprovals(inspection);
}

/** A turn boundary is open until its matching `turn/end` is recorded. */
export function inspectedOpenTurn(inspection: InspectionLike): boolean {
  let open = false;
  for (const event of inspection.events) {
    if (event.type === 'turn/start') open = true;
    if (event.type === 'turn/end') open = false;
  }
  return open;
}

/** The last settled turn, identified by its durable event sequence so a read state can target it. */
export function lastSettledTurn(inspection: InspectionLike): SettledTurn | null {
  let settled: SettledTurn | null = null;
  for (const event of inspection.events) {
    if (event.type !== 'turn/end') continue;
    const data = record(event.data) ? event.data : undefined;
    const reason = data && record(data.reason) ? data.reason : undefined;
    settled = { seq: event.seq, outcome: reason?.kind === 'error' ? 'error' : 'ok' };
  }
  return settled;
}

/** The settled turn held by the incremental fold, or null before the first completed turn. */
function foldedSettledTurn(fold: ConversationFactsFold): SettledTurn | null {
  if (fold.lastTurnEndSeq === null) return null;
  return { seq: fold.lastTurnEndSeq, outcome: fold.lastTurnOutcome === 'error' ? 'error' : 'ok' };
}

/** Read the native facts from injected seams: projections for a live Session, inspection otherwise. */
export function createNativeSessionFacts(deps: NativeFactsDeps): ConversationFactsSource {
  return {
    async read(sessionId: string): Promise<ConversationFacts> {
      const [activity, projection] = await Promise.all([
        deps.activity(sessionId), deps.projections(sessionId),
      ]);
      const { running, background } = partitionActivity(activity);
      const question = pendingUserQuestion(projection);
      const queuedPrompts = deps.queuedPrompts === undefined ? 0 : deps.queuedPrompts(sessionId, projection);
      const fold = deps.liveFacts?.(sessionId);
      if (fold !== undefined) {
        return {
          running,
          background,
          pending: pendingUserWork(nativeKinds(question, fold.openApprovalIds.length > 0), queuedPrompts),
          settledTurn: foldedSettledTurn(fold),
        };
      }
      const inspection = await deps.inspect(sessionId);
      return {
        running,
        background,
        pending: pendingUserWork(nativeKinds(question, inspectedApprovals(inspection)), queuedPrompts),
        settledTurn: lastSettledTurn(inspection),
      };
    },
  };
}
