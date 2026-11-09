import { parseDocument } from 'yaml';
import type { Column, ColumnGroup, StagePosition, StageSize, Workflow, WorkflowView } from '../shared/types.js';
import { KanbanError } from '../shared/errors.js';
import { createYamlFields, invalidWorkflow } from './yaml-fields.js';
import { STAGE_MIN_SIZE, STAGE_SIZE_LIMIT } from './stage-size.js';

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

/** The largest accepted absolute coordinate of an authored stage position. */
export const STAGE_POSITION_LIMIT = 1_000_000;

const { record, keys, text, id, ids } = createYamlFields(invalidWorkflow);

const COLUMN_NOTE = 'WIP and agent-engine settings are not supported.';
const POSITION_NOTE = 'Only x and y are supported.';
const SIZE_NOTE = 'Only width and height are supported.';

function view(value: unknown): WorkflowView {
  if (value === 'board' || value === 'workflow') return value;
  return invalidWorkflow('default_view must be board or workflow.');
}

function coordinate(map: Record<string, unknown>, axis: 'x' | 'y', context: string): number {
  const value = map[axis];
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > STAGE_POSITION_LIMIT) {
    invalidWorkflow(context + ' ' + axis + ' must be a finite coordinate within ' + STAGE_POSITION_LIMIT + '.');
  }
  return value;
}

function stagePosition(value: unknown, context: string): StagePosition {
  const map = record(value, context);
  keys(map, ['x', 'y'], context, POSITION_NOTE);
  return { x: coordinate(map, 'x', context), y: coordinate(map, 'y', context) };
}

function dimension(map: Record<string, unknown>, axis: 'width' | 'height', context: string): number {
  const value = map[axis];
  if (typeof value !== 'number' || !Number.isFinite(value) || value > STAGE_SIZE_LIMIT) {
    invalidWorkflow(context + ' ' + axis + ' must be a finite number within ' + STAGE_SIZE_LIMIT + '.');
  }
  if (value < (axis === 'width' ? STAGE_MIN_SIZE.width : STAGE_MIN_SIZE.height)) {
    invalidWorkflow(context + ' ' + axis + ' must not be smaller than ' + (axis === 'width' ? STAGE_MIN_SIZE.width : STAGE_MIN_SIZE.height) + '.');
  }
  return value;
}

function stageSize(value: unknown, context: string): StageSize {
  const map = record(value, context);
  keys(map, ['width', 'height'], context, SIZE_NOTE);
  return { width: dimension(map, 'width', context), height: dimension(map, 'height', context) };
}

function label(value: Record<string, unknown>, context: string): string {
  if (value.label !== undefined && value.name !== undefined && value.label !== value.name) {
    invalidWorkflow(context + ' cannot have conflicting label and name values.');
  }
  return text(value.label ?? value.name, context + ' label');
}

/** Parse only the supported presentation/transition subset of workflow YAML. */
export function parseWorkflow(yaml: string): Workflow {
  if (typeof yaml !== 'string' || !yaml.trim()) invalidWorkflow('Workflow YAML must be nonempty text.');
  if (yaml.length > 1_000_000) invalidWorkflow('Workflow YAML exceeds the one-megabyte limit.');
  let raw: unknown;
  try {
    const document = parseDocument(yaml, { uniqueKeys: true, prettyErrors: false, version: '1.2' });
    if (document.errors.length) invalidWorkflow(document.errors.map(error => error.message).join('; '));
    raw = document.toJS({ maxAliasCount: 100 });
  } catch (error) {
    if (error instanceof KanbanError) throw error;
    invalidWorkflow('Invalid workflow YAML: ' + (error instanceof Error ? error.message : String(error)));
  }
  const input = record(raw, 'Workflow');
  keys(input, ['id', 'name', 'initial_column', 'default_view', 'columns', 'groups'], 'workflow', COLUMN_NOTE);
  if (input.id !== undefined) id(input.id, 'Workflow ID');
  const name = input.name === undefined ? 'Workflow' : text(input.name, 'Workflow name');
  if (!Array.isArray(input.columns) || input.columns.length === 0) invalidWorkflow('Workflow requires at least one column.');
  const columns: Column[] = input.columns.map((item, index) => {
    const value = record(item, 'Column ' + index);
    keys(value, ['id', 'label', 'name', 'description', 'allowed_transitions', 'on_enter_prompt', 'position', 'size'], 'column', COLUMN_NOTE);
    if (value.description !== undefined && typeof value.description !== 'string') invalidWorkflow('Column description must be text.');
    const column: Column = { id: id(value.id, 'Column ID'), name: label(value, 'Column') };
    if (value.allowed_transitions !== undefined) column.allowedTransitions = ids(value.allowed_transitions, 'allowed_transitions');
    if (value.on_enter_prompt !== undefined && value.on_enter_prompt !== null) {
      if (typeof value.on_enter_prompt !== 'string') invalidWorkflow('on_enter_prompt must be text or null.');
      if (value.on_enter_prompt.trim()) column.onEnterPrompt = value.on_enter_prompt;
    }
    if (value.position !== undefined) column.position = stagePosition(value.position, 'Column ' + column.id + ' position');
    if (value.size !== undefined) column.size = stageSize(value.size, 'Column ' + column.id + ' size');
    return column;
  });
  const columnIds = new Set(columns.map(column => column.id));
  if (columnIds.size !== columns.length) invalidWorkflow('Column IDs must be unique.');
  for (const column of columns) {
    for (const target of column.allowedTransitions ?? []) {
      if (!columnIds.has(target)) invalidWorkflow('Column ' + column.id + ' references unknown transition target ' + target + '.');
    }
  }
  const initialColumnId = input.initial_column === undefined ? columns[0]!.id : id(input.initial_column, 'Initial column');
  if (!columnIds.has(initialColumnId)) invalidWorkflow('Initial column does not exist.');
  if (input.groups !== undefined && !Array.isArray(input.groups)) invalidWorkflow('Workflow groups must be an array.');
  const grouped = new Set<string>();
  const groups: ColumnGroup[] = ((input.groups ?? []) as unknown[]).map((item, index) => {
    const value = record(item, 'Group ' + index);
    keys(value, ['id', 'label', 'name', 'columns'], 'group');
    const group: ColumnGroup = {
      id: value.id === undefined ? 'group-' + (index + 1) : id(value.id, 'Group ID'),
      name: label(value, 'Group'),
      columnIds: ids(value.columns, 'Group columns'),
    };
    if (group.columnIds.length === 0) invalidWorkflow('Column groups cannot be empty.');
    for (const member of group.columnIds) {
      if (!columnIds.has(member)) invalidWorkflow('Group references unknown column ' + member + '.');
      if (grouped.has(member)) invalidWorkflow('Column ' + member + ' belongs to more than one group.');
      grouped.add(member);
    }
    return group;
  });
  if (new Set(groups.map(group => group.id)).size !== groups.length) invalidWorkflow('Group IDs must be unique.');
  if (groups.some(group => columnIds.has(group.id))) invalidWorkflow('Group IDs must not collide with column IDs.');
  const workflow: Workflow = { name, initialColumnId, columns, groups };
  if (input.default_view !== undefined) workflow.defaultView = view(input.default_view);
  return workflow;
}
