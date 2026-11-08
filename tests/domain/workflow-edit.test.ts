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
  value.projects.push({ id: 'project', name: 'Project', projectPath: '/repos/project' });
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
