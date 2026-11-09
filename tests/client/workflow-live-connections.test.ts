import { describe, expect, it } from 'vitest';
import { contactPoints, liveConnections, type LiveConnectionDescriptor, type LiveStageRect } from '../../src/client/workflow-view/live-connections.js';

const stages: readonly LiveStageRect[] = [
  { id: 'one', x: 0, y: 0, width: 200, height: 100 },
  { id: 'two', x: 400, y: 0, width: 200, height: 100 },
];

const connection: LiveConnectionDescriptor = { id: 'one->two:0', from: 'one', to: 'two', kind: 'explicit', returning: false, fanOut: 0, fanOutCount: 1 };

describe('live connections', () => {
  it('derives the drawn edge from the rectangles it is given', () => {
    const [edge] = liveConnections(stages, [connection]);
    expect(edge?.id).toBe('one->two:0');
    expect(edge?.kind).toBe('explicit');
    expect(edge?.points[0]).toEqual({ x: 200, y: 50 });
    expect(edge?.points[edge.points.length - 1]).toEqual({ x: 400, y: 50 });
  });

  it('follows a moved stage without waiting for a stored placement', () => {
    const moved = stages.map(stage => stage.id === 'two' ? { ...stage, y: 240 } : stage);
    const [before] = liveConnections(stages, [connection]);
    const [after] = liveConnections(moved, [connection]);
    expect(after!.points[after!.points.length - 1]!.y).toBe(290);
    expect(before!.points[before!.points.length - 1]!.y).toBe(50);
  });

  it('follows a resized stage edge', () => {
    const resized = stages.map(stage => stage.id === 'one' ? { ...stage, width: 320 } : stage);
    const [edge] = liveConnections(resized, [connection]);
    expect(edge?.points[0]).toEqual({ x: 320, y: 50 });
  });

  it('skips a connection whose stage is missing', () => {
    expect(liveConnections([stages[0]!], [connection])).toEqual([]);
  });

  it('reports the contact points at both ends', () => {
    const [edge] = liveConnections(stages, [connection]);
    expect(contactPoints(edge!)).toEqual({ start: { x: 200, y: 50 }, end: { x: 400, y: 50 } });
  });

  it('has no contact points for an empty edge', () => {
    expect(contactPoints({ id: 'x', kind: 'implicit', returning: false, path: '', points: [], tipAngle: 0 })).toBeNull();
  });
});
