// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Workflow } from '../../src/shared/types.js';
import { presentWorkflow, presentedRules } from '../../src/client/workflow-view/present-workflow.js';

const workflow: Workflow = {
  name: 'Flow',
  initialColumnId: 'a',
  columns: [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B', allowedTransitions: [{ to: 'a', when: 'back' }] },
    { id: 'c', name: 'C', allowedTransitions: [] },
  ],
  groups: [],
};

describe('presented workflow', () => {
  it('returns the acknowledged workflow when no stage is overridden', () => {
    expect(presentWorkflow(workflow, {})).toBe(workflow);
    expect(presentWorkflow(workflow, { a: undefined })).toBe(workflow);
  });

  it('shows an authored destination set before it is stored', () => {
    const presented = presentWorkflow(workflow, { a: [{ to: 'c' }] });
    expect(presentedRules(presented, 'a')).toEqual([{ to: 'c' }]);
    expect(presentedRules(workflow, 'a')).toBeNull();
  });

  it('distinguishes a stage with no destination from one that allows any stage', () => {
    expect(presentedRules(presentWorkflow(workflow, { a: [] }), 'a')).toEqual([]);
    expect(presentedRules(presentWorkflow(workflow, { c: null }), 'c')).toBeNull();
  });

  it('leaves every stage the overrides do not name untouched', () => {
    const presented = presentWorkflow(workflow, { a: [{ to: 'b' }] });
    expect(presented.columns[1]).toBe(workflow.columns[1]);
    expect(presented.columns[2]).toBe(workflow.columns[2]);
  });

  it('copies the destination entries instead of sharing them', () => {
    const rules = [{ to: 'b', when: 'later' }];
    const presented = presentWorkflow(workflow, { a: rules });
    expect(presentedRules(presented, 'a')).not.toBe(rules);
    expect(presentedRules(presented, 'a')).toEqual(rules);
  });
});
