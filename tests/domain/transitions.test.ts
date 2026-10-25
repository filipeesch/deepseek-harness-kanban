import { describe, expect, it } from 'vitest';
import type { Workflow } from '../../src/shared/types.js';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { canTransition, transitionAccess, transitionDestinations } from '../../src/domain/transitions.js';

const workflow: Workflow = {
  name: 'Flow',
  initialColumnId: 'backlog',
  columns: [
    { id: 'backlog', name: 'Backlog', allowedTransitions: ['plan'] },
    { id: 'plan', name: 'Plan' },
    { id: 'done', name: 'Done' },
    { id: 'archive', name: 'Archive', allowedTransitions: [] },
  ],
  groups: [{ id: 'planning', name: 'Planning', columnIds: ['plan', 'backlog'] }],
};

describe('transition access policy', () => {
  it('classifies same-stage, allowed, restricted, and unknown moves', () => {
    expect(transitionAccess(workflow, 'backlog', 'backlog')).toBe('reorder');
    expect(transitionAccess(workflow, 'backlog', 'plan')).toBe('allowed');
    expect(transitionAccess(workflow, 'backlog', 'done')).toBe('restricted');
    expect(transitionAccess(workflow, 'missing', 'done')).toBeNull();
    expect(transitionAccess(workflow, 'backlog', 'missing')).toBeNull();
  });

  it('treats omitted restrictions as all allowed and an empty list as none', () => {
    expect(transitionAccess(workflow, 'plan', 'done')).toBe('allowed');
    expect(transitionAccess(workflow, 'plan', 'archive')).toBe('allowed');
    expect(transitionAccess(workflow, 'archive', 'backlog')).toBe('restricted');
    expect(transitionAccess(workflow, 'archive', 'done')).toBe('restricted');
  });

  it('returns every workflow stage in workflow order with its access', () => {
    expect(transitionDestinations(workflow, 'backlog')).toEqual([
      { column: workflow.columns[0], access: 'reorder' },
      { column: workflow.columns[1], access: 'allowed' },
      { column: workflow.columns[2], access: 'restricted' },
      { column: workflow.columns[3], access: 'restricted' },
    ]);
    expect(transitionDestinations(workflow, 'backlog').map(entry => entry.column.id)).toEqual(['backlog', 'plan', 'done', 'archive']);
  });

  it('matches canTransition to the allowed classification for every pair', () => {
    for (const from of workflow.columns) {
      for (const to of workflow.columns) {
        expect(canTransition(workflow, from.id, to.id)).toBe(transitionAccess(workflow, from.id, to.id) === 'allowed');
      }
    }
    expect(canTransition(workflow, 'missing', 'done')).toBe(false);
    expect(canTransition(workflow, 'backlog', 'missing')).toBe(false);
  });

  it('applies the same classification to parsed YAML restrictions', () => {
    const parsed = parseWorkflow([
      'name: Parsed',
      'initial_column: todo',
      'columns:',
      '  - id: todo',
      '    label: Todo',
      '    allowed_transitions: [doing]',
      '  - id: doing',
      '    label: Doing',
      '    allowed_transitions: []',
      '  - id: done',
      '    label: Done',
      '',
    ].join('\n'));
    expect(transitionAccess(parsed, 'todo', 'doing')).toBe('allowed');
    expect(transitionAccess(parsed, 'todo', 'done')).toBe('restricted');
    expect(transitionAccess(parsed, 'doing', 'done')).toBe('restricted');
    expect(transitionAccess(parsed, 'done', 'todo')).toBe('allowed');
  });
});
