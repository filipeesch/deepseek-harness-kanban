import { describe, expect, it } from 'vitest';
import { layoutMetrics } from '../../src/domain/diagram/metrics.js';
import { diagramScene } from '../../src/domain/diagram/render.js';
import { parseWorkflow } from '../../src/domain/workflow.js';
import type { WorkflowScene, WorkflowSceneEdge, WorkflowSceneNode } from '../../src/domain/diagram/scene.js';
import type { DiagramPoint } from '../../src/domain/diagram/orthogonal.js';

function node(id: string, x: number, y: number, width = 100, height = 100): WorkflowSceneNode {
  return { id, name: id, index: 0, tasks: [], position: { x, y }, size: { width, height } };
}

function edge(id: string, from: string, to: string, points: readonly DiagramPoint[]): WorkflowSceneEdge {
  return { id, from, to, kind: 'explicit', returning: false, fanOut: 0, fanOutCount: 1, shape: { path: 'M 0 0', points, tipAngle: 0 } };
}

function scene(nodes: readonly WorkflowSceneNode[], edges: readonly WorkflowSceneEdge[]): WorkflowScene {
  return { nodes, edges, bounds: { width: 500, height: 500 } };
}

const FLOW = 'initial_column: a\ncolumns:\n  - id: a\n    label: A\n  - id: b\n    label: B\n';

describe('layout metrics', () => {
  it('counts route crossings', () => {
    const value = layoutMetrics({ workflow: parseWorkflow(FLOW), scene: scene([node('a', 0, 0), node('b', 300, 300)], [
      edge('a->b:0', 'a', 'b', [{ x: 0, y: 50 }, { x: 200, y: 50 }]),
      edge('b->a:0', 'b', 'a', [{ x: 100, y: 0 }, { x: 100, y: 200 }]),
    ]) });
    expect(value.crossings).toBe(1);
    expect(value.problems).toContainEqual({ kind: 'segments-cross', connections: ['a->b:0', 'b->a:0'] });
  });

  it('counts a segment that passes through another stage', () => {
    const value = layoutMetrics({ workflow: parseWorkflow(FLOW), scene: scene([node('a', 0, 0), node('middle', 20, 20, 40, 40), node('b', 300, 300)], [
      edge('a->b:0', 'a', 'b', [{ x: 0, y: 40 }, { x: 200, y: 40 }]),
    ]) });
    expect(value.segmentsThroughStages).toBe(1);
    expect(value.problems).toContainEqual({ kind: 'segment-through-stage', stages: ['middle'], connections: ['a->b:0'] });
  });

  it('counts segments that run over one another', () => {
    const value = layoutMetrics({ workflow: parseWorkflow(FLOW), scene: scene([node('a', 0, 0), node('b', 300, 300)], [
      edge('a->b:0', 'a', 'b', [{ x: 0, y: 50 }, { x: 200, y: 50 }]),
      edge('b->a:0', 'b', 'a', [{ x: 50, y: 50 }, { x: 150, y: 50 }]),
    ]) });
    expect(value.overlappingSegments).toBe(1);
  });

  it('counts overlapping stages', () => {
    const value = layoutMetrics({ workflow: parseWorkflow(FLOW), scene: scene([node('a', 0, 0), node('b', 50, 50)], []) });
    expect(value.overlappingStages).toBe(1);
    expect(value.problems).toContainEqual({ kind: 'stages-overlap', stages: ['a', 'b'] });
  });

  it('counts a named-exit label a stage covers', () => {
    const workflow = parseWorkflow('initial_column: wait\ncolumns:\n  - id: wait\n    label: Wait\n    deterministic:\n      language: bash\n      code: exit 0\n      directory: project\n      exits: {passed: done}\n  - id: done\n    label: Done\n');
    const value = layoutMetrics({ workflow, scene: scene([node('wait', 0, 0), node('done', 300, 0), node('cover', 120, 0, 60, 40)], [
      edge('wait->done:0', 'wait', 'done', [{ x: 100, y: 50 }, { x: 300, y: 50 }]),
    ]) });
    expect(value.coveredLabels).toBeGreaterThanOrEqual(1);
    expect(value.problems.some(problem => problem.kind === 'label-covered')).toBe(true);
  });

  it('counts folds and the total length', () => {
    const value = layoutMetrics({ workflow: parseWorkflow(FLOW), scene: scene([node('a', 0, 0), node('b', 300, 300)], [
      edge('a->b:0', 'a', 'b', [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]),
    ]) });
    expect(value.folds).toBe(1);
    expect(value.totalLength).toBe(20);
  });

  it('describes the same geometry the drawing produces', () => {
    const workflow = parseWorkflow('initial_column: a\ncolumns:\n  - id: a\n    label: A\n    allowed_transitions: [b]\n  - id: b\n    label: B\n    allowed_transitions: []\n');
    const drawn = diagramScene({ workflow, tasks: [], cards: 'empty' });
    const value = layoutMetrics({ workflow, scene: drawn });
    expect(drawn.edges).toHaveLength(1);
    expect(value.problems).toEqual([]);
    expect(value.totalLength).toBeGreaterThan(0);
    expect(value.crossings).toBe(0);
  });

  it('reports nothing for a clean drawing', () => {
    const value = layoutMetrics({ workflow: parseWorkflow('initial_column: a\ncolumns:\n  - id: a\n    label: A\n    allowed_transitions: [b]\n  - id: b\n    label: B\n'), scene: scene([node('a', 0, 0), node('b', 300, 0)], [
      edge('a->b:0', 'a', 'b', [{ x: 100, y: 50 }, { x: 300, y: 50 }]),
    ]) });
    expect(value.problems).toEqual([]);
    expect(value.crossings).toBe(0);
  });
});