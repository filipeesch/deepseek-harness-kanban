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
