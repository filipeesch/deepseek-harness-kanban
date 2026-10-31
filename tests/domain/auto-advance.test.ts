import { describe, expect, it } from 'vitest';
import type { Column, Workflow } from '../../src/shared/types.js';
import { nextConfiguredColumn, resolveAutoAdvance } from '../../src/domain/auto-advance.js';

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
