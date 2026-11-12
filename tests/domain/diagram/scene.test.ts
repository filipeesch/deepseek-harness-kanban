import { describe, expect, it } from 'vitest';
import type { Task, Workflow } from '../../../src/shared/types.js';
import { buildWorkflowScene } from '../../../src/domain/diagram/scene.js';
import { estimateStageHeight } from '../../../src/domain/diagram/stage-height.js';
import { STAGE_MIN_SIZE } from '../../../src/domain/stage-size.js';

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
    { id: 'one', name: 'One', allowedTransitions: [{ to: 'two' }] },
    { id: 'two', name: 'Two', allowedTransitions: [{ to: 'three' }] },
    { id: 'three', name: 'Three', allowedTransitions: [] },
  ],
  groups: [],
};

const placements = new Map([['one', { x: 0, y: 0 }], ['two', { x: 400, y: 0 }], ['three', { x: 800, y: 0 }]]);

describe('workflow scene geometry', () => {
  it('builds one node per stage with the cards in it', () => {
    const scene = buildWorkflowScene({ workflow, tasks: [task('a', 'one', 0), task('b', 'one', 1), task('c', 'two', 0)], placements });
    expect(scene.nodes.map(node => node.id)).toEqual(['one', 'two', 'three']);
    expect(scene.nodes.map(node => node.tasks.map(value => value.id))).toEqual([['a', 'b'], ['c'], []]);
    expect(scene.nodes[1]!.position).toEqual({ x: 400, y: 0 });
    expect(scene.bounds).toEqual({ width: 800 + STAGE_MIN_SIZE.width, height: STAGE_MIN_SIZE.height });
  });

  it('builds one edge per drawn connection, with its shape', () => {
    const scene = buildWorkflowScene({ workflow, tasks: [], placements });
    expect(scene.edges.map(edge => [edge.from, edge.to, edge.kind])).toEqual([
      ['one', 'two', 'explicit'],
      ['two', 'three', 'explicit'],
    ]);
    for (const edge of scene.edges) expect(edge.shape.points.length).toBeGreaterThan(1);
    expect(scene.edges[0]!.shape.path).toMatch(/^M /);
  });

  it('draws no edge for a workflow that configures none', () => {
    const single: Workflow = { name: 'One', initialColumnId: 'only', columns: [{ id: 'only', name: 'Only', allowedTransitions: [] }], groups: [] };
    const scene = buildWorkflowScene({ workflow: single, tasks: [task('a', 'only', 0)], placements: new Map([['only', { x: 0, y: 0 }]]) });
    expect(scene.nodes).toHaveLength(1);
    expect(scene.edges).toEqual([]);
  });

  it('reports the card count the height estimate reads', () => {
    const cards = Array.from({ length: 5 }, (_, index) => task('card-' + index, 'one', index));
    const scene = buildWorkflowScene({ workflow, tasks: cards, placements });
    const node = scene.nodes[0]!;
    expect(node.tasks).toHaveLength(5);
    expect(estimateStageHeight(node.size.height, node.tasks.length)).toBeGreaterThan(node.size.height);
  });
});
