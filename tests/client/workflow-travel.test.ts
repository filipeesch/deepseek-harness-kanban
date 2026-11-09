import { describe, expect, it } from 'vitest';
import type { Task, Workflow } from '../../src/shared/types.js';
import { buildWorkflowScene } from '../../src/client/workflow-view/scene.js';
import { planTravel } from '../../src/client/workflow-view/travel.js';
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
    { id: 'two', name: 'Two', allowedTransitions: transitions('one') },
    { id: 'three', name: 'Three', allowedTransitions: [] },
  ],
  groups: [],
};

const placements = new Map([['one', { x: 0, y: 0 }], ['two', { x: 400, y: 0 }], ['three', { x: 800, y: 0 }]]);
const scene = buildWorkflowScene({ workflow, tasks: [], placements });

describe('card travel', () => {
  it('travels along the drawn connection', () => {
    const moves = planTravel({ previousStageByTask: new Map([['task-1', 'one']]), tasks: [task('task-1', 'two')], scene });
    expect(moves).toHaveLength(1);
    expect(moves[0]!.fromStageId).toBe('one');
    expect(moves[0]!.toStageId).toBe('two');
    expect(moves[0]!.points).toEqual(scene.edges.find(edge => edge.from === 'one' && edge.to === 'two')!.shape.points);
  });

  it('takes the direct path when the diagram draws no connection', () => {
    const moves = planTravel({ previousStageByTask: new Map([['task-1', 'one']]), tasks: [task('task-1', 'three')], scene });
    expect(moves).toHaveLength(1);
    expect(moves[0]!.points[0]!.x).toBe(264);
  });

  it('does not travel for a same-stage reorder', () => {
    expect(planTravel({ previousStageByTask: new Map([['task-1', 'one']]), tasks: [task('task-1', 'one')], scene })).toEqual([]);
  });

  it('settles a batch above the limit', () => {
    const previous = new Map<string, string>();
    const tasks: Task[] = [];
    for (let index = 0; index < 9; index++) { previous.set('task-' + index, 'one'); tasks.push(task('task-' + index, 'two')); }
    expect(planTravel({ previousStageByTask: previous, tasks, scene })).toEqual([]);
  });

  it('skips a task whose stage the diagram does not show', () => {
    expect(planTravel({ previousStageByTask: new Map([['task-1', 'missing']]), tasks: [task('task-1', 'two')], scene })).toEqual([]);
  });
});
describe('card travel along an adjusted connection', () => {
  it('follows the connection layout the scene was given', () => {
    const connections = { 'one->two': { from: 'one', to: 'two', source: { side: 'bottom' as const, at: 4 } } };
    const adjusted = buildWorkflowScene({ workflow, tasks: [], placements, connections });
    const plain = buildWorkflowScene({ workflow, tasks: [], placements });
    const moves = planTravel({ previousStageByTask: new Map([['task-1', 'one']]), tasks: [task('task-1', 'two')], scene: adjusted });
    expect(moves).toHaveLength(1);
    expect(moves[0]!.points).toEqual(adjusted.edges.find(edge => edge.from === 'one' && edge.to === 'two')!.shape.points);
    expect(moves[0]!.points).not.toEqual(plain.edges.find(edge => edge.from === 'one' && edge.to === 'two')!.shape.points);
  });
});
