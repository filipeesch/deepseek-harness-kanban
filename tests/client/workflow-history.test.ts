import { describe, expect, it } from 'vitest';
import { PLACEMENT_HISTORY_LIMIT, canRedo, canUndo, emptyHistory, pushStep, redoStep, undoStep } from '../../src/client/workflow-view/history.js';

const step = (id: string) => ({ before: { one: { x: 0, y: 0 } }, after: { one: { x: 10, y: 10 } } });

describe('placement history', () => {
  it('starts empty and cannot undo or redo', () => {
    const history = emptyHistory();
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
    expect(undoStep(history)).toBeNull();
    expect(redoStep(history)).toBeNull();
  });

  it('undoes and redoes one step', () => {
    const history = pushStep(emptyHistory(), step('a'));
    expect(canUndo(history)).toBe(true);
    const undone = undoStep(history)!;
    expect(undone.positions).toEqual({ one: { x: 0, y: 0 } });
    expect(canRedo(undone.history)).toBe(true);
    const redone = redoStep(undone.history)!;
    expect(redone.positions).toEqual({ one: { x: 10, y: 10 } });
  });

  it('drops the redo tail when a new step arrives', () => {
    const first = pushStep(emptyHistory(), step('a'));
    const undone = undoStep(first)!.history;
    const second = pushStep(undone, step('b'));
    expect(second.entries).toHaveLength(1);
    expect(canRedo(second)).toBe(false);
  });

  it('bounds the history and keeps the cursor at the newest step', () => {
    let history = emptyHistory();
    for (let index = 0; index < PLACEMENT_HISTORY_LIMIT + 5; index++) history = pushStep(history, step(String(index)));
    expect(history.entries).toHaveLength(PLACEMENT_HISTORY_LIMIT);
    expect(history.cursor).toBe(PLACEMENT_HISTORY_LIMIT);
    expect(canRedo(history)).toBe(false);
  });
});
const connectionStep = {
  before: { one: { x: 0, y: 0 } },
  after: { one: { x: 0, y: 0 } },
  beforeConnections: {},
  afterConnections: { 'one->two': { from: 'one', to: 'two', source: { side: 'top' as const, at: 1 } } },
};

describe('connection layout history', () => {
  it('restores the connection layout on undo and redo', () => {
    const history = pushStep(emptyHistory(), connectionStep);
    const undone = undoStep(history)!;
    expect(undone.connections).toEqual({});
    expect(canRedo(undone.history)).toBe(true);
    const redone = redoStep(undone.history)!;
    expect(redone.connections).toEqual(connectionStep.afterConnections);
  });

  it('leaves the connection layout undefined for a step that changed none', () => {
    const history = pushStep(emptyHistory(), step('a'));
    expect(undoStep(history)!.connections).toBeUndefined();
    expect(redoStep(undoStep(history)!.history)!.connections).toBeUndefined();
  });

  it('restores an entry that a later step removed', () => {
    const removal = { before: {}, after: {}, beforeConnections: connectionStep.afterConnections, afterConnections: {} };
    const history = pushStep(pushStep(emptyHistory(), connectionStep), removal);
    const undone = undoStep(history)!;
    expect(undone.connections).toEqual(connectionStep.afterConnections);
    const redone = redoStep(undone.history)!;
    expect(redone.connections).toEqual({});
  });
});

describe('workflow history steps', () => {
  const layoutPositions = { one: { x: 0, y: 0 } };
  const layoutStep = { before: layoutPositions, after: { one: { x: 10, y: 10 } } };
  const transitionStep = {
    before: layoutPositions,
    after: layoutPositions,
    beforeTransitions: { one: [{ to: 'two' }] },
    afterTransitions: { one: [{ to: 'three' }] },
  };
  const bothStep = {
    ...transitionStep,
    beforeConnections: { 'one->two': { from: 'one', to: 'two' } },
    afterConnections: {},
  };

  it('restores the destinations a transition step carries', () => {
    const history = pushStep(emptyHistory(), transitionStep);
    const undone = undoStep(history)!;
    expect(undone.transitions).toEqual({ one: [{ to: 'two' }] });
    expect(redoStep(undone.history)!.transitions).toEqual({ one: [{ to: 'three' }] });
  });

  it('carries a pruned connection layout with the transition that pruned it', () => {
    const history = pushStep(emptyHistory(), bothStep);
    const undone = undoStep(history)!;
    expect(undone.connections).toEqual({ 'one->two': { from: 'one', to: 'two' } });
    expect(undone.transitions).toEqual({ one: [{ to: 'two' }] });
    const redone = redoStep(undone.history)!;
    expect(redone.connections).toEqual({});
    expect(redone.transitions).toEqual({ one: [{ to: 'three' }] });
  });

  it('leaves a layout-only step without transitions', () => {
    const history = pushStep(emptyHistory(), layoutStep);
    expect(undoStep(history)!.transitions).toBeUndefined();
  });
});

