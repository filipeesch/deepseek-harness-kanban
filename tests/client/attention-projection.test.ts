import { describe, expect, it } from 'vitest';
import { aggregateTaskAttention, normalizeBackground, projectConversation } from '../../src/client/attention-projection.js';
import { EMPTY_ATTENTION, type Attention, type ConversationFacts } from '../../src/shared/types.js';

function facts(overrides: Partial<ConversationFacts> = {}): ConversationFacts {
  return { running: false, background: [], awaitingReply: false, settledTurn: null, ...overrides };
}
const attention = (overrides: Partial<Attention> = {}): Attention => ({ ...EMPTY_ATTENTION, ...overrides });

describe('conversation attention projection', () => {
  it('marks an unacknowledged settled turn as unread only when no owned agent is running', () => {
    const settled = facts({ settledTurn: { seq: 4, outcome: 'ok' } });
    expect(projectConversation(settled, undefined, undefined).unread).toBe(true);
    expect(projectConversation(settled, undefined, 4).unread).toBe(false);
    expect(projectConversation(settled, undefined, 5).unread).toBe(false);
    expect(projectConversation(facts({ ...settled, running: true }), undefined, undefined)).toMatchObject({ running: true, unread: false, failed: false });
  });

  it('marks a failed settled turn red while it is unread and again after the next failure', () => {
    expect(projectConversation(facts({ settledTurn: { seq: 4, outcome: 'error' } }), undefined, undefined)).toMatchObject({ unread: true, failed: true });
    expect(projectConversation(facts({ settledTurn: { seq: 4, outcome: 'error' } }), undefined, 4)).toMatchObject({ unread: false, failed: false });
    expect(projectConversation(facts({ settledTurn: { seq: 9, outcome: 'error' } }), undefined, 4)).toMatchObject({ unread: true, failed: true });
    expect(projectConversation(facts({ settledTurn: { seq: 4, outcome: 'error' }, running: true }), undefined, undefined).failed).toBe(false);
  });

  it('treats a settled turn at sequence zero as unread until it is acknowledged', () => {
    const zero = facts({ settledTurn: { seq: 0, outcome: 'ok' } });
    expect(projectConversation(zero, undefined, undefined).unread).toBe(true);
    expect(projectConversation(zero, undefined, 0).unread).toBe(false);
    expect(projectConversation(facts({ settledTurn: { seq: 0, outcome: 'error' } }), undefined, undefined).failed).toBe(true);
  });

  it('combines the host awaiting-reply fact with the native pending interaction', () => {
    expect(projectConversation(facts({ awaitingReply: true }), undefined, undefined).awaitingReply).toBe(true);
    expect(projectConversation(facts(), { pendingInteraction: { key: 'pending' } }, undefined).awaitingReply).toBe(true);
    expect(projectConversation(facts(), { pendingInteraction: undefined }, undefined).awaitingReply).toBe(false);
  });

  it('orders and bounds background activity without sharing the source array', () => {
    const background = [
      { kind: 'schedule' as const, label: 'Wake later' },
      { kind: 'job' as const, label: 'Run tests' },
    ];
    const projected = projectConversation(facts({ background }), undefined, undefined);
    expect(projected.background).toEqual([{ kind: 'job', label: 'Run tests' }, { kind: 'schedule', label: 'Wake later' }]);
    expect(projected.background).not.toBe(background);
    expect(normalizeBackground([{ kind: 'job', label: 'x'.repeat(130) }])[0]?.label).toHaveLength(120);
    expect(normalizeBackground([{ kind: 'job', label: 'x'.repeat(130) }])[0]?.label.endsWith('…')).toBe(true);
    expect(normalizeBackground(Array.from({ length: 15 }, (_, index) => ({ kind: 'job' as const, label: 'job ' + index })))).toHaveLength(15);
  });
});

describe('task attention aggregation', () => {
  it('ORs every state and concatenates background across conversations', () => {
    expect(aggregateTaskAttention([
      attention({ running: true, awaitingReply: true }),
      attention({ background: [{ kind: 'schedule', label: 'Wake later' }, { kind: 'job', label: 'Run tests' }], unread: true, failed: true }),
    ])).toEqual({
      running: true,
      background: [{ kind: 'job', label: 'Run tests' }, { kind: 'schedule', label: 'Wake later' }],
      unread: true,
      awaitingReply: true,
      failed: true,
    });
  });

  it('returns the empty attention when the task has no conversations', () => {
    expect(aggregateTaskAttention([])).toBe(EMPTY_ATTENTION);
  });
});
