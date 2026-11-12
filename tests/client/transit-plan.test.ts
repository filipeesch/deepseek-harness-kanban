import { describe, expect, it } from 'vitest';
import type { Task, Workflow } from '../../src/shared/types.js';
import { buildWorkflowScene } from '../../src/domain/diagram/scene.js';
import { pathLength, planTransit } from '../../src/client/workflow-view/transit/plan.js';
import { transitions } from '../support/transition-rules.js';

function task(id: string, columnId: string): Task {
  return {
    id, projectId: 'project', title: 'Task ' + id, description: '', columnId, position: 0,
    sessionIds: [], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const authored: Workflow = {
  name: 'Flow',
  initialColumnId: 'one',
  columns: [
    { id: 'one', name: 'One', allowedTransitions: transitions('two') },
    { id: 'two', name: 'Two', allowedTransitions: transitions('three') },
    { id: 'three', name: 'Three', allowedTransitions: [] },
  ],
  groups: [],
};

const workflowOrder: Workflow = {
  name: 'Flow',
  initialColumnId: 'one',
  columns: [
    { id: 'one', name: 'One' },
    { id: 'two', name: 'Two', allowedTransitions: [] },
  ],
  groups: [],
};

const placements = new Map([['one', { x: 0, y: 0 }], ['two', { x: 400, y: 0 }], ['three', { x: 800, y: 0 }]]);
const scene = buildWorkflowScene({ workflow: authored, tasks: [], placements });

describe('transit planning', () => {
  it('follows the drawn connection between the two stages', () => {
    const plan = planTransit({ previousStageByTask: new Map([['a', 'one']]), tasks: [task('a', 'two')], scene });
    const edge = scene.edges.find(value => value.from === 'one' && value.to === 'two');
    expect(plan.transits).toHaveLength(1);
    expect(plan.immediate).toEqual([]);
    expect(plan.oversize).toBe(false);
    expect(plan.transits[0]!.fromStageId).toBe('one');
    expect(plan.transits[0]!.toStageId).toBe('two');
    expect(plan.transits[0]!.path).toBe(edge!.shape.path);
    expect(plan.transits[0]!.length).toBeCloseTo(pathLength(edge!.shape.points), 6);
    expect(plan.transits[0]!.length).toBeGreaterThan(0);
  });

  it('follows the dashed connection a stage without authored transitions receives', () => {
    const implicitScene = buildWorkflowScene({ workflow: workflowOrder, tasks: [], placements });
    expect(implicitScene.edges.every(edge => edge.kind === 'implicit')).toBe(true);
    const plan = planTransit({ previousStageByTask: new Map([['a', 'one']]), tasks: [task('a', 'two')], scene: implicitScene });
    expect(plan.transits).toHaveLength(1);
    expect(plan.transits[0]!.path).toBe(implicitScene.edges[0]!.shape.path);
  });

  it('follows the route the user adjusted', () => {
    const connections = { 'one->two': { from: 'one', to: 'two', source: { side: 'bottom' as const, at: 4 } } };
    const adjusted = buildWorkflowScene({ workflow: authored, tasks: [], placements, connections });
    const plain = buildWorkflowScene({ workflow: authored, tasks: [], placements });
    const plan = planTransit({ previousStageByTask: new Map([['a', 'one']]), tasks: [task('a', 'two')], scene: adjusted });
    expect(plan.transits).toHaveLength(1);
    expect(plan.transits[0]!.path).toBe(adjusted.edges.find(value => value.from === 'one' && value.to === 'two')!.shape.path);
    expect(plan.transits[0]!.path).not.toBe(plain.edges.find(value => value.from === 'one' && value.to === 'two')!.shape.path);
  });

  it('presents only the arrival between two stages the diagram does not connect', () => {
    const plan = planTransit({ previousStageByTask: new Map([['a', 'one']]), tasks: [task('a', 'three')], scene });
    expect(plan.transits).toEqual([]);
    expect(plan.immediate).toEqual(['a']);
    expect(plan.oversize).toBe(false);
  });

  it('presents nothing for a same-stage reorder', () => {
    expect(planTransit({ previousStageByTask: new Map([['a', 'one']]), tasks: [task('a', 'one')], scene })).toEqual({ transits: [], immediate: [], oversize: false });
  });

  it('presents nothing for a stage the diagram does not show', () => {
    const source = planTransit({ previousStageByTask: new Map([['a', 'missing']]), tasks: [task('a', 'two')], scene });
    expect(source).toEqual({ transits: [], immediate: [], oversize: false });
    const destination = planTransit({ previousStageByTask: new Map([['a', 'one']]), tasks: [task('a', 'missing')], scene });
    expect(destination).toEqual({ transits: [], immediate: [], oversize: false });
  });

  it('settles a mixed batch above the cap, without transit or pulse', () => {
    const previous = new Map<string, string>();
    const tasks: Task[] = [];
    for (let index = 0; index < 8; index += 1) { previous.set('task-' + index, 'one'); tasks.push(task('task-' + index, 'two')); }
    // Eight movements still present every flight.
    expect(planTransit({ previousStageByTask: previous, tasks, scene }).transits).toHaveLength(8);
    // The ninth has no drawn connection, so it would only pulse: the whole batch settles.
    previous.set('task-8', 'one');
    tasks.push(task('task-8', 'three'));
    expect(planTransit({ previousStageByTask: previous, tasks, scene })).toEqual({ transits: [], immediate: [], oversize: true });
  });

  it('settles every movement when the arrangement must settle', () => {
    expect(planTransit({ previousStageByTask: new Map([['a', 'one']]), tasks: [task('a', 'two')], scene, settle: true })).toEqual({ transits: [], immediate: [], oversize: false });
  });

  it('gives each movement a key of its own', () => {
    const plan = planTransit({ previousStageByTask: new Map([['a', 'one'], ['b', 'two']]), tasks: [task('a', 'two'), task('b', 'three')], scene });
    expect(plan.transits.map(value => value.key)).toEqual(['a:one->two', 'b:two->three']);
  });
});