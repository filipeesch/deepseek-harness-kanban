import { describe, expect, it } from 'vitest';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { writeTransitionCondition } from '../../src/domain/transition-write.js';

const AUTHORED = [
  '# Authored by hand.',
  'name: Delivery',
  'initial_column: plan',
  'columns:',
  '  - id: plan',
  '    label: Plan',
  '    allowed_transitions:',
  '      # Shipments follow the review.',
  '      - to: review',
  '        when: the plan is ready',
  '      - to: backlog',
  '  - id: review',
  '    label: Review',
  '  - id: backlog',
  '    label: Backlog',
  '  - id: done',
  '    label: Done',
  '    allowed_transitions: []',
  '',
].join('\n');

function rules(text: string, id: string) {
  return parseWorkflow(text).columns.find(column => column.id === id)?.allowedTransitions;
}

describe('transition condition write', () => {
  it('changes one condition and keeps every authored character around it', () => {
    const text = writeTransitionCondition({ text: AUTHORED, stageId: 'plan', to: 'review', when: 'the review is requested' });
    expect(rules(text, 'plan')).toEqual([{ to: 'review', when: 'the review is requested' }, { to: 'backlog' }]);
    expect(text).toContain('# Authored by hand.');
    expect(text).toContain('      # Shipments follow the review.');
    expect(text).toContain('- to: backlog');
  });

  it('adds a condition to a destination that had none', () => {
    const text = writeTransitionCondition({ text: AUTHORED, stageId: 'plan', to: 'backlog', when: 'the plan is parked' });
    expect(rules(text, 'plan')).toEqual([{ to: 'review', when: 'the plan is ready' }, { to: 'backlog', when: 'the plan is parked' }]);
    expect(text).toContain('      # Shipments follow the review.');
  });

  it('removes the condition and keeps the destination', () => {
    const text = writeTransitionCondition({ text: AUTHORED, stageId: 'plan', to: 'review', when: null });
    expect(rules(text, 'plan')).toEqual([{ to: 'review' }, { to: 'backlog' }]);
    expect(text).toContain('      # Shipments follow the review.');
    expect(text).not.toContain('the plan is ready');
  });

  it('treats a blank condition as no condition', () => {
    const text = writeTransitionCondition({ text: AUTHORED, stageId: 'plan', to: 'review', when: '   ' });
    expect(rules(text, 'plan')).toEqual([{ to: 'review' }, { to: 'backlog' }]);
  });

  it('appends a destination the stage does not author yet', () => {
    const text = writeTransitionCondition({ text: AUTHORED, stageId: 'plan', to: 'done', when: 'work is cancelled' });
    expect(rules(text, 'plan')).toEqual([
      { to: 'review', when: 'the plan is ready' },
      { to: 'backlog' },
      { to: 'done', when: 'work is cancelled' },
    ]);
    expect(text).toContain('      # Shipments follow the review.');
  });

  it('authors the only destination of a stage that authored none', () => {
    const text = writeTransitionCondition({ text: AUTHORED, stageId: 'review', to: 'done', when: 'the review passed' });
    expect(rules(text, 'review')).toEqual([{ to: 'done', when: 'the review passed' }]);
    expect(rules(text, 'plan')).toEqual([{ to: 'review', when: 'the plan is ready' }, { to: 'backlog' }]);
  });

  it('replaces an empty list with the destination it is given', () => {
    const text = writeTransitionCondition({ text: AUTHORED, stageId: 'done', to: 'plan', when: 'reopened' });
    expect(rules(text, 'done')).toEqual([{ to: 'plan', when: 'reopened' }]);
    expect(rules(text, 'plan')).toHaveLength(2);
  });

  it('keeps a flow list flow', () => {
    const flow = 'columns: [{id: todo, label: Todo}, {id: done, label: Done}]' + String.fromCharCode(10);
    const conditioned = writeTransitionCondition({ text: flow, stageId: 'todo', to: 'done', when: 'finished' });
    expect(rules(conditioned, 'todo')).toEqual([{ to: 'done', when: 'finished' }]);
    const updated = writeTransitionCondition({ text: conditioned, stageId: 'todo', to: 'done', when: 'shipped' });
    expect(rules(updated, 'todo')).toEqual([{ to: 'done', when: 'shipped' }]);
    const cleared = writeTransitionCondition({ text: updated, stageId: 'todo', to: 'done', when: null });
    expect(rules(cleared, 'todo')).toEqual([{ to: 'done' }]);
    const appended = writeTransitionCondition({ text: cleared, stageId: 'todo', to: 'done', when: 'again' });
    expect(rules(appended, 'todo')).toEqual([{ to: 'done', when: 'again' }]);
  });

  it('leaves the document untouched when the condition it writes is already authored', () => {
    const text = writeTransitionCondition({ text: AUTHORED, stageId: 'plan', to: 'review', when: '  the plan is ready  ' });
    expect(text).toBe(AUTHORED);
  });

  it('rejects a self destination and a stage the workflow does not hold', () => {
    expect(() => writeTransitionCondition({ text: AUTHORED, stageId: 'plan', to: 'plan', when: 'x' })).toThrow(/own transition target/);
    expect(() => writeTransitionCondition({ text: AUTHORED, stageId: 'ghost', to: 'plan', when: 'x' })).toThrow(/does not exist/);
  });

  it('authors the named destination even when the stage set is the caller\'s to validate', () => {
    // The writer owns text, not the workflow: the host rejects a destination that is
    // not a stage of the board, and this writer's job is to splice what it is given.
    const text = writeTransitionCondition({ text: AUTHORED, stageId: 'plan', to: 'ghost', when: 'x' });
    expect(text).toContain('- to: ghost');
    expect(text).toContain('when: x');
    // The document is still authorable for the parser, which is what rejects the
    // destination once the host stores it.
    expect(() => parseWorkflow(text)).toThrow(/unknown transition target/);
  });
});

describe('transition condition write, authored forms', () => {
  it('promotes a bare flow destination instead of authoring it twice', () => {
    const text = 'columns: [{id: a, label: A, allowed_transitions: [b]}, {id: b, label: B}]' + String.fromCharCode(10);
    const written = writeTransitionCondition({ text, stageId: 'a', to: 'b', when: 'ready' });
    expect(rules(written, 'a')).toEqual([{ to: 'b', when: 'ready' }]);
    expect(written).toContain('[{to: b, when: ready}]');
  });

  it('promotes a bare block destination instead of authoring it twice', () => {
    const text = ['columns:', '  - id: a', '    label: A', '    allowed_transitions:', '      - b', '  - id: b', '    label: B', ''].join(String.fromCharCode(10));
    const written = writeTransitionCondition({ text, stageId: 'a', to: 'b', when: 'ready' });
    expect(rules(written, 'a')).toEqual([{ to: 'b', when: 'ready' }]);
    expect(written).toContain('      - {to: b, when: ready}');
  });

  it('leaves a bare destination alone when the condition is cleared', () => {
    const text = ['columns:', '  - id: a', '    label: A', '    allowed_transitions:', '      - b', '  - id: b', '    label: B', ''].join(String.fromCharCode(10));
    expect(writeTransitionCondition({ text, stageId: 'a', to: 'b', when: null })).toBe(text);
  });

  it('replaces a multiline block scalar condition without leaving its body behind', () => {
    const text = [
      'columns:',
      '  - id: a',
      '    label: A',
      '    allowed_transitions:',
      '      - to: b',
      '        when: |-',
      '          first line',
      '          second line',
      '      - to: c',
      '  - id: b',
      '    label: B',
      '  - id: c',
      '    label: C',
      '',
    ].join(String.fromCharCode(10));
    const written = writeTransitionCondition({ text, stageId: 'a', to: 'b', when: 'updated' });
    expect(rules(written, 'a')).toEqual([{ to: 'b', when: 'updated' }, { to: 'c' }]);
    expect(written).not.toContain('first line');
    expect(written).not.toContain('second line');
  });

  it('writes a multiline condition as a quoted scalar', () => {
    const text = ['columns:', '  - id: a', '    label: A', '    allowed_transitions:', '      - to: b', '  - id: b', '    label: B', ''].join(String.fromCharCode(10));
    const written = writeTransitionCondition({ text, stageId: 'a', to: 'b', when: 'first' + String.fromCharCode(10) + 'second' });
    expect(rules(written, 'a')).toEqual([{ to: 'b', when: 'first\nsecond' }]);
  });

  it('keeps the comment beside a destination on its own line', () => {
    const text = ['columns:', '  - id: a', '    label: A', '    allowed_transitions:', '      - to: b # target comment', '  - id: b', '    label: B', ''].join(String.fromCharCode(10));
    const written = writeTransitionCondition({ text, stageId: 'a', to: 'b', when: 'ready' });
    expect(rules(written, 'a')).toEqual([{ to: 'b', when: 'ready' }]);
    expect(written).toContain('- to: b # target comment');
  });

  it('does not add a second comma to a flow map that ends with one', () => {
    const text = 'columns: [{id: a, label: A,}, {id: b, label: B}]' + String.fromCharCode(10);
    const written = writeTransitionCondition({ text, stageId: 'a', to: 'b', when: 'ready' });
    expect(rules(written, 'a')).toEqual([{ to: 'b', when: 'ready' }]);
  });

  it('does not add a second comma to a flow list that ends with one', () => {
    const text = ['columns: [{id: a, label: A, allowed_transitions: [{to: b},]}, {id: b, label: B}, {id: c, label: C}]', ''].join(String.fromCharCode(10));
    const written = writeTransitionCondition({ text, stageId: 'a', to: 'c', when: 'ready' });
    expect(rules(written, 'a')).toEqual([{ to: 'b' }, { to: 'c', when: 'ready' }]);
  });
});

describe('transition condition write, authored quirks', () => {
  it('keeps a comment that follows the condition it replaces', () => {
    const text = ['columns:', '  - id: a', '    label: A', '    allowed_transitions:', '      - to: b', '        when: old # important note', '  - id: b', '    label: B', ''].join(String.fromCharCode(10));
    const written = writeTransitionCondition({ text, stageId: 'a', to: 'b', when: 'new' });
    expect(rules(written, 'a')).toEqual([{ to: 'b', when: 'new' }]);
    expect(written).toContain('# important note');
  });

  it('removes a condition that opens its sequence entry and keeps the entry', () => {
    const text = ['columns:', '  - id: a', '    label: A', '    allowed_transitions:', '      - when: old', '        to: b', '  - id: b', '    label: B', ''].join(String.fromCharCode(10));
    const written = writeTransitionCondition({ text, stageId: 'a', to: 'b', when: null });
    expect(rules(written, 'a')).toEqual([{ to: 'b' }]);
    expect(written).not.toContain('when: old');
  });
});
