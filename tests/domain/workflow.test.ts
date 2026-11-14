import { describe, expect, it } from 'vitest';
import { DEFAULT_WORKFLOW_YAML, parseWorkflow } from '../../src/domain/workflow.js';
import { canTransition } from '../../src/domain/transitions.js';
import { canonicalWorkflow, workflowMeaning } from '../../src/domain/schema-parts.js';

const minimal = 'columns:\n  - id: todo\n    label: To do\n  - id: done\n    label: Done\n';

describe('workflow configuration', () => {
  it('seeds the five ordered stages without automatic instructions or WIP', () => {
    const result = parseWorkflow(DEFAULT_WORKFLOW_YAML);
    expect(result.columns.map(column => column.name)).toEqual(['Backlog', 'Plan', 'In Progress', 'In Review', 'Done']);
    expect(result.initialColumnId).toBe('backlog');
    expect(result.columns.every(column => column.onEnterPrompt === undefined && column.allowedTransitions === undefined)).toBe(true);
    expect(result.groups).toEqual([]);
  });

  it('normalizes groups, a configured initial stage, prompts, and explicit transitions', () => {
    const result = parseWorkflow('name: Custom\ninitial_column: doing\ncolumns:\n  - id: todo\n    label: Backlog\n    allowed_transitions: [doing]\n  - id: doing\n    name: Active\n    on_enter_prompt: |\n      Implement the task.\n    allowed_transitions: []\ngroups:\n  - label: Delivery\n    columns: [todo, doing]\n');
    expect(result.initialColumnId).toBe('doing');
    expect(result.groups).toEqual([{ id: 'group-1', name: 'Delivery', columnIds: ['todo', 'doing'] }]);
    expect(result.columns[1]?.onEnterPrompt).toBe('Implement the task.\n');
    expect(canTransition(result, 'todo', 'doing')).toBe(true);
    expect(canTransition(result, 'doing', 'todo')).toBe(false);
  });

  it('accepts bare, conditioned, and mixed transition entries with one meaning', () => {
    const result = parseWorkflow([
      'columns:',
      '  - id: review',
      '    label: Review',
      '    allowed_transitions:',
      '      - done',
      '      - to: rework',
      '        when: The review requested changes.',
      '      - to: blocked',
      '        when: "   "',
      '  - id: done',
      '    label: Done',
      '  - id: rework',
      '    label: Rework',
      '  - id: blocked',
      '    label: Blocked',
      '',
    ].join(String.fromCharCode(10)));
    expect(result.columns[0]?.allowedTransitions).toEqual([
      { to: 'done' },
      { to: 'rework', when: 'The review requested changes.' },
      { to: 'blocked' },
    ]);
    expect(canTransition(result, 'review', 'done')).toBe(true);
    expect(canTransition(result, 'review', 'rework')).toBe(true);
  });

  it('accepts the default presentation and authored stage positions', () => {
    const result = parseWorkflow('default_view: workflow\ncolumns:\n  - id: todo\n    label: To do\n    position: {x: 40, y: 120}\n  - id: done\n    label: Done\n');
    expect(result.defaultView).toBe('workflow');
    expect(result.columns[0]?.position).toEqual({ x: 40, y: 120 });
    expect(result.columns[1]?.position).toBeUndefined();
  });

  it('accepts authored stage sizes and leaves an absent one to the minimum', () => {
    const result = parseWorkflow('columns:\n  - id: todo\n    label: To do\n    size: {width: 400, height: 300}\n  - id: done\n    label: Done\n');
    expect(result.columns[0]?.size).toEqual({ width: 400, height: 300 });
    expect(result.columns[1]?.size).toBeUndefined();
  });

  it('keeps an explicit board default and omits an absent one', () => {
    expect(parseWorkflow('default_view: board\n' + minimal).defaultView).toBe('board');
    expect(parseWorkflow(minimal).defaultView).toBeUndefined();
  });

  it('defaults an omitted initial column to the first configured stage, not backlog', () => {
    expect(parseWorkflow(minimal).initialColumnId).toBe('todo');
  });

  it('accepts source-style IDs and cosmetic descriptions without engine semantics', () => {
    const result = parseWorkflow('id: delivery\nname: Delivery\ncolumns:\n  - id: one\n    label: One\n    description: Only a caption\n');
    expect(result).toEqual({ name: 'Delivery', initialColumnId: 'one', columns: [{ id: 'one', name: 'One' }], groups: [] });
  });

  it('treats blank or null entry instructions as disabled', () => {
    const result = parseWorkflow('columns:\n  - id: one\n    label: One\n    on_enter_prompt: null\n  - id: two\n    label: Two\n    on_enter_prompt: "  "\n');
    expect(result.columns.every(column => column.onEnterPrompt === undefined)).toBe(true);
  });

  it('permits ordinary moves when restrictions are omitted, but not unknown or same-stage requests', () => {
    const result = parseWorkflow(minimal);
    expect(canTransition(result, 'todo', 'done')).toBe(true);
    expect(canTransition(result, 'done', 'todo')).toBe(true);
    expect(canTransition(result, 'todo', 'todo')).toBe(false);
    expect(canTransition(result, 'missing', 'done')).toBe(false);
    expect(canTransition(result, 'todo', 'missing')).toBe(false);
  });

  it.each([
    '', 'null', '[]', 'name: Empty', 'columns: []', 'columns: invalid',
    'columns: [{id: one, label: One}, {id: one, label: Duplicate}]',
    'columns: [{id: "../escape", label: Invalid}]',
    'columns: [{id: constructor, label: Invalid}]',
    'columns: [{id: one}]',
    'columns: [{id: one, label: One, name: Other}]',
    'columns: [{id: one, label: One, allowed_transitions: [missing]}]',
    'columns: [{id: one, label: One, allowed_transitions: [one, one]}]',
    'columns: [{id: one, label: One, allowed_transitions: null}]',
    'columns: [{id: one, label: One, allowed_transitions: [{when: Only a condition}]}]',
    'columns: [{id: one, label: One, allowed_transitions: [{to: missing}]}]',
    'columns: [{id: one, label: One, allowed_transitions: [{to: one, when: 3}]}]',
    'columns: [{id: one, label: One, allowed_transitions: [{to: one, extra: text}]}]',
    'columns: [{id: one, label: One, allowed_transitions: [one, {to: one}]}]',
    'columns: [{id: one, label: One, on_enter_prompt: 3}]',
    'default_view: maybe\n' + minimal,
    'columns: [{id: one, label: One, position: 3}]',
    'columns: [{id: one, label: One, position: {x: 1}}]',
    'columns: [{id: one, label: One, position: {x: \"1\", y: 2}}]',
    'columns: [{id: one, label: One, position: {x: 1, y: 2, z: 3}}]',
    'columns: [{id: one, label: One, position: {x: .inf, y: 2}}]',
    'columns: [{id: one, label: One, size: 3}]',
    'columns: [{id: one, label: One, size: {width: 264}}]',
    'columns: [{id: one, label: One, size: {width: "264", height: 140}}]',
    'columns: [{id: one, label: One, size: {width: 263, height: 140}}]',
    'columns: [{id: one, label: One, size: {width: 264, height: 139}}]',
    'columns: [{id: one, label: One, size: {width: 264, height: 140, depth: 1}}]',
    'columns: [{id: one, label: One, size: {width: .inf, height: 140}}]',
    'columns: [{id: one, label: One, size: {width: 10001, height: 140}}]',
    'columns: [{id: one, label: One, limit: 2}]',
    'columns: [{id: one, label: One, tools: [shell]}]',
    'columns: [{id: one, label: One, stage_instructions: Execute}]',
    'name: Workflow\nname: Duplicate\n' + minimal,
    'workflow_instructions: Legacy engine instructions\n' + minimal,
    'engine: custom\n' + minimal,
    'initial_column: missing\n' + minimal,
    minimal + 'groups: [{label: Empty, columns: []}]',
    minimal + 'groups: [{label: Unknown, columns: [missing]}]',
    minimal + 'groups: [{label: A, columns: [todo]}, {label: B, columns: [todo]}]',
    minimal + 'groups: [{id: duplicate, label: A, columns: [todo]}, {id: duplicate, label: B, columns: [done]}]',
    minimal + 'groups: [{id: done, label: Collision, columns: [todo]}]',
    minimal + 'groups: invalid',
    minimal + '\n---\n' + minimal,
    '__proto__: {polluted: true}\n' + minimal,
  ])('rejects malformed or unsupported configuration %#', yaml => {
    expect(() => parseWorkflow(yaml)).toThrow(expect.objectContaining({ code: 'INVALID_WORKFLOW' }));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('bounds oversized documents', () => {
    expect(() => parseWorkflow(' '.repeat(1_000_001))).toThrow(expect.objectContaining({ code: 'INVALID_WORKFLOW' }));
  });
});

describe('workflow stage identity', () => {
  const keyed = 'columns:' + String.fromCharCode(10)
    + '  - id: todo' + String.fromCharCode(10)
    + '    key: stage-1' + String.fromCharCode(10)
    + '    label: To do' + String.fromCharCode(10)
    + '  - id: done' + String.fromCharCode(10)
    + '    label: Done' + String.fromCharCode(10);

  it('accepts an authored stage key and leaves an absent one undefined', () => {
    const result = parseWorkflow(keyed);
    expect(result.columns[0]?.key).toBe('stage-1');
    expect(result.columns[1]?.key).toBeUndefined();
  });

  it('keeps the stage key out of behaviour when it is absent', () => {
    expect(parseWorkflow(minimal).columns.map(column => column.key)).toEqual([undefined, undefined]);
  });

  it.each([
    'columns: [{id: one, key: stage, label: One}, {id: two, key: stage, label: Two}]',
    'columns: [{id: one, key: "../escape", label: One}]',
    'columns: [{id: one, key: constructor, label: One}]',
    'columns: [{id: one, key: 3, label: One}]',
  ])('rejects a malformed or duplicate stage key %#', yaml => {
    expect(() => parseWorkflow(yaml)).toThrow(expect.objectContaining({ code: 'INVALID_WORKFLOW' }));
  });

  it('keeps the stage key in the persisted identity and in the workflow meaning', () => {
    const keyedWorkflow = parseWorkflow(keyed);
    const rekeyed = parseWorkflow(keyed.replace('key: stage-1', 'key: stage-2'));
    const renamed = parseWorkflow(keyed.replace('id: todo', 'id: planning'));
    expect(canonicalWorkflow(keyedWorkflow)).toBe(canonicalWorkflow(parseWorkflow(keyed)));
    expect(canonicalWorkflow(keyedWorkflow)).not.toBe(canonicalWorkflow(rekeyed));
    // The identity is persisted but is not part of what the workflow means, so the
    // legacy merge can still compare a board that gained identities to one without.
    expect(workflowMeaning(keyedWorkflow)).toBe(workflowMeaning(rekeyed));
    expect(workflowMeaning(keyedWorkflow)).toBe(workflowMeaning(parseWorkflow(keyed)));
    expect(workflowMeaning(keyedWorkflow)).not.toBe(workflowMeaning(renamed));
  });
});

describe('workflow connection layout', () => {
  const base = 'columns:' + String.fromCharCode(10) + '  - id: one' + String.fromCharCode(10) + '    label: One' + String.fromCharCode(10) + '  - id: two' + String.fromCharCode(10) + '    label: Two' + String.fromCharCode(10);

  it('parses authored anchors and segment displacements', () => {
    const result = parseWorkflow(base + 'connections:' + String.fromCharCode(10) + '  - from: one' + String.fromCharCode(10) + '    to: two' + String.fromCharCode(10) + '    source: {side: right, at: 2}' + String.fromCharCode(10) + '    target: {side: top, at: 0}' + String.fromCharCode(10) + '    segments:' + String.fromCharCode(10) + '      - {axis: x, offset: 64}' + String.fromCharCode(10) + '      - {axis: y, offset: -20}' + String.fromCharCode(10));
    expect(result.connections).toEqual([{ from: 'one', to: 'two', source: { side: 'right', at: 2 }, target: { side: 'top', at: 0 }, segments: [{ axis: 'x', offset: 64 }, { axis: 'y', offset: -20 }] }]);
  });

  it('keeps an entry the workflow draws no connection for', () => {
    const result = parseWorkflow(base + 'connections: [{from: one, to: missing}]');
    expect(result.connections).toEqual([{ from: 'one', to: 'missing' }]);
  });

  it('omits the field when the document authors none', () => {
    expect(parseWorkflow(base).connections).toBeUndefined();
    expect(parseWorkflow(base + 'connections: []').connections).toBeUndefined();
  });

  it.each([
    'connections: {from: one, to: two}',
    'connections: [{to: two}]',
    'connections: [{from: one}]',
    'connections: [{from: 3, to: two}]',
    'connections: [{from: one, to: two, x: 1}]',
    'connections: [{from: one, to: two, source: {side: middle, at: 1}}]',
    'connections: [{from: one, to: two, source: {side: right, at: 5}}]',
    'connections: [{from: one, to: two, source: {side: right, at: 1.5}}]',
    'connections: [{from: one, to: two, source: {side: right, at: 1, extra: 2}}]',
    'connections: [{from: one, to: two, target: {side: left}}]',
    'connections: [{from: one, to: two, segments: 3}]',
    'connections: [{from: one, to: two, segments: [{axis: z, offset: 1}]}]',
    'connections: [{from: one, to: two, segments: [{axis: x}]}]',
    'connections: [{from: one, to: two, segments: [{axis: x, offset: .inf}]}]',
    'connections: [{from: one, to: two, segments: [{axis: x, offset: 1, weight: 2}]}]',
    'connections: [{from: one, to: two}, {from: one, to: two}]',
  ])('rejects a malformed connection layout %#', yaml => {
    expect(() => parseWorkflow(base + yaml)).toThrow(expect.objectContaining({ code: 'INVALID_WORKFLOW' }));
  });
});

const withModelBase = 'columns:\n  - id: one\n    label: One\n';

describe('the board default model mapping', () => {
  it('reads the authored root mapping into the workflow', () => {
    const result = parseWorkflow(withModelBase + 'model:\n  provider: anthropic\n  model: claude-sonnet-4-5\n  reasoning_effort: high\n');
    expect(result.model).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-5', reasoningEffort: 'high' });
  });

  it('omits the mapping when the document authors none and the effort when it is unauthored', () => {
    expect(parseWorkflow(withModelBase).model).toBeUndefined();
    expect(parseWorkflow(withModelBase + 'model:\n  provider: anthropic\n  model: claude-sonnet-4-5\n').model).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-5' });
  });

  it('accepts an authored effort the adapter may not offer, leaving availability to the host', () => {
    const result = parseWorkflow(withModelBase + 'model:\n  provider: anthropic\n  model: claude\n  reasoning_effort: ultra-thinks\n');
    expect(result.model?.reasoningEffort).toBe('ultra-thinks');
  });

  it.each([
    'model: anthropic',
    'model: [anthropic]',
    'model:\n  model: claude\n',
    'model:\n  provider: anthropic\n',
    'model:\n  provider: ""\n  model: claude\n',
    'model:\n  provider: "   "\n  model: claude\n',
    'model:\n  provider: anthropic\n  model: ""\n',
    'model:\n  provider: anthropic\n  model: claude\n  reasoning_effort: ""\n',
    'model:\n  provider: anthropic\n  model: claude\n  reasoningEffort: high\n',
    'model:\n  provider: anthropic\n  model: claude\n  temperature: 1\n',
    'model:\n  provider: 3\n  model: claude\n',
  ])('rejects a malformed model mapping %#', suffix => {
    expect(() => parseWorkflow(withModelBase + suffix)).toThrow(expect.objectContaining({ code: 'INVALID_WORKFLOW' }));
  });

  it('names the model mapping in every rejection', () => {
    expect(() => parseWorkflow(withModelBase + 'model:\n  provider: anthropic\n')).toThrow(/model/);
    expect(() => parseWorkflow(withModelBase + 'model:\n  provider: anthropic\n  model: claude\n  temperature: 1\n')).toThrow(/model/);
  });

  it('counts the model as flow meaning rather than diagram layout', () => {
    const without = parseWorkflow(withModelBase);
    const withModel = parseWorkflow(withModelBase + 'model:\n  provider: anthropic\n  model: claude\n');
    expect(workflowMeaning(withModel)).not.toBe(workflowMeaning(without));
    expect(canonicalWorkflow(withModel)).not.toBe(canonicalWorkflow(without));
  });
});

describe('the board default agent preset', () => {
  it('reads the authored root scalar into the workflow', () => {
    expect(parseWorkflow(withModelBase + 'agent_preset: kanban-workflow-architect\n').agentPreset).toBe('kanban-workflow-architect');
  });

  it('omits the preset when the document authors none', () => {
    expect(parseWorkflow(withModelBase).agentPreset).toBeUndefined();
  });

  it('trims the authored preset identity', () => {
    expect(parseWorkflow(withModelBase + "agent_preset: '  standard  '\n").agentPreset).toBe('standard');
  });

  it.each([
    'agent_preset: ""\n',
    'agent_preset: "   "\n',
    'agent_preset: 3\n',
    'agent_preset: [standard]\n',
    'agent_preset: {id: standard}\n',
    'agent_preset: null\n',
  ])('rejects a malformed agent preset %#', suffix => {
    expect(() => parseWorkflow(withModelBase + suffix)).toThrow(expect.objectContaining({ code: 'INVALID_WORKFLOW' }));
  });

  it('counts the preset as flow meaning rather than diagram layout', () => {
    const without = parseWorkflow(withModelBase);
    const withPreset = parseWorkflow(withModelBase + 'agent_preset: standard\n');
    expect(workflowMeaning(withPreset)).not.toBe(workflowMeaning(without));
    expect(canonicalWorkflow(withPreset)).not.toBe(canonicalWorkflow(without));
  });

  it('keeps the model and the preset independent', () => {
    const both = parseWorkflow(withModelBase + 'model:\n  provider: anthropic\n  model: claude\nagent_preset: standard\n');
    expect(both.model).toEqual({ provider: 'anthropic', model: 'claude' });
    expect(both.agentPreset).toBe('standard');
  });
});
