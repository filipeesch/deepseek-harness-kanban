import { describe, expect, it } from 'vitest';
import { authoredOffsetAt, baselineCoordinateOf, edgeModel, withOffset, type LiveConnectionDescriptor, type LiveStageRect } from '../../src/client/workflow-view/edge-model.js';
import { connectionRoute } from '../../src/client/workflow-view/routing/route.js';
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

  it('starts a segment drag from the drawn line when the other axis moves the floor', () => {
    const source = { x: 0, y: 0, width: 200, height: 100 };
    const target = { x: 0, y: 300, width: 200, height: 100 };
    const third = { x: -50, y: 600, width: 30, height: 100 };
    const segments = [{ axis: 'x' as const, offset: 372 }];
    const input = { from: source, to: target, returning: true, fanOut: 0, fanOutCount: 1, clearanceStages: [source, target, third], segments };
    const drawn = connectionRoute(input);
    // The x displacement widened the corridor, so the drawn floor is 472, not the
    // automatic 772. The lower horizontal line is the second line of its axis.
    expect(drawn.lines.filter(line => line.axis === 'y').map(line => line.coordinate)).toEqual([200, 472]);
    const baseline = baselineCoordinateOf(drawn, 'y', 1, segments)!;
    expect(baseline).toBe(472);
    // Dragging the drawn line down eight units stores offset eight and keeps the
    // preview eight units below the drawn line instead of jumping a whole floor.
    const preview = connectionRoute({ ...input, segments: withOffset(segments, 'y', 1, 480 - baseline) });
    expect(preview.lines.filter(line => line.axis === 'y')[1]!.coordinate).toBe(480);
  });

  it('replaces one displacement and pads the earlier positions of that axis', () => {
    expect(withOffset([], 'x', 0, 12)).toEqual([{ axis: 'x', offset: 12 }]);
    // A second x line needs the first one kept unshifted, so the array carries it.
    expect(withOffset([], 'x', 1, 20)).toEqual([{ axis: 'x', offset: 0 }, { axis: 'x', offset: 20 }]);
    expect(withOffset([{ axis: 'x', offset: 8 }, { axis: 'y', offset: 2 }], 'x', 0, -8)).toEqual([{ axis: 'x', offset: -8 }, { axis: 'y', offset: 2 }]);
    expect(withOffset([{ axis: 'x', offset: 8 }], 'x', 0, 0)).toEqual([{ axis: 'x', offset: 0 }]);
  });
});
describe('corridor clearance across live and committed geometry', () => {
  const yaml = [
    'name: Flow',
    'columns:',
    '  - id: one',
    '    label: One',
    '    allowed_transitions: [two]',
    '  - id: two',
    '    label: Two',
    '    allowed_transitions: [three]',
    '  - id: three',
    '    label: Three',
    '    allowed_transitions: [one]',
    '  - id: four',
    '    label: Four',
    '    allowed_transitions: []',
  ].join(String.fromCharCode(10));
  const workflow = parseWorkflow(yaml);
  const placements = new Map([
    ['one', { x: 0, y: 0 }],
    ['two', { x: 400, y: 0 }],
    ['three', { x: 800, y: 0 }],
    ['four', { x: 1600, y: 0 }],
  ]);
  const rects: readonly LiveStageRect[] = [
    { id: 'one', x: 0, y: 0, width: 264, height: 140 },
    { id: 'two', x: 400, y: 0, width: 264, height: 140 },
    { id: 'three', x: 800, y: 0, width: 264, height: 140 },
    { id: 'four', x: 1600, y: 0, width: 264, height: 140 },
  ];
  const returning: LiveConnectionDescriptor = { id: 'three->one:0', from: 'three', to: 'one', kind: 'explicit', returning: true, fanOut: 0, fanOutCount: 1 };

  function pointsOf(map: typeof placements): readonly { readonly x: number; readonly y: number }[] {
    const scene = buildWorkflowScene({ workflow, tasks: [], placements: map });
    const edge = scene.edges.find(value => value.from === 'three' && value.to === 'one');
    if (edge === undefined) throw new Error('the returning connection is missing');
    return edge.shape.points;
  }

  it('draws the same returning path for the committed scene and the live surface', () => {
    const live = edgeModel(rects, [returning]);
    expect(pointsOf(placements)).toEqual(live[0]!.points);
  });

  it('leaves the returning path alone when a stage outside its corridor moves', () => {
    const moved = new Map(placements);
    moved.set('four', { x: 1600, y: 2000 });
    expect(pointsOf(moved)).toEqual(pointsOf(placements));
  });

  it('leaves the returning path alone when a stage outside its corridor resizes', () => {
    const sizes = new Map([['four', { width: 600, height: 900 }]]);
    const plain = buildWorkflowScene({ workflow, tasks: [], placements });
    const taller = buildWorkflowScene({ workflow, tasks: [], placements, sizes });
    const shape = (scene: typeof plain) => scene.edges.find(value => value.from === 'three' && value.to === 'one')!.shape.points;
    expect(shape(taller)).toEqual(shape(plain));
  });
});
