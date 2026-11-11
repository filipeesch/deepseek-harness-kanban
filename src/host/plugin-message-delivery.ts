/** The resolved conversation a plugin-message delivery would land in. */
export interface PluginMessageTarget {
  /** Whether the resolved inbox already holds a message with this delivery identity. */
  pending(deliveryId: string): boolean;
}

/** One plugin message delivery carrying its stable identity. */
export interface PluginMessageEntry {
  readonly requestId: string;
}

export interface PluginMessageDeliveryDeps<T extends PluginMessageTarget, D extends PluginMessageEntry> {
  /** Durable source kind this delivery writes and deduplicates. */
  readonly sourceKind: string;
  /**
   * Resolve the conversation before any dedupe read. A cold session is resumed
   * here, so the target reflects the inbox the host restored rather than the
   * live registry, which is empty for a conversation that was not attached.
   */
  resolve(sessionId: string): Promise<T>;
  /** The conversation's durable events, read only after the target resolves. */
  events(sessionId: string): Promise<readonly unknown[]>;
  /** Admit the delivery through the resolved target. */
  deliver(target: T, delivery: D): void | Promise<void>;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether one durable message record carries this producer identity. */
function messageMatches(message: unknown, sourceKind: string, requestId: string): boolean {
  if (!record(message)) return false;
  const source = record(message.source) ? message.source : undefined;
  return source?.kind === sourceKind && source.requestId === requestId;
}

/** Messages a durable inbox mutation inserted, including a later-canceled steering admission. */
function insertedMessages(event: Record<string, unknown>): readonly unknown[] {
  if (event.type !== 'agent/inbox/spliced') return [];
  const data = record(event.data) ? event.data : undefined;
  const inserted = data === undefined ? undefined : data.inserted;
  return Array.isArray(inserted) ? inserted : [];
}

/**
 * Whether the conversation's durable log already records this delivery identity.
 * Steering persists an inbox insertion before any user/message event, and a
 * canceled steering leaves only that insertion; both are durable admissions and
 * must keep the identity at-most-once across a restart.
 */
function alreadyRecorded(events: readonly unknown[], sourceKind: string, requestId: string): boolean {
  return events.some(event => {
    if (!record(event)) return false;
    if (event.type === 'user/message') return messageMatches(event.data, sourceKind, requestId);
    return insertedMessages(event).some(message => messageMatches(message, sourceKind, requestId));
  });
}

/**
 * The one delivery rule for a plugin-sourced message: at most once per conversation
 * and delivery identity. A concurrent call joins the delivery already in flight,
 * and a replayed delivery is skipped when the resolved inbox still holds it or when
 * the log already records it — the plugin-side counterpart of the request-id dedupe
 * the human-prompt path gets from the host. A failed delivery is not remembered, so
 * a later attempt can retry.
 */
export function createPluginMessageDelivery<T extends PluginMessageTarget, D extends PluginMessageEntry>(
  deps: PluginMessageDeliveryDeps<T, D>,
): (sessionId: string, delivery: D) => Promise<void> {
  const inFlight = new Map<string, Promise<void>>();
  // A successful delivery is remembered in-process until the durable log is
  // observable, so a same-process retry cannot steer the target twice. The log
  // check covers a restart, where this set is empty.
  const delivered = new Set<string>();
  return (sessionId, delivery) => {
    const key = JSON.stringify([sessionId, delivery.requestId]);
    if (delivered.has(key)) return Promise.resolve();
    const active = inFlight.get(key);
    if (active !== undefined) return active;
    const done = (async () => {
      // Resolve first: only a resumed conversation can answer for the pending
      // input a restart left queued.
      const target = await deps.resolve(sessionId);
      if (target.pending(delivery.requestId)) return;
      if (alreadyRecorded(await deps.events(sessionId), deps.sourceKind, delivery.requestId)) return;
      // The awaited read may let a concurrent admission land; the target is
      // authoritative immediately before the synchronous delivery.
      if (target.pending(delivery.requestId)) return;
      await deps.deliver(target, delivery);
      delivered.add(key);
      if (delivered.size > 1024) {
        const oldest = delivered.values().next().value;
        if (oldest !== undefined) delivered.delete(oldest);
      }
    })();
    inFlight.set(key, done);
    // Settle the map entry without turning the caller's copy into an unhandled rejection.
    void done.finally(() => { if (inFlight.get(key) === done) inFlight.delete(key); }).catch(() => undefined);
    return done;
  };
}
