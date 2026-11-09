import { describe, expect, it } from 'vitest';
import type { Workflow } from '../../src/shared/types.js';
import { computeAutoLayout, freezeAutoLayout, graphKey, mergePlacements, samePlacements } from '../../src/client/workflow-view/placement.js';
import { transitions } from '../support/transition-rules.js';

const workflow: Workflow = {
  name: 'Flow',
  initialColumnId: 'one',
  columns: [{ id: 'one', name: 'One', allowedTransitions: transitions('two') }, { id: 'two', name: 'Two' }],
  groups: [],
};

describe('stage placement', () => {
  it('keys the workflow structure without its placement', () => {
    const moved: Workflow = { ...workflow, columns: workflow.columns.map((column, index) => ({ ...column, ...(index === 0 ? { position: { x: 40, y: 80 } } : {}) })) };
    expect(graphKey(moved)).toBe(graphKey(workflow));
  });

  it('changes the key when the structure changes', () => {
    const extra: Workflow = { ...workflow, columns: [...workflow.columns, { id: 'three', name: 'Three' }] };
    expect(graphKey(extra)).not.toBe(graphKey(workflow));
  });

  it('freezes automatic placement until the key changes', () => {
    let computed = 0;
    const compute = () => { computed += 1; return computeAutoLayout(workflow, new Map()); };
    const first = freezeAutoLayout(null, 'a', compute);
    const second = freezeAutoLayout(first, 'a', compute);
    expect(second).toBe(first);
    expect(computed).toBe(1);
    const third = freezeAutoLayout(second, 'b', compute);
    expect(computed).toBe(2);
    expect(third.key).toBe('b');
  });

  it('applies overrides over stored positions over automatic placement', () => {
    const merged = mergePlacements({ one: { x: 0, y: 0 } }, { one: { x: 100, y: 0 } }, { one: { x: 200, y: 0 } });
    expect(merged.get('one')).toEqual({ x: 200, y: 0 });
    const stored = mergePlacements({ one: { x: 0, y: 0 } }, { one: { x: 100, y: 0 } });
    expect(stored.get('one')).toEqual({ x: 100, y: 0 });
  });

  it('compares placement maps', () => {
    expect(samePlacements({ one: { x: 1, y: 2 } }, { one: { x: 1, y: 2 } })).toBe(true);
    expect(samePlacements({ one: { x: 1, y: 2 } }, { one: { x: 1, y: 3 } })).toBe(false);
    expect(samePlacements({ one: { x: 1, y: 2 } }, {})).toBe(false);
  });
});
