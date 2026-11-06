import { describe, expect, it } from 'vitest';
import { applySharingPlan } from '../../src/domain/sharing/apply.js';
import { buildUpdatePlan, compareSharing } from '../../src/domain/sharing/plan.js';
import { projectSharingBoards } from '../../src/domain/sharing/projection.js';
import { documentOf, flow, hubWith } from '../support/sharing-fixtures.js';

const deps = { id: (() => { let value = 0; return () => 'created-' + (++value); })(), now: () => '2026-02-01T00:00:00.000Z' };

describe('sharing plan application', () => {
  it('updates an existing board and creates a published board in one plan', () => {
    const hub = hubWith([{ id: 'a', name: 'A' }]);
    const plan = buildUpdatePlan({
      base: documentOf([{ key: 'a', name: 'A', workflow: flow() }]),
      published: documentOf([{ key: 'a', name: 'A2', workflow: flow(['backlog', 'plan']) }, { key: 'b', name: 'B', workflow: flow() }]),
      local: projectSharingBoards(hub, { a: 'a' }),
      bindings: { a: 'a' },
      orphans: {},
      removed: {},
      pendingRemovals: [],
    });
    expect(plan.apply).toHaveLength(2);
    const result = applySharingPlan(hub, plan, deps);
    expect(result.created).toEqual([{ boardId: 'created-1', key: 'b' }]);
    expect(hub.boards.map(board => [board.name, board.workflowYaml])).toEqual([['A2', flow(['backlog', 'plan'])], ['B', flow()]]);
  });

  it('refuses a workflow that orphans a task column and leaves the Hub untouched', () => {
    const hub = hubWith([{ id: 'a', name: 'A', tasks: [{ columnId: 'plan' }] }]);
    const plan = buildUpdatePlan({
      base: documentOf([{ key: 'a', name: 'A', workflow: flow(['backlog', 'plan', 'done']) }]),
      published: documentOf([{ key: 'a', name: 'A', workflow: flow(['backlog', 'done']) }]),
      local: projectSharingBoards(hub, { a: 'a' }),
      bindings: { a: 'a' },
      orphans: {},
      removed: {},
      pendingRemovals: [],
    });
    const before = structuredClone(hub);
    expect(() => applySharingPlan(hub, plan, deps)).toThrow(/column/);
    expect(hub).toEqual(before);
  });

  it('refuses a plan that would duplicate a board name and leaves the Hub untouched', () => {
    const hub = hubWith([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    const plan = {
      comparison: compareSharing({ base: null, published: documentOf([]), local: projectSharingBoards(hub, {}), bindings: {}, orphans: {}, removed: {}, pendingRemovals: [] }),
      apply: [{ key: 'x', name: 'A', workflow: flow() }, { key: 'y', name: 'A', workflow: flow() }],
      removals: [], orphans: [], reconnections: [], conflicts: [],
      nextBase: documentOf([]),
    };
    const before = structuredClone(hub);
    expect(() => applySharingPlan(hub, plan, deps)).toThrow(/duplicate/);
    expect(hub).toEqual(before);
  });

  it('applies a team board reorder without touching board content', () => {
    const hub = hubWith([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    const plan = buildUpdatePlan({
      base: documentOf([{ key: 'a', name: 'A', workflow: flow() }, { key: 'b', name: 'B', workflow: flow() }]),
      published: documentOf([{ key: 'b', name: 'B', workflow: flow() }, { key: 'a', name: 'A', workflow: flow() }]),
      local: projectSharingBoards(hub, { a: 'a', b: 'b' }),
      bindings: { a: 'a', b: 'b' }, orphans: {}, removed: {}, pendingRemovals: [],
    });
    expect(plan.comparison.orderChanged).toBe(true);
    expect(plan.comparison.updates).toBe(1);
    expect(plan.apply).toEqual([]);
    applySharingPlan(hub, plan, deps);
    expect(hub.boards.map(board => board.id)).toEqual(['b', 'a']);
  });

  it('removes a board the team deleted only when it has no local work', () => {
    const hub = hubWith([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    const input = {
      base: documentOf([{ key: 'a', name: 'A', workflow: flow() }, { key: 'b', name: 'B', workflow: flow() }]),
      published: documentOf([{ key: 'a', name: 'A', workflow: flow() }]),
      local: projectSharingBoards(hub, { a: 'a', b: 'b' }),
      bindings: { a: 'a', b: 'b' },
      orphans: {},
      removed: {},
      pendingRemovals: [],
    };
    const plan = buildUpdatePlan(input);
    expect(plan.removals).toEqual(['b']);
    applySharingPlan(hub, plan, deps);
    expect(hub.boards.map(board => board.id)).toEqual(['a']);
  });

  it('keeps a task-free board the team deleted as an orphan when it has unpublished changes', () => {
    const hub = hubWith([{ id: 'b', name: 'B', workflow: flow(['backlog', 'plan']) }]);
    const plan = buildUpdatePlan({
      base: documentOf([{ key: 'b', name: 'B', workflow: flow() }]),
      published: documentOf([]),
      local: projectSharingBoards(hub, { b: 'b' }),
      bindings: { b: 'b' },
      orphans: {},
      removed: {},
      pendingRemovals: [],
    });
    expect(plan.removals).toEqual([]);
    expect(plan.orphans).toEqual([{ boardId: 'b', lastKey: 'b', lastPublishedName: 'B' }]);
  });

  it('keeps a board the team deleted as an orphan when it still holds tasks', () => {
    const hub = hubWith([{ id: 'a', name: 'A' }, { id: 'b', name: 'B', tasks: [{ columnId: 'backlog' }] }]);
    const plan = buildUpdatePlan({
      base: documentOf([{ key: 'a', name: 'A', workflow: flow() }, { key: 'b', name: 'B', workflow: flow() }]),
      published: documentOf([{ key: 'a', name: 'A', workflow: flow() }]),
      local: projectSharingBoards(hub, { a: 'a', b: 'b' }),
      bindings: { a: 'a', b: 'b' },
      orphans: {},
      removed: {},
      pendingRemovals: [],
    });
    expect(plan.removals).toEqual([]);
    expect(plan.orphans).toEqual([{ boardId: 'b', lastKey: 'b', lastPublishedName: 'B' }]);
    expect(plan.nextBase.boards.map(board => board.key)).toEqual(['a']);
  });

  it('keeps the previously received content as the base of a conflicting board', () => {
    const hub = hubWith([{ id: 'a', name: 'A', workflow: flow(['backlog', 'local']) }]);
    const plan = buildUpdatePlan({
      base: documentOf([{ key: 'a', name: 'A', workflow: flow() }]),
      published: documentOf([{ key: 'a', name: 'A', workflow: flow(['backlog', 'team']) }]),
      local: projectSharingBoards(hub, { a: 'a' }),
      bindings: { a: 'a' },
      orphans: {},
      removed: {},
      pendingRemovals: [],
    });
    expect(plan.conflicts).toEqual([{ boardId: 'a', key: 'a', name: 'A' }]);
    expect(plan.nextBase.boards[0]!.workflow).toBe(flow());
  });

  it('lists boards removed only here while the team document still holds them', () => {
    const hub = hubWith([{ id: 'a', name: 'A', workflow: flow(['backlog', 'plan']) }]);
    const comparison = compareSharing({
      base: documentOf([{ key: 'a', name: 'A', workflow: flow() }, { key: 'gone', name: 'Gone', workflow: flow() }]),
      published: documentOf([{ key: 'a', name: 'A', workflow: flow() }, { key: 'gone', name: 'Gone', workflow: flow() }]),
      local: projectSharingBoards(hub, { a: 'a' }),
      bindings: { a: 'a' },
      orphans: {},
      removed: { gone: { boardId: 'old', name: 'Gone' } },
      pendingRemovals: [],
    });
    expect(comparison.removed).toEqual([{ key: 'gone', boardId: 'old', name: 'Gone' }]);
    expect(comparison.boards.find(board => board.boardId === 'a')?.decision).toBe('draft');
  });
});
