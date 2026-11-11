import { describe, expect, it } from 'vitest';
import type { Column, Workflow } from '../../src/shared/types.js';
import { advanceArmed, declaredTransitionReason, recordedTransition, resolveAdvanceRoute, resolveNextStageRoute, routeDestination } from '../../src/domain/transition-route.js';
import { transitions } from '../support/transition-rules.js';

const column = (id: string, extra: Partial<Column> = {}): Column => ({ id, name: id.toUpperCase(), ...extra });
const flow = (...columns: Column[]): Workflow => ({ name: 'Flow', initialColumnId: columns[0]!.id, columns, groups: [] });

function workflow(): Workflow {
  return flow(
    column('backlog'),
    column('review', { onEnterPrompt: 'Review it.', allowedTransitions: transitions('done', 'rework') }),
    column('rework', { onEnterPrompt: 'Rework it.' }),
    column('done'),
  );
}

const recorded = (fromColumnId: string, columnId: string, reason?: string) => ({ fromColumnId, columnId, at: '2026-01-01T00:00:00.000Z', ...(reason === undefined ? {} : { reason }) });

describe('recorded transition resolution', () => {
  it('resolves nothing without a recording', () => {
    expect(recordedTransition(workflow(), { columnId: 'review' })).toEqual({ kind: 'none' });
  });

  it('resolves a configured target of the current stage', () => {
    const resolution = recordedTransition(workflow(), { columnId: 'review', recordedTransition: recorded('review', 'rework') });
    expect(resolution.kind).toBe('resolved');
    expect(resolution.kind === 'resolved' && resolution.column.id).toBe('rework');
  });

  it('ignores a recording made for another stage instead of failing it', () => {
    expect(recordedTransition(workflow(), { columnId: 'backlog', recordedTransition: recorded('review', 'done') })).toEqual({ kind: 'none' });
  });

  it('reports a target stage that no longer exists', () => {
    const resolution = recordedTransition(workflow(), { columnId: 'review', recordedTransition: recorded('review', 'gone') });
    expect(resolution).toEqual({ kind: 'stale', reason: 'missing-stage' });
  });

  it('reports a stage that no longer configures transitions', () => {
    const wf = flow(column('backlog'), column('review'), column('done'));
    expect(recordedTransition(wf, { columnId: 'review', recordedTransition: recorded('review', 'done') })).toEqual({ kind: 'stale', reason: 'not-configured' });
  });

  it('reports a target the stage no longer configures', () => {
    const wf = flow(column('backlog'), column('review', { allowedTransitions: transitions('done') }), column('rework'), column('done'));
    expect(recordedTransition(wf, { columnId: 'review', recordedTransition: recorded('review', 'rework') })).toEqual({ kind: 'stale', reason: 'not-allowed' });
  });
});

describe('route destination', () => {
  it('prefers the recording over the workflow default', () => {
    const route = routeDestination(workflow(), { columnId: 'review', recordedTransition: recorded('review', 'rework') });
    expect(route).toMatchObject({ kind: 'resolved', source: 'recorded' });
    expect(route.kind === 'resolved' && route.column.id).toBe('rework');
  });

  it('falls back to the default destination without a recording', () => {
    const route = routeDestination(workflow(), { columnId: 'review' });
    expect(route).toMatchObject({ kind: 'resolved', source: 'default' });
    expect(route.kind === 'resolved' && route.column.id).toBe('done');
  });

  it('reports a stale recording with an explanation instead of falling back', () => {
    const route = routeDestination(workflow(), { columnId: 'review', recordedTransition: recorded('review', 'gone') });
    expect(route.kind).toBe('stale');
    expect(route.kind === 'stale' && route.message).toContain('no longer exists');
  });

  it('has no destination at the end of the workflow', () => {
    expect(routeDestination(workflow(), { columnId: 'done' })).toEqual({ kind: 'none' });
  });
});

describe('next-stage route', () => {
  it('follows a resolved recording', () => {
    const route = resolveNextStageRoute(workflow(), { columnId: 'review', recordedTransition: recorded('review', 'rework') });
    expect(route).toMatchObject({ kind: 'advance', source: 'recorded' });
    expect(route.kind === 'advance' && route.column.id).toBe('rework');
  });

  it('steps to the adjacent stage in workflow order without a recording', () => {
    const route = resolveNextStageRoute(workflow(), { columnId: 'review' });
    expect(route).toMatchObject({ kind: 'advance', source: 'default' });
    expect(route.kind === 'advance' && route.column.id).toBe('rework');
  });

  it('has no destination on the last stage without a recording', () => {
    expect(resolveNextStageRoute(workflow(), { columnId: 'done' })).toEqual({ kind: 'none' });
  });

  it('reports a stale recording instead of stepping forward', () => {
    const route = resolveNextStageRoute(workflow(), { columnId: 'review', recordedTransition: recorded('review', 'gone') });
    expect(route.kind).toBe('stale');
  });
});

describe('advance arming', () => {
  it('arms an auto-mode task without a recording', () => {
    expect(advanceArmed(workflow(), { columnId: 'review', autoMode: { enabled: true } })).toBe(true);
  });

  it('does not arm a task whose auto mode is disabled and that recorded nothing', () => {
    expect(advanceArmed(workflow(), { columnId: 'review' })).toBe(false);
    expect(advanceArmed(workflow(), { columnId: 'review', autoMode: { enabled: false } })).toBe(false);
  });

  it('arms the turn after a declared transition that carries a reason', () => {
    expect(advanceArmed(workflow(), { columnId: 'review', recordedTransition: recorded('review', 'rework', 'Needs another pass.') })).toBe(true);
  });

  it('keeps a recording stored without a reason inert', () => {
    expect(advanceArmed(workflow(), { columnId: 'review', recordedTransition: recorded('review', 'rework') })).toBe(false);
  });

  it('does not arm a recording that no longer resolves', () => {
    expect(advanceArmed(workflow(), { columnId: 'review', recordedTransition: recorded('review', 'gone', 'Review failed.') })).toBe(false);
  });

  it('resolves the declared reason for the delivery', () => {
    expect(declaredTransitionReason(workflow(), { columnId: 'review', recordedTransition: recorded('review', 'done', 'Approved.') })).toBe('Approved.');
    expect(declaredTransitionReason(workflow(), { columnId: 'review', recordedTransition: recorded('review', 'done') })).toBeUndefined();
    expect(declaredTransitionReason(workflow(), { columnId: 'review' })).toBeUndefined();
  });
});

describe('advance route', () => {
  it('stops exactly at the recorded destination', () => {
    const route = resolveAdvanceRoute(workflow(), { columnId: 'review', recordedTransition: recorded('review', 'done') });
    expect(route.kind).toBe('advance');
    if (route.kind !== 'advance') return;
    expect(route.source).toBe('recorded');
    expect(route.plan.path.map(value => value.id)).toEqual(['done']);
    expect(route.plan.instruction).toBeUndefined();
  });

  it('captures the recorded destination instruction', () => {
    const route = resolveAdvanceRoute(workflow(), { columnId: 'review', recordedTransition: recorded('review', 'rework') });
    expect(route.kind === 'advance' && route.plan.instruction).toBe('Rework it.');
  });

  it('keeps the default crossing rule without a recording', () => {
    const wf = flow(column('backlog'), column('review'), column('apply'), column('done', { onEnterPrompt: 'Finish it.' }));
    const route = resolveAdvanceRoute(wf, { columnId: 'backlog' });
    expect(route.kind).toBe('advance');
    if (route.kind !== 'advance') return;
    expect(route.source).toBe('default');
    expect(route.plan.path.map(value => value.id)).toEqual(['review', 'apply', 'done']);
  });

  it('reports a stale recording and no destination as their own outcomes', () => {
    expect(resolveAdvanceRoute(workflow(), { columnId: 'review', recordedTransition: recorded('review', 'gone') }).kind).toBe('stale');
    expect(resolveAdvanceRoute(workflow(), { columnId: 'done' })).toEqual({ kind: 'none' });
  });
});
