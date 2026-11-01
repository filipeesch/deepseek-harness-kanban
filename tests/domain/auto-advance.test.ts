import { describe, expect, it } from 'vitest';
import type { Column, ConversationFacts, Task, Workflow } from '../../src/shared/types.js';
import { EMPTY_CONVERSATION_FACTS } from '../../src/shared/types.js';
import { pendingUserWork } from '../../src/domain/pending-user-work.js';
import { nextConfiguredColumn, resolveAdvanceDecision, resolveAutoAdvance } from '../../src/domain/auto-advance.js';

const column = (id: string, extra: Partial<Column> = {}): Column => ({ id, name: id.toUpperCase(), ...extra });
const flow = (...columns: Column[]): Workflow => ({ name: 'Flow', initialColumnId: columns[0]!.id, columns, groups: [] });

describe('nextConfiguredColumn', () => {
  it('prefers the first configured transition over workflow order', () => {
    const workflow = flow(column('backlog', { allowedTransitions: ['done', 'plan'] }), column('plan'), column('done'));
    expect(nextConfiguredColumn(workflow, 'backlog')?.id).toBe('done');
  });

  it('uses the next stage in workflow order when transitions are not configured', () => {
    const workflow = flow(column('backlog'), column('plan'), column('done'));
    expect(nextConfiguredColumn(workflow, 'backlog')?.id).toBe('plan');
  });

  it('has no destination for an empty transition list, a self transition, or an unknown stage', () => {
    expect(nextConfiguredColumn(flow(column('backlog', { allowedTransitions: [] }), column('plan')), 'backlog')).toBeUndefined();
    expect(nextConfiguredColumn(flow(column('backlog', { allowedTransitions: ['backlog'] }), column('plan')), 'backlog')).toBeUndefined();
    expect(nextConfiguredColumn(flow(column('backlog'), column('plan')), 'missing')).toBeUndefined();
  });

  it('has no destination after the last stage', () => {
    expect(nextConfiguredColumn(flow(column('backlog'), column('done')), 'done')).toBeUndefined();
  });
});

describe('resolveAutoAdvance', () => {
  it('stops at the next stage when it has an instruction', () => {
    const workflow = flow(column('backlog'), column('plan', { onEnterPrompt: 'Plan it.' }), column('done'));
    const plan = resolveAutoAdvance(workflow, 'backlog');
    expect(plan.fromColumnId).toBe('backlog');
    expect(plan.path.map(value => value.id)).toEqual(['plan']);
    expect(plan.destination?.id).toBe('plan');
    expect(plan.instruction).toBe('Plan it.');
  });

  it('crosses stages without an instruction to the first instructed stage', () => {
    const workflow = flow(column('backlog'), column('plan'), column('implementation'), column('review', { onEnterPrompt: 'Review it.' }), column('done'));
    const plan = resolveAutoAdvance(workflow, 'backlog');
    expect(plan.path.map(value => value.id)).toEqual(['plan', 'implementation', 'review']);
    expect(plan.destination?.id).toBe('review');
    expect(plan.instruction).toBe('Review it.');
  });

  it('ends at the last reachable stage when no stage has an instruction', () => {
    const workflow = flow(column('backlog'), column('plan'), column('implementation'), column('done'));
    const plan = resolveAutoAdvance(workflow, 'backlog');
    expect(plan.path.map(value => value.id)).toEqual(['plan', 'implementation', 'done']);
    expect(plan.destination?.id).toBe('done');
    expect(plan.instruction).toBeUndefined();
  });

  it('follows the first configured transition for each crossed stage', () => {
    const workflow = flow(
      column('backlog', { allowedTransitions: ['review', 'plan'] }),
      column('plan'),
      column('review', { allowedTransitions: ['done'], onEnterPrompt: 'Review it.' }),
      column('done'),
    );
    const plan = resolveAutoAdvance(workflow, 'backlog');
    expect(plan.path.map(value => value.id)).toEqual(['review']);
    expect(plan.instruction).toBe('Review it.');
  });

  it('never revisits a stage in a configured cycle', () => {
    const workflow = flow(
      column('backlog', { allowedTransitions: ['plan'] }),
      column('plan', { allowedTransitions: ['backlog'] }),
    );
    const plan = resolveAutoAdvance(workflow, 'backlog');
    expect(plan.path.map(value => value.id)).toEqual(['plan']);
    expect(plan.destination?.id).toBe('plan');
  });

  it('stops before repeating a stage even when an instruction is later in the cycle', () => {
    const workflow = flow(
      column('backlog', { allowedTransitions: ['plan'] }),
      column('plan', { allowedTransitions: ['backlog'] }),
      column('done', { onEnterPrompt: 'Finish it.' }),
    );
    const plan = resolveAutoAdvance(workflow, 'backlog');
    expect(plan.path.map(value => value.id)).toEqual(['plan']);
    expect(plan.instruction).toBeUndefined();
  });

  it('treats a whitespace-only instruction as no instruction', () => {
    const workflow = flow(column('backlog'), column('plan', { onEnterPrompt: '   ' }), column('done', { onEnterPrompt: 'Done.' }));
    const plan = resolveAutoAdvance(workflow, 'backlog');
    expect(plan.path.map(value => value.id)).toEqual(['plan', 'done']);
    expect(plan.instruction).toBe('Done.');
  });

  it('returns an empty plan for a stage outside the workflow or a dead end', () => {
    expect(resolveAutoAdvance(flow(column('backlog'), column('done')), 'missing')).toEqual({ fromColumnId: 'missing', path: [] });
    expect(resolveAutoAdvance(flow(column('backlog')), 'backlog')).toEqual({ fromColumnId: 'backlog', path: [] });
    expect(resolveAutoAdvance(flow(column('backlog', { allowedTransitions: [] }), column('done')), 'backlog')).toEqual({ fromColumnId: 'backlog', path: [] });
  });
});

const task = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1', projectId: 'project-1', title: 'Task', description: '', columnId: 'plan', position: 0,
  sessionIds: ['s1', 's2'], closedSessionIds: [], effectiveCwd: '/repo',
  worktree: null, operation: null, createdAt: 'now', updatedAt: 'now', ...overrides,
});
const factsOf = (overrides: Partial<ConversationFacts> = {}): ConversationFacts => ({ ...EMPTY_CONVERSATION_FACTS, ...overrides });
const mapOf = (entries: Record<string, ConversationFacts>) => new Map(Object.entries(entries));

describe('resolveAdvanceDecision', () => {
  it('advances when the task is idle and owes the user nothing', () => {
    expect(resolveAdvanceDecision(task(), mapOf({ s1: factsOf(), s2: factsOf() }))).toEqual({ kind: 'advance' });
  });

  it('treats an unresolved entry, operation, or transition as busy before anything else', () => {
    const pending = { s1: factsOf({ pending: pendingUserWork(['decision-question']) }) };
    expect(resolveAdvanceDecision(task({ instructionPending: { columnId: 'plan', enteredAt: 1 } }), mapOf(pending))).toEqual({ kind: 'busy' });
    expect(resolveAdvanceDecision(task({ operation: { id: 'o', request: { kind: 'return' }, phase: 'queued', previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt: 'now' } }), mapOf(pending))).toEqual({ kind: 'busy' });
    expect(resolveAdvanceDecision(task({ pendingTransition: { id: 'p', fromColumnId: 'plan', columnId: 'done', mode: 'move', status: 'waiting' } }), mapOf(pending))).toEqual({ kind: 'busy' });
  });

  it('reports only open conversations that are still executing', () => {
    const decision = resolveAdvanceDecision(task({ closedSessionIds: ['s2'] }), mapOf({ s1: factsOf({ running: true }), s2: factsOf({ running: true }) }));
    expect(decision).toEqual({ kind: 'running', sessions: ['s1'] });
    expect(resolveAdvanceDecision(task({ closedSessionIds: ['s2'] }), mapOf({ s1: factsOf(), s2: factsOf({ running: true }) }))).toEqual({ kind: 'advance' });
  });

  it('holds for pending user work merged across every conversation, including a closed one', () => {
    const decision = resolveAdvanceDecision(task({ closedSessionIds: ['s2'] }), mapOf({
      s1: factsOf(),
      s2: factsOf({ pending: pendingUserWork(['decision-question']) }),
    }));
    expect(decision).toEqual({ kind: 'pending', pending: { kinds: ['decision-question'], queuedPrompts: 0 } });
  });

  it('holds for a queued prompt alone and merges queues across conversations', () => {
    const single = resolveAdvanceDecision(task({ sessionIds: ['s1'] }), mapOf({ s1: factsOf({ pending: pendingUserWork(['queued-prompt'], 1) }) }));
    expect(single).toEqual({ kind: 'pending', pending: { kinds: ['queued-prompt'], queuedPrompts: 1 } });
    const merged = resolveAdvanceDecision(task(), mapOf({ s1: factsOf({ pending: pendingUserWork(['queued-prompt'], 2) }), s2: factsOf({ pending: pendingUserWork(['queued-prompt'], 1) }) }));
    expect(merged).toEqual({ kind: 'pending', pending: { kinds: ['queued-prompt'], queuedPrompts: 3 } });
  });

  it('prefers a running conversation over pending work, so the settle retry still applies', () => {
    const decision = resolveAdvanceDecision(task(), mapOf({
      s1: factsOf({ running: true }),
      s2: factsOf({ pending: pendingUserWork(['approval']) }),
    }));
    expect(decision.kind).toBe('running');
  });
});
