import { describe, expect, it } from 'vitest';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { updateStage } from '../../src/domain/stage-update.js';

const AUTHORED = [
  '# The delivery flow, authored by hand.',
  'name: Delivery Flow',
  'initial_column: backlog',
  'columns:',
  '  - id: backlog',
  '    label: Backlog',
  '    # This stage starts everything.',
  '  - id: plan',
  '    label: Plan',
  '    on_enter_prompt: |-',
  '      Read the brief.',
  '      Then write the plan.',
  "    allowed_transitions:",
  '      - to: backlog',
  '  - id: done',
  '    label: Done',
  '',
].join('\n');

function stage(text: string, id: string) {
  const workflow = parseWorkflow(text);
  const column = workflow.columns.find(value => value.id === id);
  if (!column) throw new Error('missing stage ' + id);
  return { workflow, column };
}

describe('stage update', () => {
  it('changes only the edited name and keeps every authored character', () => {
    const result = updateStage({ text: AUTHORED, stageId: 'plan', patch: { name: 'Planning' } });
    expect(stage(result.text, 'plan').column.name).toBe('Planning');
    expect(result.text).toContain('# The delivery flow, authored by hand.');
    expect(result.text).toContain('    # This stage starts everything.');
    expect(result.text).toContain('      Read the brief.');
    expect(stage(result.text, 'backlog').column.name).toBe('Backlog');
    expect(stage(result.text, 'done').column.name).toBe('Done');
  });

  it('edits inline dash columns and columns that lack the key', () => {
    const text = ['columns:', '  - id: todo', '    label: Todo', '  - id: done', '    name: Done', ''].join('\n');
    const named = updateStage({ text, stageId: 'todo', patch: { name: 'To do' } });
    expect(stage(named.text, 'todo').column.name).toBe('To do');
    const renamedAuthored = updateStage({ text, stageId: 'done', patch: { name: 'Finished' } });
    expect(stage(renamedAuthored.text, 'done').column.name).toBe('Finished');
    expect(renamedAuthored.text).not.toContain('name: Done');
  });

  it('stores a multiline instruction and clears it again', () => {
    const written = updateStage({ text: AUTHORED, stageId: 'done', patch: { onEnterPrompt: 'Ship it.\nThen celebrate.' } });
    expect(stage(written.text, 'done').column.onEnterPrompt).toBe('Ship it.\nThen celebrate.');
    const cleared = updateStage({ text: written.text, stageId: 'done', patch: { onEnterPrompt: '   ' } });
    expect(stage(cleared.text, 'done').column.onEnterPrompt).toBeUndefined();
    expect(cleared.text).not.toContain('on_enter_prompt: |-\n  Ship it.');
  });

  it('writes allowed transitions with conditions and removes them for any stage', () => {
    const restricted = updateStage({
      text: AUTHORED, stageId: 'done',
      patch: { allowedTransitions: [{ to: 'plan', when: 'needs more work' }, { to: 'backlog' }] },
    });
    expect(stage(restricted.text, 'done').column.allowedTransitions).toEqual([{ to: 'plan', when: 'needs more work' }, { to: 'backlog' }]);
    const unrestricted = updateStage({ text: restricted.text, stageId: 'done', patch: { allowedTransitions: null } });
    expect(stage(unrestricted.text, 'done').column.allowedTransitions).toBeUndefined();
  });

  it('authors an empty transition list as the stage that permits no destination', () => {
    const terminal = updateStage({ text: AUTHORED, stageId: 'plan', patch: { allowedTransitions: [] } });
    expect(stage(terminal.text, 'plan').column.allowedTransitions).toEqual([]);
    expect(terminal.text).toContain('allowed_transitions: []');
    // The empty list is authored state, not absence: the next write must keep it.
    const untouched = updateStage({ text: terminal.text, stageId: 'plan', patch: { name: 'Planning' } });
    expect(stage(untouched.text, 'plan').column.allowedTransitions).toEqual([]);
    // Restoring any-stage removes the field instead of writing an empty one.
    const restored = updateStage({ text: terminal.text, stageId: 'plan', patch: { allowedTransitions: null } });
    expect(stage(restored.text, 'plan').column.allowedTransitions).toBeUndefined();
    expect(restored.text).not.toContain('allowed_transitions');
  });

  it('writes one destination condition without rewriting the other entries', () => {
    const conditioned = updateStage({ text: AUTHORED, stageId: 'plan', patch: { transitionCondition: { to: 'backlog', when: 'the plan is parked' } } });
    expect(stage(conditioned.text, 'plan').column.allowedTransitions).toEqual([{ to: 'backlog', when: 'the plan is parked' }]);
    const cleared = updateStage({ text: conditioned.text, stageId: 'plan', patch: { transitionCondition: { to: 'backlog', when: null } } });
    expect(stage(cleared.text, 'plan').column.allowedTransitions).toEqual([{ to: 'backlog' }]);
    // The authored name and the comment above the stage survive the edit.
    expect(cleared.text).toContain('# The delivery flow, authored by hand.');
    expect(cleared.text).toContain('# This stage starts everything.');
  });

  it('refuses a patch that changes the list and one condition together', () => {
    expect(() => updateStage({
      text: AUTHORED, stageId: 'plan',
      patch: { allowedTransitions: [{ to: 'backlog' }], transitionCondition: { to: 'backlog', when: 'x' } },
    })).toThrow(/at the same time/);
  });

  it('refuses a condition for a destination the board does not hold', () => {
    expect(() => updateStage({ text: AUTHORED, stageId: 'plan', patch: { transitionCondition: { to: 'ghost', when: 'x' } } })).toThrow(/not a stage/);
    expect(() => updateStage({ text: AUTHORED, stageId: 'plan', patch: { transitionCondition: { to: 'plan', when: 'x' } } })).toThrow(/own transition target/);
  });

  it('rejects a self target and an unknown target', () => {
    expect(() => updateStage({ text: AUTHORED, stageId: 'plan', patch: { allowedTransitions: [{ to: 'plan' }] } })).toThrow(/own transition target/);
    expect(() => updateStage({ text: AUTHORED, stageId: 'plan', patch: { allowedTransitions: [{ to: 'ghost' }] } })).toThrow(/not a stage/);
    expect(() => updateStage({ text: AUTHORED, stageId: 'plan', patch: { allowedTransitions: [{ to: 'backlog' }, { to: 'backlog' }] } })).toThrow(/listed once/);
  });

  it('renames the identifier and carries every reference with it', () => {
    const text = [
      'initial_column: plan',
      'columns:',
      '  - id: plan',
      '    label: Plan',
      '  - id: done',
      '    label: Done',
      '    allowed_transitions:',
      '      - to: plan',
      'groups:',
      '  - id: delivery',
      '    label: Delivery',
      '    columns: [plan, done]',
      'connections:',
      '  - from: plan',
      '    to: done',
      '',
    ].join('\n');
    const result = updateStage({ text, stageId: 'plan', patch: { id: 'planning' } });
    const workflow = parseWorkflow(result.text);
    expect(workflow.initialColumnId).toBe('planning');
    expect(workflow.groups[0]?.columnIds).toEqual(['planning', 'done']);
    expect(workflow.columns.find(value => value.id === 'done')?.allowedTransitions).toEqual([{ to: 'planning' }]);
    expect(workflow.connections).toEqual([{ from: 'planning', to: 'done' }]);
    expect(result.renamedFrom).toBe('plan');
    expect(result.renamedTo).toBe('planning');
    expect(result.rewrittenReferences).toBe(4);
    expect(workflow.columns.find(value => value.id === 'planning')?.name).toBe('Plan');
  });

  it('rejects a duplicate identifier and an unsafe identifier', () => {
    expect(() => updateStage({ text: AUTHORED, stageId: 'plan', patch: { id: 'done' } })).toThrow(/already uses the id/);
    expect(() => updateStage({ text: AUTHORED, stageId: 'plan', patch: { id: 'not a safe id' } })).toThrow(/safe identifier/);
  });

  it('makes another stage the initial stage', () => {
    const result = updateStage({ text: AUTHORED, stageId: 'done', patch: { initial: true } });
    expect(parseWorkflow(result.text).initialColumnId).toBe('done');
  });

  it('produces text the parser accepts for every patch it accepts', () => {
    const patches = [
      { name: 'X' },
      { onEnterPrompt: 'a\nb' },
      { onEnterPrompt: null },
      { allowedTransitions: [{ to: 'done' }] },
      { allowedTransitions: null },
      { id: 'planned' },
      { initial: true as const },
    ];
    for (const patch of patches) expect(() => parseWorkflow(updateStage({ text: AUTHORED, stageId: 'plan', patch }).text)).not.toThrow();
  });

  it('edits a flow-style column and keeps the collection flow', () => {
    const text = 'columns: [{id: todo, label: Todo}, {id: done, label: Done}]' + String.fromCharCode(10);
    const named = updateStage({ text, stageId: 'todo', patch: { name: 'To do' } });
    expect(stage(named.text, 'todo').column.name).toBe('To do');
    expect(named.text.trim().endsWith('}]')).toBe(true);
    const guarded = updateStage({ text, stageId: 'done', patch: { allowedTransitions: [{ to: 'todo', when: 'overdue' }] } });
    expect(stage(guarded.text, 'done').column.allowedTransitions).toEqual([{ to: 'todo', when: 'overdue' }]);
    expect(guarded.text.trim().endsWith('}]')).toBe(true);
    const removed = updateStage({ text: guarded.text, stageId: 'done', patch: { allowedTransitions: null } });
    expect(stage(removed.text, 'done').column.allowedTransitions).toBeUndefined();
  });

  it('adds a field to a stage whose fields are followed by a comment', () => {
    const instructed = updateStage({ text: AUTHORED, stageId: 'backlog', patch: { onEnterPrompt: 'Start here.' } });
    expect(stage(instructed.text, 'backlog').column.onEnterPrompt).toBe('Start here.');
    expect(instructed.text).toContain('    # This stage starts everything.');
    expect(stage(instructed.text, 'plan').column.name).toBe('Plan');
    const guarded = updateStage({ text: instructed.text, stageId: 'backlog', patch: { allowedTransitions: [{ to: 'plan' }] } });
    expect(stage(guarded.text, 'backlog').column.allowedTransitions).toEqual([{ to: 'plan' }]);
  });

  it('carries a rename without rewriting other stages\' authored transitions or lists', () => {
    const text = [
      'columns:',
      '  - id: plan',
      '    label: Plan',
      '  - id: done',
      '    label: Done',
      '    # the only way back',
      '    allowed_transitions:',
      '      # only when reviewed',
      '      - to: plan',
      '        when: "needs work: again"',
      'groups:',
      '  - id: g',
      '    label: Group',
      '    columns:',
      '      - plan',
      '      - done',
      'connections:',
      '  - from: plan',
      '    to: done',
      '  - from: done',
      '    to: plan',
      '',
    ].join(String.fromCharCode(10));
    const result = updateStage({ text, stageId: 'plan', patch: { id: 'planning' } });
    expect(result.text).toContain('# the only way back');
    expect(result.text).toContain('# only when reviewed');
    expect(result.text).toContain('when: "needs work: again"');
    expect(result.text).toContain('      - planning');
    const workflow = parseWorkflow(result.text);
    expect(workflow.groups[0]?.columnIds).toEqual(['planning', 'done']);
    expect((workflow.connections ?? []).map(layout => layout.from + '>' + layout.to)).toEqual(['planning>done', 'done>planning']);
  });

  it('renames a stage authored with both label and name', () => {
    const text = ['columns:', '  - id: a', '    label: Same', '    name: Same', '  - id: b', '    label: B', ''].join(String.fromCharCode(10));
    expect(() => parseWorkflow(text)).not.toThrow();
    const result = updateStage({ text, stageId: 'a', patch: { name: 'Renamed' } });
    expect(stage(result.text, 'a').column.name).toBe('Renamed');
    expect(result.text).not.toContain('Same');
  });

  it('carries a rename into a group that authors no id', () => {
    const text = [
      'columns:',
      '  - id: plan',
      '    label: Plan',
      '  - id: done',
      '    label: Done',
      'groups:',
      '  - label: Planning',
      '    columns: [plan, done]',
      '',
    ].join(String.fromCharCode(10));
    const result = updateStage({ text, stageId: 'plan', patch: { id: 'planning' } });
    expect(parseWorkflow(result.text).groups[0]?.columnIds).toEqual(['planning', 'done']);
    expect(result.text).toContain('- label: Planning');
    expect(result.text).not.toContain('id: group-1');
  });

  it('rejects a stage the workflow does not define', () => {
    expect(() => updateStage({ text: AUTHORED, stageId: 'ghost', patch: { name: 'X' } })).toThrow(/does not exist/);
  });
});
