import { parseDocument } from 'yaml';
import type { Column, ColumnGroup, ConnectionAnchor, ConnectionLayout, ConnectionSegmentOffset, StagePosition, StageSize, Workflow, WorkflowView } from '../shared/types.js';
import { KanbanError } from '../shared/errors.js';
import { createYamlFields, invalidWorkflow } from './yaml-fields.js';
import { STAGE_MIN_SIZE, STAGE_SIZE_LIMIT } from './stage-size.js';
import { ANCHOR_POINTS_PER_SIDE, CONNECTION_AXES, STAGE_SIDES, connectionKey, isAcceptedAnchorPoint, isAcceptedOffset } from './connection-anchor.js';

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

const { record, keys, text, id, ids, rules } = createYamlFields(invalidWorkflow);

const COLUMN_NOTE = 'WIP and agent-engine settings are not supported.';
const POSITION_NOTE = 'Only x and y are supported.';
const SIZE_NOTE = 'Only width and height are supported.';
const ANCHOR_NOTE = 'Only side and at are supported.';
const SEGMENT_NOTE = 'Only axis and offset are supported.';

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

/** One authored touch point: one of the four sides and one of its five points. */
function connectionAnchor(value: unknown, context: string): ConnectionAnchor {
  const map = record(value, context);
  keys(map, ['side', 'at'], context, ANCHOR_NOTE);
  if (!STAGE_SIDES.includes(map.side as never)) invalidWorkflow(context + ' side must be top, right, bottom or left.');
  if (!isAcceptedAnchorPoint(map.at)) invalidWorkflow(context + ' at must be an integer from 0 to ' + (ANCHOR_POINTS_PER_SIDE - 1) + '.');
  return { side: map.side as ConnectionAnchor['side'], at: map.at };
}

/** One authored displacement of an adjustable segment. */
function connectionSegment(value: unknown, context: string): ConnectionSegmentOffset {
  const map = record(value, context);
  keys(map, ['axis', 'offset'], context, SEGMENT_NOTE);
  if (!CONNECTION_AXES.includes(map.axis as never)) invalidWorkflow(context + ' axis must be x or y.');
  if (!isAcceptedOffset(map.offset)) invalidWorkflow(context + ' offset must be a finite displacement.');
  return { axis: map.axis as ConnectionSegmentOffset['axis'], offset: map.offset };
}

/**
 * One authored connection layout. The pair does not have to correspond to a drawn
 * connection: an entry for a pair the workflow does not draw is kept and ignored,
 * so reordering stages can never invalidate a saved board.
 */
function connectionLayout(value: unknown, context: string): ConnectionLayout {
  const map = record(value, context);
  keys(map, ['from', 'to', 'source', 'target', 'segments'], context);
  const layout: ConnectionLayout = { from: id(map.from, context + ' source stage'), to: id(map.to, context + ' target stage') };
  if (map.source !== undefined) layout.source = connectionAnchor(map.source, 'Column ' + layout.from + ' connection source anchor');
  if (map.target !== undefined) layout.target = connectionAnchor(map.target, 'Column ' + layout.from + ' connection target anchor');
  if (map.segments !== undefined) {
    if (!Array.isArray(map.segments)) invalidWorkflow(context + ' segments must be an array of displacements.');
    layout.segments = map.segments.map((item, index) => connectionSegment(item, context + ' segment ' + index));
  }
  return layout;
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
  keys(input, ['id', 'name', 'initial_column', 'default_view', 'columns', 'groups', 'connections'], 'workflow', COLUMN_NOTE);
  if (input.id !== undefined) id(input.id, 'Workflow ID');
  const name = input.name === undefined ? 'Workflow' : text(input.name, 'Workflow name');
  if (!Array.isArray(input.columns) || input.columns.length === 0) invalidWorkflow('Workflow requires at least one column.');
  const columns: Column[] = input.columns.map((item, index) => {
    const value = record(item, 'Column ' + index);
    keys(value, ['id', 'label', 'name', 'description', 'allowed_transitions', 'on_enter_prompt', 'position', 'size'], 'column', COLUMN_NOTE);
    if (value.description !== undefined && typeof value.description !== 'string') invalidWorkflow('Column description must be text.');
    const column: Column = { id: id(value.id, 'Column ID'), name: label(value, 'Column') };
    if (value.allowed_transitions !== undefined) column.allowedTransitions = rules(value.allowed_transitions, 'allowed_transitions');
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
    for (const entry of column.allowedTransitions ?? []) {
      if (!columnIds.has(entry.to)) invalidWorkflow('Column ' + column.id + ' references unknown transition target ' + entry.to + '.');
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
  if (input.connections !== undefined) {
    if (!Array.isArray(input.connections)) invalidWorkflow('Workflow connections must be an array.');
    const parsed = input.connections.map((item, index) => connectionLayout(item, 'Connection ' + index));
    const seen = new Set<string>();
    for (const entry of parsed) {
      const key = connectionKey(entry.from, entry.to);
      if (seen.has(key)) invalidWorkflow('Connection entries must name a distinct source and target pair: ' + entry.from + ' to ' + entry.to + '.');
      seen.add(key);
    }
    if (parsed.length > 0) workflow.connections = parsed;
  }
  return workflow;
}
