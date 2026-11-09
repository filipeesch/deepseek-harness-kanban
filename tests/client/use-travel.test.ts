// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Task, Workflow } from '../../src/shared/types.js';
import { buildWorkflowScene } from '../../src/client/workflow-view/scene.js';
import { useTravel, type TravelInput } from '../../src/client/workflow-view/use/use-travel.js';
import { transitions } from '../support/transition-rules.js';

function task(id: string, columnId: string): Task {
  return {
    id, projectId: 'project', title: 'Task ' + id, description: '', columnId, position: 0,
    sessionIds: [], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const workflow: Workflow = {
  name: 'Flow',
  initialColumnId: 'one',
  columns: [
    { id: 'one', name: 'One', allowedTransitions: transitions('two') },
    { id: 'two', name: 'Two', allowedTransitions: [] },
  ],
  groups: [],
};

const placements = new Map([['one', { x: 0, y: 0 }], ['two', { x: 400, y: 0 }]]);
const measured = new Map([['one', { width: 264, height: 140 }], ['two', { width: 264, height: 140 }]]);
const connections = { 'one->two': { from: 'one', to: 'two', source: { side: 'bottom' as const, at: 4 } } };

function input(tasks: readonly Task[], withConnections: boolean): TravelInput {
  return {
    workflow, stateTasks: tasks, tasks, placements, measured,
    ...(withConnections ? { connections } : {}),
  };
}

describe('travel uses the drawn connection layout', () => {
  it('follows the adjusted arrow the diagram presents', () => {
    const start = [task('a', 'one')];
    const moved = [task('a', 'two')];
    const { result, rerender } = renderHook((props: TravelInput) => useTravel(props), { initialProps: input(start, true) });
    act(() => { rerender(input(moved, true)); });
    const expected = buildWorkflowScene({ workflow, tasks: [], placements, sizes: measured, connections }).edges[0]!.shape.points;
    expect(result.current.travel).toHaveLength(1);
    expect(result.current.travel[0]!.points).toEqual(expected);
  });

  it('follows the automatic arrow when no adjustment is presented', () => {
    const start = [task('a', 'one')];
    const moved = [task('a', 'two')];
    const { result, rerender } = renderHook((props: TravelInput) => useTravel(props), { initialProps: input(start, false) });
    act(() => { rerender(input(moved, false)); });
    const automatic = buildWorkflowScene({ workflow, tasks: [], placements, sizes: measured }).edges[0]!.shape.points;
    const adjusted = buildWorkflowScene({ workflow, tasks: [], placements, sizes: measured, connections }).edges[0]!.shape.points;
    expect(result.current.travel[0]!.points).toEqual(automatic);
    // The adjusted route really differs, so the two cases above are not the same path.
    expect(adjusted).not.toEqual(automatic);
  });
});
