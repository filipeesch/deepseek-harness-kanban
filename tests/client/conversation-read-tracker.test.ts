import { describe, expect, it } from 'vitest';
import { ConversationReadTracker } from '../../src/client/conversation-read-tracker.js';
import { browserStorage, type KeyValueStorage } from '../../src/client/key-value-storage.js';
import { READ_ACKNOWLEDGMENTS_KEY, ReadAcknowledgments } from '../../src/client/read-acknowledgments.js';
import type { ConversationFacts } from '../../src/shared/types.js';

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return { values, get: key => values.get(key) ?? null, set: (key, value) => { if (value === null) values.delete(key); else values.set(key, value); } };
}
function facts(overrides: Partial<ConversationFacts> = {}): ConversationFacts {
  return { running: false, background: [], awaitingReply: false, settledTurn: null, ...overrides };
}

describe('key-value storage', () => {
  it('reads and writes through the browser adapter, and never throws when storage is unavailable', () => {
    const storage = browserStorage();
    expect(storage.get('missing')).toBeNull();
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    try {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('storage blocked'); } });
      expect(storage.get('anything')).toBeNull();
      expect(() => storage.set('anything', 'value')).not.toThrow();
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
    }
  });
});

describe('read acknowledgments', () => {
  it('starts empty, persists a versioned record, and reloads it in a new instance', () => {
    const storage = memoryStorage();
    const reads = new ReadAcknowledgments(storage);
    expect(reads.acknowledged('s1')).toBeUndefined();
    reads.acknowledge('s1', 7);
    reads.acknowledge('s1', 3);
    reads.flush();
    expect(JSON.parse(storage.values.get(READ_ACKNOWLEDGMENTS_KEY)!)).toEqual({ version: 1, ack: { s1: 7 } });
    expect(new ReadAcknowledgments(storage).acknowledged('s1')).toBe(7);
  });

  it('merges acknowledgments from another tab instead of replacing the record', () => {
    const storage = memoryStorage();
    const first = new ReadAcknowledgments(storage);
    const second = new ReadAcknowledgments(storage);
    first.acknowledge('s1', 1); first.flush();
    second.acknowledge('s2', 2); second.flush();
    const reloaded = new ReadAcknowledgments(storage);
    expect(reloaded.acknowledged('s1')).toBe(1);
    expect(reloaded.acknowledged('s2')).toBe(2);
  });

  it('prunes conversations that no longer belong to a task', () => {
    const storage = memoryStorage();
    const reads = new ReadAcknowledgments(storage);
    reads.acknowledge('s1', 1);
    reads.acknowledge('s2', 2);
    reads.prune(new Set(['s1']));
    reads.flush();
    expect(reads.acknowledged('s2')).toBeUndefined();
    expect(JSON.parse(storage.values.get(READ_ACKNOWLEDGMENTS_KEY)!)).toEqual({ version: 1, ack: { s1: 1 } });
  });

  it('falls back to an empty map for a damaged or unknown record', () => {
    for (const raw of ['not json', '[]', JSON.stringify({ version: 2, ack: { s1: 3 } }), JSON.stringify({ version: 1, ack: { s1: '3' } }), JSON.stringify({ version: 1, ack: [] })]) {
      expect(new ReadAcknowledgments(memoryStorage({ [READ_ACKNOWLEDGMENTS_KEY]: raw })).acknowledged('s1')).toBeUndefined();
    }
  });
});

describe('conversation read tracker', () => {
  it('acknowledges the settled turn when a conversation is viewed and only that conversation', () => {
    const reads = new ReadAcknowledgments(memoryStorage());
    const tracker = new ConversationReadTracker(reads);
    tracker.sync({ s1: facts({ settledTurn: { seq: 4, outcome: 'ok' } }), s2: facts({ settledTurn: { seq: 8, outcome: 'error' } }) });
    const release = tracker.view('s1');
    expect(tracker.acknowledged('s1')).toBe(4);
    expect(tracker.acknowledged('s2')).toBeUndefined();
    release();
  });

  it('does not acknowledge a conversation that is not being read', () => {
    const reads = new ReadAcknowledgments(memoryStorage());
    const tracker = new ConversationReadTracker(reads);
    tracker.sync({ s1: facts({ settledTurn: { seq: 4, outcome: 'ok' } }) });
    expect(tracker.acknowledged('s1')).toBeUndefined();
  });

  it('acknowledges a turn that settles while its content is mounted and visible', () => {
    const reads = new ReadAcknowledgments(memoryStorage());
    const tracker = new ConversationReadTracker(reads);
    tracker.sync({ s1: facts() });
    const release = tracker.view('s1');
    tracker.sync({ s1: facts({ settledTurn: { seq: 5, outcome: 'error' } }) });
    expect(tracker.acknowledged('s1')).toBe(5);
    release();
  });

  it('acknowledges the settled turn when a tab closes and keeps a later failure unread', () => {
    const reads = new ReadAcknowledgments(memoryStorage());
    const tracker = new ConversationReadTracker(reads);
    tracker.sync({ s1: facts({ settledTurn: { seq: 4, outcome: 'ok' } }) });
    tracker.close('s1');
    expect(tracker.acknowledged('s1')).toBe(4);
    tracker.sync({ s1: facts({ settledTurn: { seq: 9, outcome: 'error' } }) });
    expect(tracker.acknowledged('s1')).toBe(4);
  });
});
