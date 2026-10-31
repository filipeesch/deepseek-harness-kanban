import type { KeyValueStorage } from './key-value-storage.js';

export const READ_ACKNOWLEDGMENTS_KEY = 'dsh.kanban.readAcks';
const VERSION = 1;

interface StoredReadAcknowledgments { version: 1; ack: Record<string, number> }

function parse(raw: string | null): Map<string, number> {
  if (!raw) return new Map();
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return new Map();
    const record = value as { version?: unknown; ack?: unknown };
    if (record.version !== VERSION || !record.ack || typeof record.ack !== 'object' || Array.isArray(record.ack)) return new Map();
    const acknowledged = new Map<string, number>();
    for (const [sessionId, seq] of Object.entries(record.ack as Record<string, unknown>)) {
      if (typeof seq === 'number' && Number.isSafeInteger(seq) && seq >= 0) acknowledged.set(sessionId, seq);
    }
    return acknowledged;
  } catch { return new Map(); }
}

/**
 * Per-conversation read progress. An absent entry means nothing was read, so a settled
 * turn reads as unread until the conversation is acknowledged. One versioned record
 * keeps the whole map durable behind the injected storage port.
 */
export class ReadAcknowledgments {
  private readonly acknowledgedBySession: Map<string, number>;
  private pending = false;
  private dirty = false;

  constructor(private readonly storage: KeyValueStorage) {
    this.acknowledgedBySession = parse(storage.get(READ_ACKNOWLEDGMENTS_KEY));
  }

  /** The acknowledged turn sequence, or undefined when the conversation was never acknowledged. */
  acknowledged(sessionId: string): number | undefined {
    return this.acknowledgedBySession.get(sessionId);
  }

  /** Advance the acknowledgment to `seq`; a lower or equal sequence is ignored. */
  acknowledge(sessionId: string, seq: number): void {
    if (!Number.isSafeInteger(seq) || seq < 0) return;
    const current = this.acknowledgedBySession.get(sessionId);
    if (current !== undefined && current >= seq) return;
    this.acknowledgedBySession.set(sessionId, seq);
    this.schedule();
  }

  /** Drop acknowledgments for conversations that no longer belong to any task. */
  prune(known: ReadonlySet<string>): void {
    let changed = false;
    for (const sessionId of [...this.acknowledgedBySession.keys()]) {
      if (known.has(sessionId)) continue;
      this.acknowledgedBySession.delete(sessionId);
      changed = true;
    }
    if (changed) this.schedule();
  }

  /** Persist coalesced changes immediately, merging newer acknowledgments from another tab. */
  flush(): void {
    this.pending = false;
    if (!this.dirty) return;
    this.dirty = false;
    for (const [sessionId, seq] of parse(this.storage.get(READ_ACKNOWLEDGMENTS_KEY))) {
      const current = this.acknowledgedBySession.get(sessionId);
      if (current === undefined || seq > current) this.acknowledgedBySession.set(sessionId, seq);
    }
    const ack: Record<string, number> = {};
    for (const [sessionId, seq] of this.acknowledgedBySession) ack[sessionId] = seq;
    const record: StoredReadAcknowledgments = { version: VERSION, ack };
    this.storage.set(READ_ACKNOWLEDGMENTS_KEY, JSON.stringify(record));
  }

  private schedule(): void {
    this.dirty = true;
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => { if (this.pending) this.flush(); });
  }
}
