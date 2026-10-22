import { parseDocument } from 'yaml';
import type { Column, ColumnGroup, Workflow } from '../shared/types.js';
import { KanbanError } from '../shared/errors.js';
import { isDomainId } from './validation.js';

export const DEFAULT_WORKFLOW_YAML = [
  'name: Delivery Flow',
  'initial_column: backlog',
  'columns:',
  '  - id: backlog',
  '    label: Backlog',
  '  - id: plan',
  '    label: Plan',
  '  - id: in_progress',
  '    label: In Progress',
  '  - id: in_review',
  '    label: In Review',
  '  - id: done',
  '    label: Done',
  '',
].join('\n');

function invalid(message: string): never {
  throw new KanbanError('INVALID_WORKFLOW', message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(label + ' must be a mapping.');
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) invalid('Unsupported ' + label + ' field: ' + key + '. WIP and agent-engine settings are not supported.');
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) invalid(label + ' must be nonempty text.');
  return value.trim();
}

function id(value: unknown, label: string): string {
  if (!isDomainId(value)) invalid(label + ' must be a safe identifier.');
  return value;
}

function label(value: Record<string, unknown>, context: string): string {
  if (value.label !== undefined && value.name !== undefined && value.label !== value.name) {
    invalid(context + ' cannot have conflicting label and name values.');
  }
  return text(value.label ?? value.name, context + ' label');
}

function ids(value: unknown, context: string): string[] {
  if (!Array.isArray(value)) invalid(context + ' must be an array of column IDs.');
  const result = value.map((item, index) => id(item, context + '[' + index + ']'));
  if (new Set(result).size !== result.length) invalid(context + ' contains duplicate IDs.');
  return result;
}

/** Parse only the supported presentation/transition subset of workflow YAML. */
export function parseWorkflow(yaml: string): Workflow {
  if (typeof yaml !== 'string' || !yaml.trim()) invalid('Workflow YAML must be nonempty text.');
  if (yaml.length > 1_000_000) invalid('Workflow YAML exceeds the one-megabyte limit.');
  let raw: unknown;
  try {
    const document = parseDocument(yaml, { uniqueKeys: true, prettyErrors: false, version: '1.2' });
    if (document.errors.length) invalid(document.errors.map(error => error.message).join('; '));
    raw = document.toJS({ maxAliasCount: 100 });
  } catch (error) {
    if (error instanceof KanbanError) throw error;
    invalid('Invalid workflow YAML: ' + (error instanceof Error ? error.message : String(error)));
  }
  const input = record(raw, 'Workflow');
  keys(input, ['id', 'name', 'initial_column', 'columns', 'groups'], 'workflow');
  if (input.id !== undefined) id(input.id, 'Workflow ID');
  const name = input.name === undefined ? 'Workflow' : text(input.name, 'Workflow name');
  if (!Array.isArray(input.columns) || input.columns.length === 0) invalid('Workflow requires at least one column.');
  const columns: Column[] = input.columns.map((item, index) => {
    const value = record(item, 'Column ' + index);
    keys(value, ['id', 'label', 'name', 'description', 'allowed_transitions', 'on_enter_prompt'], 'column');
    if (value.description !== undefined && typeof value.description !== 'string') invalid('Column description must be text.');
    const column: Column = { id: id(value.id, 'Column ID'), name: label(value, 'Column') };
    if (value.allowed_transitions !== undefined) column.allowedTransitions = ids(value.allowed_transitions, 'allowed_transitions');
    if (value.on_enter_prompt !== undefined && value.on_enter_prompt !== null) {
      if (typeof value.on_enter_prompt !== 'string') invalid('on_enter_prompt must be text or null.');
      if (value.on_enter_prompt.trim()) column.onEnterPrompt = value.on_enter_prompt;
    }
    return column;
  });
  const columnIds = new Set(columns.map(column => column.id));
  if (columnIds.size !== columns.length) invalid('Column IDs must be unique.');
  for (const column of columns) {
    for (const target of column.allowedTransitions ?? []) {
      if (!columnIds.has(target)) invalid('Column ' + column.id + ' references unknown transition target ' + target + '.');
    }
  }
  const initialColumnId = input.initial_column === undefined ? columns[0]!.id : id(input.initial_column, 'Initial column');
  if (!columnIds.has(initialColumnId)) invalid('Initial column does not exist.');
  if (input.groups !== undefined && !Array.isArray(input.groups)) invalid('Workflow groups must be an array.');
  const grouped = new Set<string>();
  const groups: ColumnGroup[] = ((input.groups ?? []) as unknown[]).map((item, index) => {
    const value = record(item, 'Group ' + index);
    keys(value, ['id', 'label', 'name', 'columns'], 'group');
    const group: ColumnGroup = {
      id: value.id === undefined ? 'group-' + (index + 1) : id(value.id, 'Group ID'),
      name: label(value, 'Group'),
      columnIds: ids(value.columns, 'Group columns'),
    };
    if (group.columnIds.length === 0) invalid('Column groups cannot be empty.');
    for (const member of group.columnIds) {
      if (!columnIds.has(member)) invalid('Group references unknown column ' + member + '.');
      if (grouped.has(member)) invalid('Column ' + member + ' belongs to more than one group.');
      grouped.add(member);
    }
    return group;
  });
  if (new Set(groups.map(group => group.id)).size !== groups.length) invalid('Group IDs must be unique.');
  if (groups.some(group => columnIds.has(group.id))) invalid('Group IDs must not collide with column IDs.');
  return { name, initialColumnId, columns, groups };
}

/** A transition enters a different existing stage; same-stage ordering is separate. */
export function canTransition(workflow: Workflow, from: string, to: string): boolean {
  const source = workflow.columns.find(column => column.id === from);
  if (!source || from === to || !workflow.columns.some(column => column.id === to)) return false;
  return source.allowedTransitions === undefined || source.allowedTransitions.includes(to);
}
