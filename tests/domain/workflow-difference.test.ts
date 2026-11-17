import { describe, expect, it } from 'vitest';
import { diffWorkflow, isWorkflowDifferenceEmpty, summarizeDifference } from '../../src/domain/workflow-difference.js';
import { parseWorkflow } from '../../src/domain/workflow.js';

const BASE = `name: Flow
initial_column: todo
columns:
  - id: todo
    label: Todo
    allowed_transitions: [done]
  - id: done
    label: Done
groups:
  - id: flow
    label: Flow
    columns: [todo, done]
connections:
  - from: todo
    to: done
    source: {side: right, at: 2}
`;

function change(mutate: (text: string) => string) {
  const before = parseWorkflow(BASE);
  const after = parseWorkflow(mutate(BASE));
  return diffWorkflow(before, after);
}

describe('workflow difference', () => {
  it('reports workflow and stage description changes', () => {
    const difference = change(text => text.replace('name: Flow', 'name: Flow\ndescription: Overall purpose').replace('label: Todo', 'label: Todo\n    description: Start here'));
    expect(difference.workflow).toContainEqual({ field: 'description', from: null, to: 'Overall purpose' });
    expect(difference.stages.find(stage => stage.stage === 'todo')?.fields).toContainEqual({ field: 'description', from: null, to: 'Start here' });
  });
  it('reports no difference for the same document', () => {
    expect(isWorkflowDifferenceEmpty(diffWorkflow(parseWorkflow(BASE), parseWorkflow(BASE)))).toBe(true);
  });

  it('ignores a comment-only edit', () => {
    const difference = change(text => '# a note\n' + text);
    expect(isWorkflowDifferenceEmpty(difference)).toBe(true);
  });

  it('reports a changed workflow name', () => {
    const difference = change(text => text.replace('name: Flow', 'name: Renamed'));
    expect(difference.workflow).toEqual([{ field: 'name', from: 'Flow', to: 'Renamed' }]);
  });

  it('reports a changed initial stage', () => {
    const difference = change(text => text.replace('initial_column: todo', 'initial_column: done'));
    expect(difference.workflow).toEqual([{ field: 'initialColumnId', from: 'todo', to: 'done' }]);
  });

  it('reports a changed transition list', () => {
    const difference = change(text => text.replace('allowed_transitions: [done]', 'allowed_transitions: []'));
    const stage = difference.stages.find(value => value.stage === 'todo');
    expect(stage?.change).toBe('changed');
    expect(stage?.fields?.map(field => field.field)).toEqual(['allowedTransitions']);
  });

  it('reports a changed entry instruction', () => {
    const difference = change(text => text.replace('label: Todo', 'label: Todo\n    on_enter_prompt: Do it.'));
    const stage = difference.stages.find(value => value.stage === 'todo');
    expect(stage?.fields).toEqual([{ field: 'onEnterPrompt', from: null, to: 'Do it.' }]);
  });

  it('reports a changed placement and size', () => {
    const difference = change(text => text.replace('label: Done', 'label: Done\n    position: {x: 10, y: 20}\n    size: {width: 300, height: 200}'));
    const stage = difference.stages.find(value => value.stage === 'done');
    expect(stage?.fields?.map(field => field.field)).toEqual(['position', 'size']);
  });

  it('reports a retargeted scripted exit', () => {
    const scripted = `columns:
  - id: wait
    label: Wait
    scripted:
      language: bash
      code: exit 0
      exits: {yes: done}
  - id: done
    label: Done
`;
    const retargeted = scripted.replace('exits: {yes: done}', 'exits: {yes: other}') + '  - id: other\n    label: Other\n';
    const difference = diffWorkflow(parseWorkflow(scripted), parseWorkflow(scripted.replace('exits: {yes: done}', 'exits: {yes: done2}') + '  - id: done2\n    label: Done 2\n'));
    expect(difference.stages.some(stage => stage.stage === 'wait' && stage.change === 'changed')).toBe(true);
    expect(isWorkflowDifferenceEmpty(diffWorkflow(parseWorkflow(scripted), parseWorkflow(retargeted)))).toBe(false);
  });

  it('reports an added and a removed stage', () => {
    const difference = change(text => text
      .replace('allowed_transitions: [done]', 'allowed_transitions: [review]')
      .replace('columns: [todo, done]', 'columns: [todo, review]')
      .replace('  - id: done\n    label: Done\n', '  - id: review\n    label: Review\n'));
    const changes = difference.stages.map(stage => [stage.stage, stage.change]);
    expect(changes).toContainEqual(['done', 'removed']);
    expect(changes).toContainEqual(['review', 'added']);
  });

  it('reports changed group membership', () => {
    const difference = change(text => text.replace('columns: [todo, done]', 'columns: [todo]'));
    expect(difference.groups).toEqual([{ group: 'flow', change: 'changed', fields: [{ field: 'columns', from: ['todo', 'done'], to: ['todo'] }] }]);
  });

  it('reports a set and a removed connection layout', () => {
    const moved = change(text => text.replace('{side: right, at: 2}', '{side: right, at: 3}'));
    expect(moved.connections).toEqual([{ from: 'todo', to: 'done', change: 'set' }]);
    const removed = change(text => text.replace('connections:\n  - from: todo\n    to: done\n    source: {side: right, at: 2}\n', ''));
    expect(removed.connections).toEqual([{ from: 'todo', to: 'done', change: 'removed' }]);
  });

  it('reads a document with no earlier version as added', () => {
    const difference = diffWorkflow(null, parseWorkflow(BASE));
    expect(difference.stages.map(stage => stage.change)).toEqual(['added', 'added']);
    expect(difference.connections).toEqual([{ from: 'todo', to: 'done', change: 'set' }]);
  });
});

describe('decision configuration differences', () => {
  const options = (body: string) => ['columns:', '  - id: gate', '    label: Gate', '    decision:', '      question: Proceed?', '      options:', body, '  - id: done', '    label: Done', ''].join(String.fromCharCode(10));
  const approve = ['        - id: approve', '          title: Approve', '          to: done'].join(String.fromCharCode(10));
  const fix = ['        - id: fix', '          title: Fix', '          to: done'].join(String.fromCharCode(10));
  const gated = (question: string) => parseWorkflow(['columns:', '  - id: gate', '    label: Gate', '    decision:', '      question: ' + question, '      options:', approve, '  - id: done', '    label: Done', ''].join(String.fromCharCode(10)));

  it('names a changed question instead of the whole configuration', () => {
    const diff = diffWorkflow(gated('Proceed?'), gated('Continue?'));
    const fields = diff.stages[0]?.fields ?? [];
    expect(fields.map(field => field.field)).toEqual(['decision.question']);
    expect(isWorkflowDifferenceEmpty(diff)).toBe(false);
    expect(isWorkflowDifferenceEmpty(diffWorkflow(gated('Proceed?'), gated('Proceed?')))).toBe(true);
  });

  it('names added, changed, and removed options by identity', () => {
    const base = options(approve);
    const added = diffWorkflow(parseWorkflow(base), parseWorkflow(options([approve, fix].join(String.fromCharCode(10)))));
    const addedFields = added.stages[0]?.fields ?? [];
    expect(addedFields.some(field => field.field === 'decision.options')).toBe(true);
    expect(addedFields).toContainEqual({ field: 'decision.option:fix', from: null, to: { id: 'fix', title: 'Fix', description: null, to: 'done' } });

    const changed = diffWorkflow(parseWorkflow(base), parseWorkflow(options(approve.replace('title: Approve', 'title: Approve now'))));
    const changedFields = changed.stages[0]?.fields ?? [];
    expect(changedFields.map(field => field.field)).toEqual(['decision.option:approve']);
    expect(changedFields[0]).toMatchObject({ from: { title: 'Approve' }, to: { title: 'Approve now' } });

    const removed = diffWorkflow(parseWorkflow(options([approve, fix].join(String.fromCharCode(10)))), parseWorkflow(base));
    const removedFields = removed.stages[0]?.fields ?? [];
    expect(removedFields).toContainEqual({ field: 'decision.option:fix', from: { id: 'fix', title: 'Fix', description: null, to: 'done' }, to: null });
  });

  it('summarizes the changed field names without authored text', () => {
    const summary = summarizeDifference(diffWorkflow(gated('Proceed?'), gated('Continue?')));
    expect(summary.stages).toEqual([{ stage: 'gate', change: 'changed', fields: ['decision.question'] }]);
    expect(JSON.stringify(summary)).not.toContain('Proceed?');
    expect(JSON.stringify(summary)).not.toContain('Continue?');
  });
});
