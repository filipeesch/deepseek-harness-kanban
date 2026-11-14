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

  it('reports a plain mention of a stage as an observation, not a routing defect', () => {
    const value = warnings('initial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n    allowed_transitions: [review]\n    on_enter_prompt: Send it to done when the checks are green.\n  - id: review\n    label: Review\n  - id: done\n    label: Done\n');
    expect(value).toContainEqual({ kind: 'instruction-mentions-stage', stage: 'todo', reference: 'done' });
    expect(value.some(warning => warning.kind === 'instruction-names-unpermitted-stage')).toBe(false);
  });

  it('treats a defined stage after a citing phrase as a citation', () => {
    const value = warnings('initial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n    allowed_transitions: [review]\n    on_enter_prompt: Then declare done when ready.\n  - id: review\n    label: Review\n  - id: done\n    label: Done\n');
    expect(value).toContainEqual({ kind: 'instruction-names-unpermitted-stage', stage: 'todo', reference: 'done' });
    expect(value.some((warning: any) => warning.kind === 'instruction-mentions-stage' && warning.reference === 'done')).toBe(false);
  });

  it('does not treat a prose word after a citing phrase as a citation', () => {
    const value = warnings('initial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n    allowed_transitions: [done]\n    on_enter_prompt: Route to the review queue, then go to nothing.\n  - id: done\n    label: Done\n');
    expect(value.some(warning => warning.kind === 'instruction-names-unknown-stage')).toBe(false);
    expect(value.filter(warning => warning.kind === 'instruction-mentions-stage').map((warning: any) => warning.reference)).toEqual(['the', 'nothing']);
  });

  it('groups a repeated citation with the number of occurrences', () => {
    const value = warnings('initial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n    allowed_transitions: [review]\n    on_enter_prompt: Declare done now. Then declare done again.\n  - id: review\n    label: Review\n  - id: done\n    label: Done\n');
    expect(value.filter((warning: any) => warning.kind === 'instruction-names-unpermitted-stage')).toEqual([{ kind: 'instruction-names-unpermitted-stage', stage: 'todo', reference: 'done', count: 2 }]);
  });

  it('groups a repeated prose observation with the number of occurrences', () => {
    const value = warnings('initial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n    allowed_transitions: [done]\n    on_enter_prompt: Route to the queue. Then go to the queue again.\n  - id: done\n    label: Done\n');
    expect(value.filter((warning: any) => warning.kind === 'instruction-mentions-stage')).toEqual([{ kind: 'instruction-mentions-stage', stage: 'todo', reference: 'the', count: 2 }]);
  });

  it('reports a destination parameter the origin instruction never names', () => {
    const value = warnings('initial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n    allowed_transitions: [check]\n    on_enter_prompt: Send it on with the pipeline name.\n  - id: check\n    label: Check\n    deterministic:\n      language: bash\n      code: echo hi\n      params:\n        - name: pipeline\n        - name: app\n      exits: {passed: done}\n  - id: done\n    label: Done\n');
    expect(value).toContainEqual({ kind: 'destination-parameter-unmentioned', stage: 'todo', destination: 'check', parameter: 'app' });
    expect(value.some((warning: any) => warning.parameter === 'pipeline')).toBe(false);
  });

  it('reports a card without the values its stage declares', () => {
    const workflow = parseWorkflow('initial_column: check\ncolumns:\n  - id: check\n    label: Check\n    deterministic:\n      language: bash\n      code: echo hi\n      params:\n        - name: pipeline\n      exits: {passed: done}\n  - id: done\n    label: Done\n');
    const value = workflowWarnings(workflow, [{ id: 'task-1', columnId: 'check', parameters: [] }, { id: 'task-2', columnId: 'check', parameters: ['pipeline'] }]);
    // The observation carries identifiers and declared names, never an entry's value.
    expect(value).toContainEqual({ kind: 'card-missing-parameters', stage: 'check', taskId: 'task-1', parameters: ['pipeline'] });
    expect(Object.keys(value.find((warning: any) => warning.taskId === 'task-1')!).sort()).toEqual(['kind', 'parameters', 'stage', 'taskId']);
    expect(value.some((warning: any) => warning.taskId === 'task-2')).toBe(false);
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
