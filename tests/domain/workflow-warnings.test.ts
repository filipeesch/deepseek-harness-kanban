import { describe, expect, it } from 'vitest';
import { DESCRIPTION_CEILING, workflowWarnings } from '../../src/domain/workflow-warnings.js';
import { composeWorkflowReport, reviewWorkflowText } from '../../src/domain/workflow-report.js';
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
    const value = warnings('initial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n    allowed_transitions: [check]\n    on_enter_prompt: Send it on with the pipeline name.\n  - id: check\n    label: Check\n    scripted:\n      language: bash\n      code: echo hi\n      params:\n        - name: pipeline\n        - name: app\n      exits: {passed: done}\n  - id: done\n    label: Done\n');
    expect(value).toContainEqual({ kind: 'destination-parameter-unmentioned', stage: 'todo', destination: 'check', parameter: 'app' });
    expect(value.some((warning: any) => warning.parameter === 'pipeline')).toBe(false);
  });

  it('reports a parameter a program reads without declaring it', () => {
    const value = warnings("initial_column: check\ncolumns:\n  - id: check\n    label: Check\n    scripted:\n      language: typescript\n      code: 'const app = input.params.app; return input.params.pipeline;'\n      params:\n        - name: app\n      exits: {passed: done}\n  - id: done\n    label: Done\n");
    expect(value).toContainEqual({ kind: 'scripted-parameter-undeclared', stage: 'check', parameter: 'pipeline' });
    expect(value.some((warning: any) => warning.parameter === 'app')).toBe(false);
  });

  it('reports a parameter a program destructures without declaring it', () => {
    const value = warnings("initial_column: check\ncolumns:\n  - id: check\n    label: Check\n    scripted:\n      language: typescript\n      code: 'const { pipeline, app: renamed = \"ci\" } = input.params;'\n      params:\n        - name: app\n      exits: {passed: done}\n  - id: done\n    label: Done\n");
    expect(value).toContainEqual({ kind: 'scripted-parameter-undeclared', stage: 'check', parameter: 'pipeline' });
    expect(value.some((warning: any) => warning.parameter === 'app')).toBe(false);
  });

  it('does not read a Bash program body as a parameter access', () => {
    const value = warnings("initial_column: check\ncolumns:\n  - id: check\n    label: Check\n    scripted:\n      language: bash\n      code: echo 'params.pipeline' | jq .\n      params: []\n      exits: {passed: done}\n  - id: done\n    label: Done\n");
    expect(value.some((warning: any) => warning.kind === 'scripted-parameter-undeclared')).toBe(false);
  });

  it('groups a repeated undeclared parameter read', () => {
    const value = warnings("initial_column: check\ncolumns:\n  - id: check\n    label: Check\n    scripted:\n      language: typescript\n      code: 'input.params.pipeline; input.params.pipeline;'\n      params: []\n      exits: {passed: done}\n  - id: done\n    label: Done\n");
    expect(value.filter((warning: any) => warning.kind === 'scripted-parameter-undeclared')).toEqual([{ kind: 'scripted-parameter-undeclared', stage: 'check', parameter: 'pipeline', count: 2 }]);
  });

  it('does not guess about a program held in an external file', () => {
    const value = warnings("initial_column: check\ncolumns:\n  - id: check\n    label: Check\n    scripted:\n      language: typescript\n      file: wait.ts\n      params:\n        - name: app\n      exits: {passed: done}\n  - id: done\n    label: Done\n");
    expect(value.some((warning: any) => warning.kind === 'scripted-parameter-undeclared')).toBe(false);
  });

  it('reports a card without the values its stage declares', () => {
    const workflow = parseWorkflow('initial_column: check\ncolumns:\n  - id: check\n    label: Check\n    scripted:\n      language: bash\n      code: echo hi\n      params:\n        - name: pipeline\n      exits: {passed: done}\n  - id: done\n    label: Done\n');
    const value = workflowWarnings(workflow, [{ id: 'task-1', columnId: 'check', parameters: [] }, { id: 'task-2', columnId: 'check', parameters: ['pipeline'] }]);
    // The observation carries identifiers and declared names, never an entry's value.
    expect(value).toContainEqual({ kind: 'card-missing-parameters', stage: 'check', taskId: 'task-1', parameters: ['pipeline'] });
    expect(Object.keys(value.find((warning: any) => warning.taskId === 'task-1')!).sort()).toEqual(['kind', 'parameters', 'stage', 'taskId']);
    expect(value.some((warning: any) => warning.taskId === 'task-2')).toBe(false);
  });

  it('permits any destination when the stage authors no restriction', () => {
    const value = warnings('initial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n    description: Owns the todo work.\n    on_enter_prompt: Send it to done when the checks are green.\n  - id: done\n    label: Done\n');
    expect(value).toEqual([]);
  });

  it('does not report the stage its own instruction names', () => {
    const value = warnings('initial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n    allowed_transitions: [done]\n    on_enter_prompt: Keep todo tidy.\n  - id: done\n    label: Done\n');
    expect(value.some(warning => warning.kind === 'instruction-names-unpermitted-stage')).toBe(false);
  });
});

const CONTRACT_KINDS = ['description-over-ceiling', 'destination-without-condition', 'stage-without-description'];
const contract = (yaml: string) => warnings(yaml).filter(warning => CONTRACT_KINDS.includes(warning.kind));
const flow = (todo: string) => 'initial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n' + todo + '  - id: done\n    label: Done\n';

describe('stage-contract observations', () => {
  it('states the ceiling the architect is guided to', () => {
    expect(DESCRIPTION_CEILING).toBe(300);
  });

  it('observes a stage description over the ceiling and names the stage', () => {
    const value = contract(flow('    description: ' + 'a'.repeat(DESCRIPTION_CEILING + 1) + '\n'));
    expect(value).toEqual([{ kind: 'description-over-ceiling', stage: 'todo', length: DESCRIPTION_CEILING + 1 }]);
  });

  it('does not observe a description exactly at the ceiling', () => {
    expect(contract(flow('    description: ' + 'a'.repeat(DESCRIPTION_CEILING) + '\n'))).toEqual([]);
  });

  it('observes the workflow description over the ceiling without naming a stage', () => {
    const value = contract('description: ' + 'a'.repeat(DESCRIPTION_CEILING + 1) + '\n' + flow(''));
    expect(value).toEqual([{ kind: 'description-over-ceiling', length: DESCRIPTION_CEILING + 1 }]);
  });

  it('observes each destination without a condition when a stage authors two or more', () => {
    const value = contract(flow('    allowed_transitions:\n      - to: done\n        when: The work is finished.\n      - to: todo\n      - done2\n').replace('  - id: done\n', '  - id: done2\n    label: Done 2\n  - id: done\n'));
    expect(value).toEqual([{ kind: 'destination-without-condition', stage: 'todo', destination: 'done2' }]);
  });

  it('does not observe a stage with one destination, or whose destinations all carry a condition', () => {
    expect(contract(flow('    allowed_transitions: [done]\n'))).toEqual([]);
    expect(contract(flow('    allowed_transitions:\n      - to: done\n        when: Finished.\n      - to: todo\n        when: Not finished.\n'))).toEqual([]);
  });

  it('observes a stage with an entry instruction and a scripted stage that have no description', () => {
    const instructed = contract(flow('    on_enter_prompt: Do the work.\n'));
    expect(instructed).toEqual([{ kind: 'stage-without-description', stage: 'todo' }]);
    const scripted = contract(flow('    scripted:\n      language: bash\n      code: echo hi\n      exits: {passed: done}\n'));
    expect(scripted).toEqual([{ kind: 'stage-without-description', stage: 'todo' }]);
  });

  it('does not observe a described stage, a blank description counts as none', () => {
    expect(contract(flow('    description: Owns the work.\n    on_enter_prompt: Do the work.\n'))).toEqual([]);
    expect(contract(flow('    description: "  "\n    on_enter_prompt: Do the work.\n'))).toEqual([{ kind: 'stage-without-description', stage: 'todo' }]);
  });

  it('does not observe a decision stage, a stage with neither script nor instruction, or the exits of a scripted stage', () => {
    const decision = flow('    decision:\n      question: Go?\n      options:\n        - id: go\n          title: Go\n          to: done\n        - id: stay\n          title: Stay\n          to: done\n');
    expect(contract(decision)).toEqual([]);
    expect(contract(flow(''))).toEqual([]);
    const scripted = flow('    description: Runs the check.\n    scripted:\n      language: bash\n      code: echo hi\n      exits: {passed: done, failed: done}\n');
    expect(contract(scripted)).toEqual([]);
  });

  it('does not count a self target as a destination', () => {
    expect(contract(flow('    allowed_transitions: [todo, done]\n'))).toEqual([]);
  });

  it('reaches the write report as observations that neither invalidate nor block it', () => {
    const review = reviewWorkflowText({ text: flow('    on_enter_prompt: Do the work.\n'), previousText: null });
    expect(review.valid).toBe(true);
    const report = composeWorkflowReport(review);
    expect(report.valid).toBe(true);
    expect(report.warnings).toContainEqual({ kind: 'stage-without-description', stage: 'todo' });
    expect(report.warningsOmitted).toBe(0);
  });
});
