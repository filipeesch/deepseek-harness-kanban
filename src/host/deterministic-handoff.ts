import type { Context } from '@deepseek-ai/cordis';
import { boundContextSummary, createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm';
import type { DeterministicHandoff } from '../shared/deterministic.js';
import type { LocatedTask } from './hub-repository.js';
import { deterministicHandoffBlock } from './stage-message.js';

export const DETERMINISTIC_HANDOFF_SOURCE = 'deterministic-handoff';
export interface DeterministicHandoffSource {
  readonly kind: 'deterministic-handoff';
  readonly form: 'notice';
  readonly summary: string;
  readonly requestId: string;
  readonly entryId: string;
}
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap { 'deterministic-handoff': DeterministicHandoffSource }
}
export interface HandoffInjectionPorts {
  locateBySession(sessionId: string): LocatedTask | undefined;
  events(sessionId: string): Promise<readonly unknown[]>;
  reserve(taskId: string, entryId: string, deliveryId: string): () => void;
  accept(taskId: string, entryId: string, deliveryId: string): Promise<void>;
  report?(error: unknown): void;
}
interface Admission { taskId: string; sessionId: string; entryId: string; deliveryId: string; done: Promise<void>; release(): void }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function sourceMatches(value: unknown, id: string): boolean {
  return record(value) && record(value.source) && value.source.kind === DETERMINISTIC_HANDOFF_SOURCE && value.source.requestId === id;
}
function recorded(events: readonly unknown[], id: string): boolean {
  return events.some(event => record(event) && (event.type === 'user/message' ? sourceMatches(event.data, id)
    : event.type === 'agent/inbox/spliced' && record(event.data) && Array.isArray(event.data.inserted) && event.data.inserted.some(value => sourceMatches(value, id))));
}
export function createDeterministicHandoffMessage(handoff: DeterministicHandoff): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text: deterministicHandoffBlock(handoff) }], source: {
    kind: DETERMINISTIC_HANDOFF_SOURCE, form: 'notice', summary: boundContextSummary('Result: ' + handoff.exit + ' - from: ' + handoff.fromColumnId),
    requestId: handoff.id, entryId: handoff.entryId,
  } });
}
/** Add evidence to an existing explicit native turn; never enqueue a second prompt. */
export function registerDeterministicHandoffInjection(ctx: Context, ports: HandoffInjectionPorts): () => void {
  const admissions = new Map<string, Admission>();
  const offStep = ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next();
    if (decision.kind !== 'enter' || decision.messages.length === 0 || payload.signal.aborted) return decision;
    const sessionId = String(payload.agent.id);
    let located = ports.locateBySession(sessionId);
    if (!located) return decision;
    const prior = admissions.get(located.task.id);
    if (prior) await prior.done;
    if (payload.signal.aborted) return decision;
    located = ports.locateBySession(sessionId);
    const task = located?.task; const handoff = task?.deterministicHandoff;
    if (!task || !handoff || handoff.instruction || handoff.acceptedAt || task.deterministic || task.stageEntry?.id !== handoff.entryId) return decision;
    if (decision.messages.some(message => sourceMatches(message, handoff.id))) return decision;
    let unlock: (() => void) | undefined;
    while (!unlock) {
      // Read every owned conversation: one logical handoff must not repeat in another tab.
      for (const id of task.sessionIds) {
        if (recorded(await ports.events(id), handoff.id)) {
          await ports.accept(task.id, handoff.entryId, handoff.id); return decision;
        }
      }
      payload.signal.throwIfAborted();
      const live = ports.locateBySession(sessionId)?.task;
      if (live?.stageEntry?.id !== handoff.entryId || live.deterministicHandoff?.id !== handoff.id || live.deterministicHandoff.acceptedAt || live.deterministic) return decision;
      // Another conversation may have won admission during our log reads.
      const concurrent = admissions.get(task.id);
      if (concurrent) { await concurrent.done; continue; }
      unlock = ports.reserve(task.id, handoff.entryId, handoff.id);
    }
    const releaseReservation = unlock;
    let resolve!: () => void;
    const done = new Promise<void>(ready => { resolve = ready; });
    const release = () => { if (admissions.get(task.id)?.done === done) { admissions.delete(task.id); releaseReservation(); resolve(); } payload.signal.removeEventListener('abort', release); };
    admissions.set(task.id, { taskId: task.id, sessionId, entryId: handoff.entryId, deliveryId: handoff.id, done, release });
    payload.signal.addEventListener('abort', release, { once: true });
    // Reservation is held through final native admission, not merely through this middleware return.
    return { ...decision, messages: [createDeterministicHandoffMessage(handoff), ...decision.messages] };
  });
  const offEvent = ctx.on('session/event', (session, event) => {
    const sessionId = String(session.id);
    for (const admission of admissions.values()) {
      if (admission.sessionId !== sessionId) continue;
      if (recorded([event], admission.deliveryId)) {
        void ports.accept(admission.taskId, admission.entryId, admission.deliveryId).catch(error => ports.report?.(error)).finally(admission.release);
      } else if (event.type === 'turn/end') admission.release();
    }
  });
  return () => { offStep(); offEvent(); for (const admission of [...admissions.values()]) admission.release(); };
}
