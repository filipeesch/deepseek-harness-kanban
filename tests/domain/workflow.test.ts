import { describe, expect, it } from 'vitest';
import { canTransition, DEFAULT_WORKFLOW_YAML, parseWorkflow } from '../../src/domain/workflow.js';

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
    'columns: [{id: one, label: One, on_enter_prompt: 3}]',
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
