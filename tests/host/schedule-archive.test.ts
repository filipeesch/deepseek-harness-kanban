import { describe, expect, it } from 'vitest';
import type { ConversationFacts } from '../../src/shared/types.js';
import { ScheduleArchiveWatcher } from '../../src/host/schedule-archive.js';

function facts(overrides: Partial<ConversationFacts> = {}): ConversationFacts {
  return { running: false, background: [], pending: { kinds: [], queuedPrompts: 0 }, settledTurn: null, ...overrides };
}

function harness() {
  let current = facts();
  const archived: string[] = [];
  const errors: unknown[] = [];
  const failuresSeen: Array<{ scheduleId: string; sessionId: string }> = [];
  const archivedSeen: Array<{ scheduleId: string; sessionId: string }> = [];
  let reads = 0;
  const gates: Array<() => void> = [];
  let gateNext = false;
  let failures = 0;
  const watcher = new ScheduleArchiveWatcher({
    facts: async () => {
      reads += 1;
      const snapshot = current;
      if (gateNext) { gateNext = false; await new Promise<void>(resolve => { gates.push(resolve); }); }
      return snapshot;
    },
    archive: async sessionId => { if (failures > 0) { failures -= 1; throw new Error('session is still active'); } archived.push(sessionId); },
    onArchiveFailure: (scheduleId, sessionId) => failuresSeen.push({ scheduleId, sessionId }),
    onArchived: (scheduleId, sessionId) => archivedSeen.push({ scheduleId, sessionId }),
    report: error => errors.push(error),
    maxAttempts: 2,
  });
  return {
    watcher, archived, errors, failuresSeen, archivedSeen,
    reads: () => reads,
    setFacts: (next: ConversationFacts) => { current = next; },
    failNext: (count: number) => { failures = count; },
    gateNextRead: () => { gateNext = true; },
    releaseRead: () => { gates.shift()?.(); },
  };
}

const flush = async (): Promise<void> => { await new Promise(resolve => setTimeout(resolve, 0)); };

describe('ScheduleArchiveWatcher', () => {
  it('archives an idle conversation created by an occurrence', async () => {
    const harnessed = harness();
    harnessed.watcher.register('session', 'schedule');
    harnessed.watcher.observe('session');
    await flush();
    expect(harnessed.archived).toEqual(['session']);
    expect(harnessed.watcher.size).toBe(0);
  });

  it('keeps a conversation with a running turn, pending interaction, or background work', async () => {
    const harnessed = harness();
    harnessed.watcher.register('session', 'schedule');
    for (const busy of [
      facts({ running: true }),
      facts({ pending: { kinds: ['decision-question'], queuedPrompts: 0 } }),
      facts({ pending: { kinds: [], queuedPrompts: 1 } }),
      facts({ background: [{ kind: 'job', label: 'tests' }] }),
    ]) {
      harnessed.setFacts(busy);
      harnessed.watcher.observe('session');
      await flush();
      expect(harnessed.archived).toEqual([]);
      expect(harnessed.watcher.size).toBe(1);
    }
    harnessed.setFacts(facts());
    harnessed.watcher.observe('session');
    await flush();
    expect(harnessed.archived).toEqual(['session']);
  });

  it('retries after a refused archive and forgets after the attempt limit', async () => {
    const harnessed = harness();
    harnessed.watcher.register('session', 'schedule');
    harnessed.failNext(1);
    harnessed.watcher.observe('session');
    await flush();
    expect(harnessed.errors).toHaveLength(1);
    expect(harnessed.watcher.size).toBe(1);
    harnessed.watcher.observe('session');
    await flush();
    expect(harnessed.archived).toEqual(['session']);
    harnessed.watcher.register('other', 'schedule');
    harnessed.failNext(2);
    harnessed.watcher.observe('other');
    await flush();
    harnessed.watcher.observe('other');
    await flush();
    expect(harnessed.watcher.size).toBe(0);
  });


  it('coalesces an observation that arrives during an awaited evaluation', async () => {
    const harnessed = harness();
    harnessed.watcher.register('session', 'schedule');
    harnessed.setFacts(facts({ running: true }));
    harnessed.gateNextRead();
    harnessed.watcher.observe('session');
    await flush();
    expect(harnessed.reads()).toBe(1);
    // The first read captured busy facts; the conversation is idle by the time
    // the final observation arrives.
    harnessed.setFacts(facts());
    harnessed.watcher.observe('session');
    harnessed.releaseRead();
    await flush();
    expect(harnessed.archived).toEqual(['session']);
    expect(harnessed.reads()).toBe(2);
  });

  it('records and clears an archive failure for its schedule', async () => {
    const harnessed = harness();
    harnessed.watcher.register('session', 'schedule');
    harnessed.failNext(1);
    harnessed.watcher.observe('session');
    await flush();
    expect(harnessed.failuresSeen).toEqual([{ scheduleId: 'schedule', sessionId: 'session' }]);
    harnessed.watcher.observe('session');
    await flush();
    expect(harnessed.archivedSeen).toEqual([{ scheduleId: 'schedule', sessionId: 'session' }]);
    expect(harnessed.archived).toEqual(['session']);
  });

  it('records each failed attempt until the conversation is left visible', async () => {
    const harnessed = harness();
    harnessed.watcher.register('session', 'schedule');
    harnessed.failNext(2);
    harnessed.watcher.observe('session');
    await flush();
    harnessed.watcher.observe('session');
    await flush();
    expect(harnessed.failuresSeen).toHaveLength(2);
    expect(harnessed.watcher.size).toBe(0);
  });

  it('ignores unknown sessions, forgotten sessions, and a disposed watcher', async () => {
    const harnessed = harness();
    harnessed.watcher.observe('unknown');
    await flush();
    expect(harnessed.archived).toEqual([]);
    harnessed.watcher.register('session', 'schedule');
    harnessed.watcher.forget('session');
    harnessed.watcher.observe('session');
    await flush();
    expect(harnessed.archived).toEqual([]);
    harnessed.watcher.register('other', 'schedule');
    harnessed.watcher.dispose();
    harnessed.watcher.observe('other');
    await flush();
    expect(harnessed.archived).toEqual([]);
  });
});