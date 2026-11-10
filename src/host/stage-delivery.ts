import type { StageInstructionDelivery } from '../shared/ports.js';
import { STAGE_INSTRUCTION_SOURCE_KIND } from './stage-message.js';

/** The resolved conversation a delivery would land in. */
export interface StageDeliveryTarget {
  /** Whether the resolved inbox already holds a message with this delivery identity. */
  pending(deliveryId: string): boolean;
}

export interface StageDeliveryDeps<T extends StageDeliveryTarget> {
  /**
   * Resolve the conversation before any dedupe read. A cold session is resumed
   * here, so the target reflects the inbox the host restored rather than the
   * live registry, which is empty for a conversation that was not attached.
   */
  resolve(sessionId: string): Promise<T>;
  /** The conversation's durable events, read only after the target resolves. */
  events(sessionId: string): Promise<readonly unknown[]>;
  /** Admit the delivery through the resolved target. */
  deliver(target: T, delivery: StageInstructionDelivery): void | Promise<void>;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The durable source of one logged message, when the event carries one. */
function messageSource(event: Record<string, unknown>): Record<string, unknown> | undefined {
  const data = record(event.data) ? event.data : undefined;
  const source = data === undefined ? undefined : data.source;
  return record(source) ? source : undefined;
}

/** Whether the conversation's durable log already records this delivery identity. */
function alreadyRecorded(events: readonly unknown[], requestId: string): boolean {
  return events.some(event => record(event)
    && event.type === 'user/message'
    && messageSource(event)?.kind === STAGE_INSTRUCTION_SOURCE_KIND
    && messageSource(event)?.requestId === requestId);
}

/**
 * The one delivery rule for a stage instruction: at most once per conversation and
 * delivery identity. A concurrent call joins the delivery already in flight, and a
 * replayed delivery is skipped when the resolved inbox still holds it or when the
 * log already records it — the plugin-side counterpart of the request-id dedupe the
 * human-prompt path gets from the host. A failed delivery is not remembered, so a
 * later attempt can retry.
 */
export function createStageDelivery<T extends StageDeliveryTarget>(deps: StageDeliveryDeps<T>): (sessionId: string, delivery: StageInstructionDelivery) => Promise<void> {
  const inFlight = new Map<string, Promise<void>>();
  return (sessionId, delivery) => {
    const key = JSON.stringify([sessionId, delivery.requestId]);
    const active = inFlight.get(key);
    if (active !== undefined) return active;
    const done = (async () => {
      // Resolve first: only a resumed conversation can answer for the pending
      // input a restart left queued.
      const target = await deps.resolve(sessionId);
      if (target.pending(delivery.requestId)) return;
      if (alreadyRecorded(await deps.events(sessionId), delivery.requestId)) return;
      // The awaited read may let a concurrent admission land; the target is
      // authoritative immediately before the synchronous delivery.
      if (target.pending(delivery.requestId)) return;
      await deps.deliver(target, delivery);
    })();
    inFlight.set(key, done);
    // Settle the map entry without turning the caller's copy into an unhandled rejection.
    void done.finally(() => { if (inFlight.get(key) === done) inFlight.delete(key); }).catch(() => undefined);
    return done;
  };
}
