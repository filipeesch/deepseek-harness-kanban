import { describe, expect, it } from 'vitest';
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client';
import { AttentionProjector, RunningSessions, sameAttention } from '../../src/client/kanban-attention.js';
import type { Attention, KanbanState } from '../../src/shared/types.js';
import { EMPTY_CONVERSATION_FACTS, NO_PENDING_USER_WORK } from '../../src/shared/types.js';

const now = '2026-11-08T00:00:00Z';
const state: KanbanState = {
  hubs: [{
    id: 'hub', name: 'Hub', revision: 1, projects: [], boards: [], notes: [], createdAt: now, updatedAt: now,
    tasks: [
      { id: 't1', boardId: 'b', projectId: 'p', title: 'One', description: '', columnId: 'backlog', position: 0, sessionIds: ['s1'], closedSessionIds: [], effectiveCwd: '/p', worktree: null, operation: null, createdAt: now, updatedAt: now },
      { id: 't2', boardId: 'b', projectId: 'p', title: 'Two', description: '', columnId: 'backlog', position: 1, sessionIds: ['s2'], closedSessionIds: [], effectiveCwd: '/p', worktree: null, operation: null, createdAt: now, updatedAt: now },
    ],
  }],
  settings: { revision: 0 },
};
const emptyStatuses: SessionStatusSnapshot = new Map();

describe('attention projection identity', () => {
  it('keeps the previous object for a task whose presentation did not change', () => {
    const projector = new AttentionProjector();
    const first = projector.project({ state, conversations: { s1: EMPTY_CONVERSATION_FACTS, s2: EMPTY_CONVERSATION_FACTS } }, emptyStatuses, () => undefined);
    const second = projector.project({ state, conversations: { s1: EMPTY_CONVERSATION_FACTS, s2: EMPTY_CONVERSATION_FACTS } }, emptyStatuses, () => undefined);
    expect(second.attention.t1).toBe(first.attention.t1);
    expect(second.attention.t2).toBe(first.attention.t2);
    expect(second.conversationAttention.s1).toBe(first.conversationAttention.s1);
  });

  it('replaces only the task whose facts changed', () => {
    const projector = new AttentionProjector();
    const first = projector.project({ state, conversations: { s1: EMPTY_CONVERSATION_FACTS, s2: EMPTY_CONVERSATION_FACTS } }, emptyStatuses, () => undefined);
    const second = projector.project({ state, conversations: { s1: { ...EMPTY_CONVERSATION_FACTS, running: true }, s2: EMPTY_CONVERSATION_FACTS } }, emptyStatuses, () => undefined);
    expect(second.attention.t1).not.toBe(first.attention.t1);
    expect(second.attention.t2).toBe(first.attention.t2);
  });

  it('compares attention by presentation, not by object identity', () => {
    const base: Attention = { running: false, background: [], unread: false, awaitingReply: false, failed: false, pending: NO_PENDING_USER_WORK };
    expect(sameAttention(base, structuredClone(base))).toBe(true);
    expect(sameAttention(base, { ...base, running: true })).toBe(false);
    expect(sameAttention(base, { ...base, unread: true })).toBe(false);
    expect(sameAttention(base, { ...base, background: [{ kind: 'job', label: 'Run tests' }] })).toBe(false);
  });
});

describe('rising running sessions', () => {
  it('reports only the conversations that started running', () => {
    const running = new RunningSessions();
    expect(running.sync(new Map([['a', { running: false }], ['b', { running: false }]] as never))).toEqual([]);
    expect(running.sync(new Map([['a', { running: true }], ['b', { running: false }]] as never))).toEqual(['a']);
    expect(running.sync(new Map([['a', { running: true }]] as never))).toEqual([]);
    expect(running.sync(new Map([['a', { running: false }], ['b', { running: true }]] as never))).toEqual(['b']);
  });
});
