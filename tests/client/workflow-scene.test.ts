import { describe, expect, it } from 'vitest';
import type { Task, Workflow } from '../../src/shared/types.js';
import { buildWorkflowScene } from '../../src/client/workflow-view/scene.js';
import { filterTasks } from '../../src/client/task-filter.js';
import { transitions } from '../support/transition-rules.js';

function task(id: string, columnId: string, position: number): Task {
  return {
    id, projectId: 'project', title: 'Task ' + id, description: '', columnId, position,
    sessionIds: [], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const workflow: Workflow = {
  name: 'Flow',
  initialColumnId: 'one',
  columns: [
    { id: 'one', name: 'One', allowedTransitions: transitions('two') },
    { id: 'two', name: 'Two' },
    { id: 'three', name: 'Three', allowedTransitions: [] },
  ],
  groups: [],
};

const placements = new Map([['one', { x: 0, y: 0 }], ['two', { x: 400, y: 0 }], ['three', { x: 800, y: 0 }]]);

describe('workflow scene', () => {
  it('groups cards into their stages in the given order', () => {
    const scene = buildWorkflowScene({ workflow, tasks: [task('b', 'one', 1), task('a', 'one', 0), task('c', 'two', 0)], placements });
    expect(scene.nodes.map(node => node.id)).toEqual(['one', 'two', 'three']);
    expect(scene.nodes[0]!.tasks.map(value => value.id)).toEqual(['b', 'a']);
    expect(scene.nodes[1]!.tasks.map(value => value.id)).toEqual(['c']);
    expect(scene.nodes[2]!.tasks).toEqual([]);
  });

  it('draws one shaped edge per configured connection', () => {
    const scene = buildWorkflowScene({ workflow, tasks: [], placements });
    expect(scene.edges.map(edge => [edge.from, edge.to, edge.kind])).toEqual([
      ['one', 'two', 'explicit'],
      ['two', 'three', 'implicit'],
    ]);
    expect(scene.edges[0]!.shape.points.length).toBeGreaterThan(1);
  });

  it('reports the extent of the placed stages', () => {
    const scene = buildWorkflowScene({ workflow, tasks: [], placements, sizes: new Map([['three', { width: 100, height: 100 }]]) });
    expect(scene.bounds.width).toBe(800 + 100);
  });

  it('presents only the cards the shared filter keeps', () => {
    const visible = filterTasks([task('a', 'one', 0), task('b', 'two', 1)], { search: 'b', projectFilter: '' });
    const scene = buildWorkflowScene({ workflow, tasks: visible, placements });
    expect(scene.nodes.map(node => node.tasks.map(value => value.id))).toEqual([[], ['b'], []]);
  });

  it('presents a single stage with no connections', () => {
    const single: Workflow = { name: 'One', initialColumnId: 'only', columns: [{ id: 'only', name: 'Only' }], groups: [] };
    const scene = buildWorkflowScene({ workflow: single, tasks: [task('a', 'only', 0)], placements: new Map([['only', { x: 0, y: 0 }]]) });
    expect(scene.nodes).toHaveLength(1);
    expect(scene.edges).toEqual([]);
    expect(scene.nodes[0]!.tasks.map(value => value.id)).toEqual(['a']);
  });

  it('drops a card whose stage the workflow does not define', () => {
    const scene = buildWorkflowScene({ workflow, tasks: [task('a', 'missing', 0)], placements });
    expect(scene.nodes.every(node => node.tasks.length === 0)).toBe(true);
  });
});
