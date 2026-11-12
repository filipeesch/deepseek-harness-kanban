import { describe, expect, it } from 'vitest';
import { workflowWarnings } from '../../src/domain/workflow-warnings.js';
import { parseWorkflow } from '../../src/domain/workflow.js';

function warnings(yaml: string) {
  return workflowWarnings(parseWorkflow(yaml));
}

describe('workflow warnings', () => {
  it('reports no warning for a well-formed flow', () => {
    expect(warnings('initial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n    allowed_transitions: [done]\n  - id: done\n    label: Done\n')).toEqual([]);
  });

  it('reports a stage the initial stage never reaches', () => {
    const value = warnings('initial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n    allowed_transitions: [done]\n  - id: done\n    label: Done\n    allowed_transitions: []\n  - id: extra\n    label: Extra\n');
    expect(value).toContainEqual({ kind: 'unreachable-stage', stage: 'extra' });
  });

  it('reports a stage that is not terminal and leaves nowhere to go', () => {
    const value = warnings('initial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n    allowed_transitions: []\n  - id: done\n    label: Done\n');
    expect(value).toContainEqual({ kind: 'stage-without-route', stage: 'todo' });
  });

  it('does not report the last stage for leaving nowhere to go', () => {
    const value = warnings('initial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n    allowed_transitions: [done]\n  - id: done\n    label: Done\n');
    expect(value.some(warning => warning.kind === 'stage-without-route')).toBe(false);
  });

  it('reports a connection layout the diagram does not draw', () => {
    const value = warnings('initial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n    allowed_transitions: [done]\n  - id: done\n    label: Done\nconnections:\n  - from: done\n    to: todo\n    source: {side: right, at: 2}\n');
    expect(value).toContainEqual({ kind: 'undrawn-connection', from: 'done', to: 'todo' });
  });

  it('reports a stage no group claims', () => {
    const value = warnings('initial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n    allowed_transitions: [done]\n  - id: done\n    label: Done\ngroups:\n  - id: first\n    label: First\n    columns: [todo]\n');
    expect(value).toContainEqual({ kind: 'stage-outside-group', stage: 'done' });
  });

  it('reports an instruction that cites a stage the workflow does not define', () => {
    const value = warnings('initial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n    allowed_transitions: [done]\n    on_enter_prompt: When the work is done, declare `ghost` and stop.\n  - id: done\n    label: Done\n');
    expect(value).toContainEqual({ kind: 'instruction-names-unknown-stage', stage: 'todo', reference: 'ghost' });
  });

  it('reports an instruction that cites a stage the stage does not permit', () => {
    const value = warnings('initial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n    allowed_transitions: [review]\n    on_enter_prompt: Then declare `done` when it is ready.\n  - id: review\n    label: Review\n  - id: done\n    label: Done\n');
    expect(value).toContainEqual({ kind: 'instruction-names-unpermitted-stage', stage: 'todo', reference: 'done' });
  });

  it('reports a plain mention of a stage the stage does not permit', () => {
    const value = warnings('initial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n    allowed_transitions: [review]\n    on_enter_prompt: Send it to done when the checks are green.\n  - id: review\n    label: Review\n  - id: done\n    label: Done\n');
    expect(value).toContainEqual({ kind: 'instruction-names-unpermitted-stage', stage: 'todo', reference: 'done' });
  });

  it('permits any destination when the stage authors no restriction', () => {
    const value = warnings('initial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n    on_enter_prompt: Send it to done when the checks are green.\n  - id: done\n    label: Done\n');
    expect(value).toEqual([]);
  });

  it('does not report the stage its own instruction names', () => {
    const value = warnings('initial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n    allowed_transitions: [done]\n    on_enter_prompt: Keep todo tidy.\n  - id: done\n    label: Done\n');
    expect(value.some(warning => warning.kind === 'instruction-names-unpermitted-stage')).toBe(false);
  });
});
