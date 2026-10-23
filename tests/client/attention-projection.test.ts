import { describe, expect, it } from 'vitest';
import type { SessionStatus, SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import { projectTaskAttention, ReminderTracker } from '../../src/client/attention.js';
import type { Attention } from '../../src/shared/types.js';

function status(running = false, completionUnread = false, pending = false): SessionStatus {
  return {
    running,
    completionUnread,
    pendingInteraction: pending ? { key: 'pending', kind: 'approval', sessionId: 'a' as SessionId } : undefined,
  };
}
function statuses(entries: Array<[string, SessionStatus]>): SessionStatusSnapshot {
  return new Map(entries.map(([id, value]) => [id as SessionId, value]));
}
function attention(overrides: Partial<Attention> = {}): Attention {
  return { running: false, background: [], unread: false, awaitingReply: false, failed: false, ...overrides };
}

describe('task attention projection', () => {
  it('keeps the host as the only owner of turn execution', () => {
    const tracker = new ReminderTracker();
    const running = statuses([['a', status(true)]]);
    // A stale native running flag cannot keep the card working once the host reports idle.
    expect(projectTaskAttention(attention({ running: false }), running, tracker, ['a']).running).toBe(false);
    // The host still owns the turn while the native status is idle.
    expect(projectTaskAttention(attention({ running: true }), statuses([['a', status(false)]]), tracker, ['a']).running).toBe(true);
  });

  it('passes host background activity through without sharing the host array', () => {
    const host = attention({ background: [{ kind: 'job', label: 'Run tests' }, { kind: 'subagent', label: 'Research' }] });
    const projected = projectTaskAttention(host, statuses([]), new ReminderTracker(), ['a']);
    expect(projected.background).toEqual(host.background);
    expect(projected.background).not.toBe(host.background);
  });

  it('keeps unread until the conversation is actually viewed and resets it on a new run', () => {
    const tracker = new ReminderTracker();
    tracker.sync(statuses([['a', status(false, true)], ['b', status(false, true)]]));
    expect(projectTaskAttention(attention(), statuses([['a', status(false, true)], ['b', status(false, true)]]), tracker, ['a']).unread).toBe(true);
    const release = tracker.view('a');
    expect(projectTaskAttention(attention(), statuses([['a', status(false, true)], ['b', status(false, true)]]), tracker, ['a']).unread).toBe(false);
    expect(projectTaskAttention(attention(), statuses([['a', status(false, true)], ['b', status(false, true)]]), tracker, ['b']).unread).toBe(true);
    release();
    tracker.sync(statuses([['a', status(true)], ['b', status(false, true)]]));
    tracker.sync(statuses([['a', status(false, true)], ['b', status(false, true)]]));
    expect(projectTaskAttention(attention(), statuses([['a', status(false, true)], ['b', status(false, true)]]), tracker, ['a']).unread).toBe(true);
  });

  it('combines host and native awaiting-reply facts and keeps failure from the host', () => {
    const projected = projectTaskAttention(
      attention({ awaitingReply: false, failed: true }),
      statuses([['a', status(false, false, true)]]),
      new ReminderTracker(),
      ['a'],
    );
    expect(projected.awaitingReply).toBe(true);
    expect(projected.failed).toBe(true);
  });

  it('seeds a task with no host attention from client-owned facts only', () => {
    const tracker = new ReminderTracker();
    tracker.sync(statuses([['a', status(true, true, true)]]));
    const projected = projectTaskAttention(undefined, statuses([['a', status(true, true, true)]]), tracker, ['a']);
    expect(projected).toEqual({ running: false, background: [], unread: true, awaitingReply: true, failed: false });
  });

  it('ignores conversations absent from the native status snapshot', () => {
    expect(projectTaskAttention(attention({ running: true }), statuses([]), new ReminderTracker(), ['missing']).running).toBe(true);
  });
});

describe('reminder tracker', () => {
  it('acknowledges while a viewer is attached and re-surfaces a later unread edge', () => {
    const tracker = new ReminderTracker();
    tracker.sync(statuses([['a', status(false, true)]]));
    const release = tracker.view('a');
    expect(tracker.isUnread('a')).toBe(false);
    tracker.sync(statuses([['a', status(true)]]));
    tracker.sync(statuses([['a', status(false, true)]]));
    expect(tracker.isUnread('a')).toBe(false); // Still viewed: the new completion is acknowledged.
    release();
    tracker.sync(statuses([['a', status(false, false)]]));
    tracker.sync(statuses([['a', status(false, true)]]));
    expect(tracker.isUnread('a')).toBe(true);
  });

  it('releases viewers idempotently and clears removed conversations', () => {
    const tracker = new ReminderTracker();
    tracker.sync(statuses([['a', status(false, true)]]));
    const release = tracker.view('a');
    release(); release();
    expect(tracker.isUnread('b')).toBe(true);
    tracker.sync(statuses([]));
    expect(tracker.isUnread('a')).toBe(false);
  });
});
