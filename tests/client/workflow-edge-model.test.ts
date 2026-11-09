import { describe, expect, it } from 'vitest';
import { authoredOffsetAt, edgeModel, withOffset, type LiveConnectionDescriptor, type LiveStageRect } from '../../src/client/workflow-view/edge-model.js';
import { buildWorkflowScene } from '../../src/client/workflow-view/scene.js';
import { parseWorkflow } from '../../src/domain/workflow.js';
import type { ConnectionLayout } from '../../src/shared/types.js';

const stages: readonly LiveStageRect[] = [
  { id: 'one', x: 0, y: 0, width: 200, height: 100 },
  { id: 'two', x: 400, y: 0, width: 200, height: 100 },
];

const connection: LiveConnectionDescriptor = { id: 'one->two:0', from: 'one', to: 'two', kind: 'explicit', returning: false, fanOut: 0, fanOutCount: 1 };

// Two stages on different rows, so the automatic route produces one adjustable segment.
const bentStages: readonly LiveStageRect[] = [stages[0]!, { ...stages[1]!, y: 120 }];

describe('edge model', () => {
  it('draws nothing for a diagram with no stage', () => {
    expect(edgeModel([], [connection])).toEqual([]);
  });

  it('derives the drawn edge from the rectangles it is given', () => {
    const [edge] = edgeModel(stages, [connection]);
    expect(edge?.id).toBe('one->two:0');
    expect(edge?.kind).toBe('explicit');
    expect(edge?.points[0]).toEqual({ x: 200, y: 50 });
    expect(edge?.points[edge.points.length - 1]).toEqual({ x: 400, y: 50 });
    expect(edge?.lines).toHaveLength(0);
  });

  it('follows a moved stage without waiting for a stored placement', () => {
    const moved = stages.map(stage => stage.id === 'two' ? { ...stage, y: 240 } : stage);
    const [before] = edgeModel(stages, [connection]);
    const [after] = edgeModel(moved, [connection]);
    expect(after!.points[after!.points.length - 1]!.y).toBe(290);
    expect(before!.points[before!.points.length - 1]!.y).toBe(50);
  });

  it('follows a resized stage edge', () => {
    const resized = stages.map(stage => stage.id === 'one' ? { ...stage, width: 320 } : stage);
    const [edge] = edgeModel(resized, [connection]);
    expect(edge?.points[0]).toEqual({ x: 320, y: 50 });
  });

  it('skips a connection whose stage is missing', () => {
    expect(edgeModel([stages[0]!], [connection])).toEqual([]);
  });

  it('draws an authored touch point', () => {
    const [edge] = edgeModel(stages, [{ ...connection, source: { side: 'bottom', at: 4 } }]);
    expect(edge?.points[0]).toEqual({ x: 180, y: 100 });
  });

  it('draws an authored segment displacement', () => {
    const [plain] = edgeModel(bentStages, [connection]);
    const [shifted] = edgeModel(bentStages, [{ ...connection, segments: [{ axis: 'x', offset: 40 }] }]);
    expect(plain?.lines).toHaveLength(1);
    expect(shifted?.lines[0]!.coordinate).toBe(plain!.lines[0]!.coordinate + 40);
  });
});

describe('committed and live geometry', () => {
  const yaml = 'name: Flow' + String.fromCharCode(10) + 'columns:' + String.fromCharCode(10) + '  - id: one' + String.fromCharCode(10) + '    label: One' + String.fromCharCode(10) + '    allowed_transitions: [two]' + String.fromCharCode(10) + '  - id: two' + String.fromCharCode(10) + '    label: Two' + String.fromCharCode(10);
  const workflow = parseWorkflow(yaml);
  const placements = new Map([['one', { x: 0, y: 0 }], ['two', { x: 400, y: 0 }]]);

  function layout(source: ConnectionLayout['source']): Record<string, ConnectionLayout> {
    return { 'one->two': { from: 'one', to: 'two', ...(source === undefined ? {} : { source }), segments: [{ axis: 'x', offset: 40 }] } };
  }

  it('draws the same path for the committed scene and the live surface', () => {
    const scene = buildWorkflowScene({ workflow, tasks: [], placements, connections: layout({ side: 'bottom', at: 4 }) });
    const live = edgeModel(
      [{ id: 'one', x: 0, y: 0, width: 264, height: 140 }, { id: 'two', x: 400, y: 0, width: 264, height: 140 }],
      [{ id: 'one->two:0', from: 'one', to: 'two', kind: 'explicit', returning: false, fanOut: 0, fanOutCount: 1, source: { side: 'bottom', at: 4 }, segments: [{ axis: 'x', offset: 40 }] }],
    );
    expect(scene.edges[0]!.shape.points).toEqual(live[0]!.points);
  });
});

describe('connection layout editing', () => {
  it('reads the displacement an authored layout already applies', () => {
    expect(authoredOffsetAt([], 'x', 0)).toBe(0);
    expect(authoredOffsetAt([{ axis: 'y', offset: 4 }], 'x', 0)).toBe(0);
    expect(authoredOffsetAt([{ axis: 'x', offset: 8 }, { axis: 'x', offset: 16 }], 'x', 1)).toBe(16);
    expect(authoredOffsetAt([{ axis: 'x', offset: 8 }], 'x', 3)).toBe(0);
  });

  it('replaces one displacement and pads the earlier positions of that axis', () => {
    expect(withOffset([], 'x', 0, 12)).toEqual([{ axis: 'x', offset: 12 }]);
    // A second x line needs the first one kept unshifted, so the array carries it.
    expect(withOffset([], 'x', 1, 20)).toEqual([{ axis: 'x', offset: 0 }, { axis: 'x', offset: 20 }]);
    expect(withOffset([{ axis: 'x', offset: 8 }, { axis: 'y', offset: 2 }], 'x', 0, -8)).toEqual([{ axis: 'x', offset: -8 }, { axis: 'y', offset: 2 }]);
    expect(withOffset([{ axis: 'x', offset: 8 }], 'x', 0, 0)).toEqual([{ axis: 'x', offset: 0 }]);
  });
});
