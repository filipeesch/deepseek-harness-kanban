import { describe, expect, it } from 'vitest';
import { creationCandidateFor, creationFanOut, creationPreviewRoute } from '../../src/client/workflow-view/creation-preview.js';
import type { LiveConnectionDescriptor, LiveStageRect } from '../../src/client/workflow-view/edge-model.js';

const stages: readonly LiveStageRect[] = [
  { id: 'one', x: 0, y: 0, width: 200, height: 100 },
  { id: 'two', x: 400, y: 0, width: 200, height: 100 },
  { id: 'three', x: 800, y: 0, width: 200, height: 100 },
];

function preview(sourceId: string, targetId: string, side: 'top' | 'right' | 'bottom' | 'left', connections: readonly LiveConnectionDescriptor[] = []) {
  const route = creationPreviewRoute({ stages, connections, sourceId, targetId, side });
  if (route === null) throw new Error('the preview route is missing');
  return route;
}

describe('creation preview', () => {
  it('previews the automatic route of a forward connection', () => {
    const shape = preview('one', 'two', 'right');
    expect(shape.points[0]).toEqual({ x: 200, y: 50 });
    expect(shape.points[shape.points.length - 1]).toEqual({ x: 400, y: 50 });
  });

  it('authors the drawn side when it is not the automatic one', () => {
    const shape = preview('one', 'two', 'bottom');
    expect(shape.points[0]).toEqual({ x: 100, y: 100 });
    expect(shape.points[1]!.y).toBeGreaterThan(100);
  });

  it('previews a returning route below the stages it crosses', () => {
    const shape = preview('three', 'one', 'bottom');
    expect(shape.points[0]).toEqual({ x: 900, y: 100 });
    expect(Math.max(...shape.points.map(point => point.y))).toBeGreaterThan(140);
  });

  it('returns no route for a stage the diagram does not draw', () => {
    expect(creationPreviewRoute({ stages, connections: [], sourceId: 'one', targetId: 'missing', side: 'right' })).toBeNull();
  });

  it('offers a candidate only where the release would author a destination', () => {
    const explicit: LiveConnectionDescriptor = { id: 'one->two:0', from: 'one', to: 'two', kind: 'explicit', returning: false, fanOut: 0, fanOutCount: 1 };
    const implicit: LiveConnectionDescriptor = { id: 'one->two:0', from: 'one', to: 'two', kind: 'implicit', returning: false, fanOut: 0, fanOutCount: 1 };
    // Another stage is a valid destination; the source stage and an already authored
    // destination are not, because that release stores nothing.
    expect(creationCandidateFor({ sourceId: 'one', stageUnder: 'three', connections: [explicit] })).toBe('three');
    expect(creationCandidateFor({ sourceId: 'one', stageUnder: 'one', connections: [explicit] })).toBeNull();
    expect(creationCandidateFor({ sourceId: 'one', stageUnder: null, connections: [explicit] })).toBeNull();
    expect(creationCandidateFor({ sourceId: 'one', stageUnder: 'two', connections: [explicit] })).toBeNull();
    // The default dashed path is drawn but authored nowhere, so drawing it turns it
    // into an authored destination and the preview must present it.
    expect(creationCandidateFor({ sourceId: 'one', stageUnder: 'two', connections: [implicit] })).toBe('two');
  });

  it('replaces the default path a stage already draws', () => {
    const implicit: LiveConnectionDescriptor = { id: 'one->two:0', from: 'one', to: 'two', kind: 'implicit', returning: false, fanOut: 0, fanOutCount: 1 };
    expect(creationFanOut([implicit], 'one')).toEqual({ fanOut: 0, fanOutCount: 1 });
  });

  it('follows the destinations a restricted stage already authors', () => {
    const first: LiveConnectionDescriptor = { id: 'one->two:0', from: 'one', to: 'two', kind: 'explicit', returning: false, fanOut: 0, fanOutCount: 1 };
    expect(creationFanOut([first], 'one')).toEqual({ fanOut: 1, fanOutCount: 2 });
    expect(creationFanOut([], 'one')).toEqual({ fanOut: 0, fanOutCount: 1 });
  });
});
