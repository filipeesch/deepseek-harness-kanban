import { describe, expect, it } from 'vitest';
import { createBoard, initialHubState } from '../../src/domain/hub-schema.js';
import { createTask, editBoardWorkflow } from '../../src/domain/hub-operations.js';
import { applyWorkflowEdits } from '../../src/domain/workflow-edit.js';

const NOW = '2026-11-08T00:00:00.000Z';
const FLOW = [
  '# Delivery flow',
  'name: Delivery Flow',
  'initial_column: backlog',
  'columns:',
  '  - id: backlog',
  '    label: Backlog',
  '  - id: plan',
  '    label: Plan',
  '  - id: done',
  '    label: Done',
  '',
].join('\n');

function deps() {
  let count = 0;
  return { id: () => 'id-' + (++count), now: () => NOW };
}

function hub() {
  const value = initialHubState('hub', 'Hub', NOW);
  value.boards.push(createBoard('board', 'Board', NOW, FLOW));
  value.projects.push({ id: 'project', projectKey: 'project', name: 'Project', projectPath: '/repos/project' });
  return value;
}

function expectCode(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error('Expected ' + code + '.');
}

describe('workflow text edits', () => {
  it('applies one literal replacement and preserves the rest of the document', () => {
    const result = applyWorkflowEdits(FLOW, [{ old: '  - id: plan\n    label: Plan\n', new: '  - id: plan\n    label: Plan\n    on_enter_prompt: |\n      Propose an approach.\n' }]);
    expect(result).toContain('# Delivery flow');
    expect(result).toContain('on_enter_prompt: |\n      Propose an approach.');
    expect(result.replace('    on_enter_prompt: |\n      Propose an approach.\n', '')).toBe(FLOW);
  });

  it('applies edits in order so a later edit can match text from an earlier one', () => {
    const result = applyWorkflowEdits(FLOW, [
      { old: '  - id: plan\n    label: Plan\n', new: '  - id: plan\n    label: Planning\n' },
      { old: '    label: Planning\n', new: '    label: Planning\n    on_enter_prompt: Plan first.\n' },
    ]);
    expect(result).toContain('label: Planning');
    expect(result).toContain('on_enter_prompt: Plan first.');
  });

  it('rejects an old value that does not occur', () => {
    expectCode(() => applyWorkflowEdits(FLOW, [{ old: 'label: Missing', new: 'label: Other' }]), 'WORKFLOW_EDIT_NOT_FOUND');
  });

  it('rejects an old value that occurs more than once and reports the count', () => {
    try {
      applyWorkflowEdits(FLOW, [{ old: '    label: ', new: '    label: ' }]);
      throw new Error('Expected the ambiguous edit to fail.');
    } catch (error) {
      expect(error).toMatchObject({ code: 'WORKFLOW_EDIT_AMBIGUOUS', details: { occurrences: 3 } });
    }
  });

  it('rejects an empty edit collection', () => {
    expectCode(() => applyWorkflowEdits(FLOW, []), 'INVALID_INPUT');
  });

  it('rejects empty old text', () => {
    expectCode(() => applyWorkflowEdits(FLOW, [{ old: '', new: 'x' }]), 'INVALID_INPUT');
  });

  it('allows a deletion with empty new text', () => {
    expect(applyWorkflowEdits(FLOW, [{ old: '  - id: done\n    label: Done\n', new: '' }])).not.toContain('id: done');
  });

  it('reports ambiguity introduced by an earlier edit', () => {
    expectCode(() => applyWorkflowEdits(FLOW, [
      { old: '  - id: done\n    label: Done\n', new: '  - id: done\n    label: Done\n  - id: extra\n    label: Done\n' },
      { old: '    label: Done\n', new: '    label: Complete\n' },
    ]), 'WORKFLOW_EDIT_AMBIGUOUS');
  });
});

describe('board workflow edits', () => {
  it('persists a valid edit through the workflow save path', () => {
    const value = hub();
    editBoardWorkflow(value, 'board', [{ old: '  - id: plan\n    label: Plan\n', new: '  - id: plan\n    label: Plan\n    on_enter_prompt: Plan first.\n' }], deps());
    expect(value.boards[0]!.workflowYaml).toContain('on_enter_prompt: Plan first.');
    expect(value.boards[0]!.workflow.columns[1]!.onEnterPrompt).toBe('Plan first.');
  });

  it('leaves the board unchanged when the old text is missing', () => {
    const value = hub();
    const before = structuredClone(value.boards[0]);
    expectCode(() => editBoardWorkflow(value, 'board', [{ old: 'label: Missing', new: 'label: Other' }], deps()), 'WORKFLOW_EDIT_NOT_FOUND');
    expect(value.boards[0]).toEqual(before);
  });

  it('leaves the board unchanged when a later edit in the same call is missing', () => {
    const value = hub();
    const before = structuredClone(value.boards[0]);
    expectCode(() => editBoardWorkflow(value, 'board', [
      { old: '  - id: plan\n    label: Plan\n', new: '  - id: plan\n    label: Plan\n    on_enter_prompt: Plan first.\n' },
      { old: 'label: Missing', new: 'label: Other' },
    ], deps()), 'WORKFLOW_EDIT_NOT_FOUND');
    expect(value.boards[0]).toEqual(before);
  });

  it('leaves the board unchanged when the edited document is invalid', () => {
    const value = hub();
    const before = structuredClone(value.boards[0]);
    expectCode(() => editBoardWorkflow(value, 'board', [{ old: '    label: Done\n', new: '    label: [unclosed\n' }], deps()), 'INVALID_WORKFLOW');
    expect(value.boards[0]).toEqual(before);
  });

  it('leaves the board unchanged when the edit would orphan a task stage', () => {
    const value = hub();
    const task = createTask(value, { boardId: 'board', projectId: 'project', title: 'Task', description: '' }, deps());
    task.columnId = 'done';
    const before = structuredClone(value.boards[0]);
    expectCode(() => editBoardWorkflow(value, 'board', [{ old: '  - id: done\n    label: Done\n', new: '' }], deps()), 'WORKFLOW_ORPHAN_COLUMNS');
    expect(value.boards[0]).toEqual(before);
  });
});

describe('edit failures and scoped edits', () => {
  const TWO_STAGES = [
    'name: Two',
    'initial_column: a',
    'columns:',
    '  - id: a',
    '    label: A',
    '    on_enter_prompt: |',
    '      Exit code 4 means the space is not configured.',
    '  - id: b',
    '    label: B',
    '    on_enter_prompt: |',
    '      Exit code 4 means the space is not configured.',
    '',
  ].join('\n');

  function failure(run: () => unknown): any {
    try { run(); } catch (error) { return error; }
    throw new Error('The edit was expected to fail.');
  }

  it('reports the failing edit index and the closest line for a missing match', () => {
    const error = failure(() => applyWorkflowEdits(TWO_STAGES, [
      { old: 'label: A', new: 'label: Alpha' },
      { old: 'Exit code 5 means the space is not configured.', new: 'x' },
    ]));
    expect(error).toMatchObject({ code: 'WORKFLOW_EDIT_NOT_FOUND' });
    expect(error.details).toMatchObject({ index: 1, occurrences: 0 });
    expect(error.details.closest.text).toBe('Exit code 4 means the space is not configured.');
    expect(error.details.closest.line).toBe(7);
  });

  it('reports the occurrence lines and stages for an ambiguous match', () => {
    const error = failure(() => applyWorkflowEdits(TWO_STAGES, [{ old: 'Exit code 4 means the space is not configured.', new: 'x' }]));
    expect(error).toMatchObject({ code: 'WORKFLOW_EDIT_AMBIGUOUS' });
    expect(error.details).toMatchObject({ index: 0, occurrences: 2, lineNumbers: [7, 11], stages: ['a', 'b'] });
  });

  it('scopes a match to one of two stages carrying the same text', () => {
    const value = applyWorkflowEdits(TWO_STAGES, [{ old: 'Exit code 4 means the space is not configured.', new: 'Only here.', stage: 'b' }]);
    const lines = value.split('\n');
    expect(lines[6]).toContain('Exit code 4 means the space is not configured.');
    expect(lines[10]).toContain('Only here.');
  });

  it('scopes a match to one authored field of a stage', () => {
    const flow = [
      'name: Fields',
      'initial_column: a',
      'columns:',
      '  - id: a',
      '    label: A',
      '    description: deploy now',
      '    on_enter_prompt: deploy now',
      '',
    ].join('\n');
    const value = applyWorkflowEdits(flow, [{ old: 'deploy now', new: 'ship now', stage: 'a', field: 'description' }]);
    expect(value).toContain('description: ship now');
    expect(value).toContain('on_enter_prompt: deploy now');
  });

  it('does not treat a key-shaped line inside a block scalar as a stage field', () => {
    const flow = [
      'name: Scalars',
      'initial_column: a',
      'columns:',
      '  - id: a',
      '    label: A',
      '    on_enter_prompt: |',
      '      description: this is prose inside the instruction',
      '  - id: done',
      '    label: Done',
      '',
    ].join('\n');
    const unknown = failure(() => applyWorkflowEdits(flow, [{ old: 'description: this is prose inside the instruction', new: 'x', stage: 'a', field: 'description' }]));
    expect(unknown).toMatchObject({ code: 'WORKFLOW_EDIT_NOT_FOUND' });
    expect(unknown.details).toMatchObject({ index: 0, scope: { stage: 'a', field: 'description' } });
    // The same text stays editable through the stage scope.
    const scoped = applyWorkflowEdits(flow, [{ old: 'this is prose inside the instruction', new: 'edited prose', stage: 'a' }]);
    expect(scoped).toContain('edited prose');
  });

  it('rejects an unknown stage and an unknown field', () => {
    const missing = failure(() => applyWorkflowEdits(TWO_STAGES, [{ old: 'label: A', new: 'x', stage: 'missing' }]));
    expect(missing).toMatchObject({ code: 'STAGE_NOT_FOUND' });
    expect(missing.details).toMatchObject({ index: 0, occurrences: 0 });
    const unknown = failure(() => applyWorkflowEdits(TWO_STAGES, [{ old: 'label: A', new: 'x', stage: 'b', field: 'description' }]));
    expect(unknown).toMatchObject({ code: 'WORKFLOW_EDIT_NOT_FOUND' });
    expect(unknown.details).toMatchObject({ index: 0, scope: { stage: 'b', field: 'description' } });
  });
});
