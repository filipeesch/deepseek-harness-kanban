import { describe, expect, it } from 'vitest';
import { candidateStageFor, decideCreationDrop, decideEndDrop } from '../../src/client/workflow-view/connection-target.js';
import { boardConnectionDropResolver } from '../../src/client/workflow-view/connection-drop.js';

describe('connection drop decision', () => {
  it('keeps a release inside its own stage an anchor change', () => {
    expect(decideEndDrop({ end: 'target', from: 'a', to: 'b', stageUnder: 'b' })).toEqual({ kind: 'anchor' });
    expect(decideEndDrop({ end: 'source', from: 'a', to: 'b', stageUnder: 'a' })).toEqual({ kind: 'anchor' });
    expect(decideEndDrop({ end: 'target', from: 'a', to: 'b', stageUnder: null })).toEqual({ kind: 'anchor' });
  });

  it('re-points a target end released over another stage', () => {
    expect(decideEndDrop({ end: 'target', from: 'a', to: 'b', stageUnder: 'c' })).toEqual({ kind: 'repoint', to: 'c' });
  });

  it('moves the owner of a source end released over another stage', () => {
    expect(decideEndDrop({ end: 'source', from: 'a', to: 'b', stageUnder: 'c' })).toEqual({ kind: 'reown', toSource: 'c' });
  });

  it('refuses a release that would author a self transition', () => {
    expect(decideEndDrop({ end: 'target', from: 'a', to: 'b', stageUnder: 'a' })).toEqual({ kind: 'none' });
    expect(decideEndDrop({ end: 'source', from: 'a', to: 'b', stageUnder: 'b' })).toEqual({ kind: 'none' });
  });

  it('marks the stage a release would re-point or re-own', () => {
    expect(candidateStageFor({ end: 'target', from: 'a', to: 'b', stageUnder: 'c' })).toBe('c');
    expect(candidateStageFor({ end: 'source', from: 'a', to: 'b', stageUnder: 'c' })).toBe('c');
  });

  it('marks no stage when the release would re-anchor or change nothing', () => {
    expect(candidateStageFor({ end: 'target', from: 'a', to: 'b', stageUnder: 'b' })).toBeNull();
    expect(candidateStageFor({ end: 'source', from: 'a', to: 'b', stageUnder: 'a' })).toBeNull();
    expect(candidateStageFor({ end: 'target', from: 'a', to: 'b', stageUnder: 'a' })).toBeNull();
    expect(candidateStageFor({ end: 'source', from: 'a', to: 'b', stageUnder: 'b' })).toBeNull();
    expect(candidateStageFor({ end: 'target', from: 'a', to: 'b', stageUnder: null })).toBeNull();
  });

  it('creates only over another stage', () => {
    expect(decideCreationDrop({ sourceId: 'a', stageUnder: 'b' })).toEqual({ kind: 'create', to: 'b' });
    expect(decideCreationDrop({ sourceId: 'a', stageUnder: 'a' })).toEqual({ kind: 'none' });
    expect(decideCreationDrop({ sourceId: 'a', stageUnder: null })).toEqual({ kind: 'none' });
  });

  it('resolves no stage without a document', () => {
    expect(boardConnectionDropResolver().resolve({ clientX: 0, clientY: 0 })).toBeNull();
  });
});
