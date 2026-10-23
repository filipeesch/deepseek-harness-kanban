import type { BackgroundActivity, BackgroundKind, SessionFacts } from '../shared/types.js';

/** One family reported by the public `workspace/session-activity` waterfall. */
export interface ActivityEntry {
  readonly kind: string;
  readonly items?: ReadonlyArray<{ readonly id?: string; readonly label?: string }>;
}
/** The native inspection facts this module depends on, kept structural for direct tests. */
export interface InspectionLike {
  readonly meta: { readonly cwd?: string };
  readonly events: ReadonlyArray<{ readonly type: string; readonly data: unknown }>;
}
export interface ProjectionLike { readonly values?: unknown }
export interface NativeFactsDeps {
  activity(sessionId: string): Promise<readonly ActivityEntry[]>;
  projections(sessionId: string): Promise<ProjectionLike | null | undefined>;
  inspect(sessionId: string): Promise<InspectionLike>;
}
export interface SessionFactsSource { read(sessionId: string): Promise<SessionFacts> }

const BACKGROUND_KINDS = new Set<BackgroundKind>(['job', 'subagent', 'schedule']);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Split the activity families: the turn family is execution, every other known family is background work. */
export function partitionActivity(entries: readonly ActivityEntry[]): Pick<SessionFacts, 'turn' | 'background'> {
  let turn = false;
  const background: BackgroundActivity[] = [];
  for (const entry of entries) {
    const kind = typeof entry.kind === 'string' ? entry.kind : '';
    if (kind === 'turn') { turn = true; continue; }
    if (!BACKGROUND_KINDS.has(kind as BackgroundKind)) continue;
    const items = Array.isArray(entry.items) ? entry.items : [];
    if (items.length === 0) { background.push({ kind: kind as BackgroundKind, label: kind }); continue; }
    for (const item of items) {
      const label = typeof item?.label === 'string' && item.label.trim() ? item.label.trim()
        : typeof item?.id === 'string' && item.id.trim() ? item.id.trim() : kind;
      background.push({ kind: kind as BackgroundKind, label });
    }
  }
  return { turn, background };
}

/** A conversation awaits a reply while a native question or approval is still open. */
export function nativePending(projection: ProjectionLike | null | undefined, inspection: InspectionLike): boolean {
  const values = record(projection?.values) ? projection.values : undefined;
  const questions = values?.['userQuestions'];
  if (record(questions) && Array.isArray(questions.active) && questions.active.length > 0) return true;
  const approvals = new Set<string>();
  for (const event of inspection.events) {
    if (event.type === 'turn/end') approvals.clear();
    if (!record(event.data) || typeof event.data.id !== 'string') continue;
    if (event.type === 'approval/asked') approvals.add(event.data.id);
    if (event.type === 'approval/decided') approvals.delete(event.data.id);
  }
  return approvals.size > 0;
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

/** The last recorded turn outcome failed and no later turn has succeeded. */
export function lastOutcomeFailed(inspection: InspectionLike): boolean {
  let failed = false;
  for (const event of inspection.events) {
    if (event.type !== 'turn/end') continue;
    const data = record(event.data) ? event.data : undefined;
    const reason = data && record(data.reason) ? data.reason : undefined;
    failed = reason?.kind === 'error';
  }
  return failed;
}

/** Read the native facts from an injected inspection seam; the port factory keeps the service wiring. */
export function createNativeSessionFacts(deps: NativeFactsDeps): SessionFactsSource {
  return {
    async read(sessionId: string): Promise<SessionFacts> {
      const [activity, projection, inspection] = await Promise.all([
        deps.activity(sessionId), deps.projections(sessionId), deps.inspect(sessionId),
      ]);
      const { turn, background } = partitionActivity(activity);
      return { turn, background, awaitingReply: nativePending(projection, inspection), failed: lastOutcomeFailed(inspection) };
    },
  };
}
