import { describe, expect, it } from 'vitest';
import { aggregateTaskAttention, normalizeBackground, projectConversation } from '../../src/client/attention-projection.js';
import { pendingUserWork } from '../../src/domain/pending-user-work.js';
import { EMPTY_ATTENTION, NO_PENDING_USER_WORK, type Attention, type ConversationFacts } from '../../src/shared/types.js';

function facts(overrides: Partial<ConversationFacts> = {}): ConversationFacts {
  return { running: false, background: [], pending: NO_PENDING_USER_WORK, settledTurn: null, ...overrides };
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

  it('derives awaiting reply from the pending kinds and folds the native pending interaction in', () => {
    const question = projectConversation(facts({ pending: pendingUserWork(['decision-question']) }), undefined, undefined);
    expect(question).toMatchObject({ awaitingReply: true, pending: { kinds: ['decision-question'], queuedPrompts: 0 } });
    const native = projectConversation(facts(), { pendingInteraction: { key: 'pending' } }, undefined);
    expect(native.awaitingReply).toBe(true);
    expect(native.pending.kinds).toEqual(['native-question']);
    expect(projectConversation(facts(), { pendingInteraction: undefined }, undefined).awaitingReply).toBe(false);
  });

  it('names a pending approval by its interaction kind and never overrides the host reason', () => {
    const approval = projectConversation(facts(), { pendingInteraction: { kind: 'permission', key: 'k' } }, undefined);
    expect(approval.pending.kinds).toEqual(['approval']);
    expect(approval.awaitingReply).toBe(true);
    const hostApproval = projectConversation(facts({ pending: pendingUserWork(['approval']) }), { pendingInteraction: { kind: 'confirmation', key: 'k' } }, undefined);
    expect(hostApproval.pending.kinds).toEqual(['approval']);
    expect(projectConversation(facts(), { pendingInteraction: { key: 'k' } }, undefined).pending.kinds).toEqual(['native-question']);
  });

  it('keeps a queued prompt pending without presenting an awaiting reply', () => {
    const queued = projectConversation(facts({ pending: pendingUserWork(['queued-prompt'], 2) }), undefined, undefined);
    expect(queued.pending).toEqual({ kinds: ['queued-prompt'], queuedPrompts: 2 });
    expect(queued.awaitingReply).toBe(false);
    expect(projectConversation(facts({ pending: pendingUserWork(['approval']) }), undefined, undefined).awaitingReply).toBe(true);
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
      attention({ running: true, awaitingReply: true, pending: pendingUserWork(['native-question']) }),
      attention({ background: [{ kind: 'schedule', label: 'Wake later' }, { kind: 'job', label: 'Run tests' }], unread: true, failed: true }),
    ])).toEqual({
      running: true,
      background: [{ kind: 'job', label: 'Run tests' }, { kind: 'schedule', label: 'Wake later' }],
      unread: true,
      awaitingReply: true,
      failed: true,
      pending: { kinds: ['native-question'], queuedPrompts: 0 },
    });
  });

  it('returns the empty attention when the task has no conversations', () => {
    expect(aggregateTaskAttention([])).toBe(EMPTY_ATTENTION);
  });

  it('merges pending user work across conversations, including a closed one', () => {
    const merged = aggregateTaskAttention([
      attention({ pending: pendingUserWork(['decision-question']) }),
      projectConversation(facts({ pending: pendingUserWork(['queued-prompt'], 2) }), undefined, undefined),
    ]);
    expect(merged.pending).toEqual({ kinds: ['decision-question', 'queued-prompt'], queuedPrompts: 2 });
    expect(EMPTY_ATTENTION.pending).toBe(NO_PENDING_USER_WORK);
  });
});
