import { KanbanError } from '../../shared/errors.js';
import type { ColumnGroup, ConnectionLayout, StagePosition, StageSize, TransitionRule, Workflow } from '../../shared/types.js';
import { connectionKey } from '../connection-anchor.js';
import { parseWorkflow } from '../workflow.js';
import { updateStage } from '../stage-update.js';
import { setStagePositions } from '../workflow-positions.js';
import { setStageSizes } from '../workflow-sizes.js';
import { setConnections } from '../workflow-connections.js';
import { writeRootField, writeSequenceItemField } from '../yaml-map-fields.js';
import { scalar, textField } from '../authored-scalar.js';
import { seedStageIdentities } from '../stage-identity.js';
import { appendSequenceItem, pruneEmptySequence, removeSequenceItem, replaceSequenceItem } from './authored-text.js';
import type { BoardChange, StageDefinition } from './event.js';

/**
 * Materialize one board change into the authored workflow text.
 *
 * The change is applied as a text-range edit on the span it describes, so the
 * author's comments, key order, quoting, and every stage the change does not name
 * survive. The caller stores the result; validation belongs to the board write, so
 * an edit that produces an invalid workflow is rejected there.
 */

function invalid(message: string): never {
  throw new KanbanError('INVALID_WORKFLOW', message);
}

function stageMissing(key: string): never {
  throw new KanbanError('JOURNAL_STAGE_MISSING', 'The board workflow does not contain the stage this change addresses.', { key });
}

/** The authored identifier a stable stage identity currently resolves to. */
export function stageIdentifier(workflow: Workflow, key: string): string {
  const column = workflow.columns.find(candidate => candidate.key === key);
  if (column === undefined) stageMissing(key);
  return column!.id;
}

/** One stage as authored lines, ready to be inserted as a sequence item. */
function stageLines(stage: StageDefinition): string[] {
  const lines = ['id: ' + scalar(stage.id), 'key: ' + scalar(stage.key), 'label: ' + scalar(stage.name)];
  if (stage.onEnterPrompt !== undefined && stage.onEnterPrompt.trim().length > 0) {
    // The shared renderer chooses a block scalar and keeps the authored trailing-newline style.
    lines.push(...textField('on_enter_prompt', stage.onEnterPrompt, '', false).split(String.fromCharCode(10)));
  }
  if (stage.allowedTransitions !== undefined) {
    if (stage.allowedTransitions.length === 0) lines.push('allowed_transitions: []');
    else {
      lines.push('allowed_transitions:');
      for (const rule of stage.allowedTransitions) {
        lines.push('  - to: ' + scalar(rule.to));
        if (rule.when !== undefined) lines.push('    when: ' + scalar(rule.when));
      }
    }
  }
  if (stage.position !== undefined) lines.push('position: {x: ' + stage.position.x + ', y: ' + stage.position.y + '}');
  if (stage.size !== undefined) lines.push('size: {width: ' + stage.size.width + ', height: ' + stage.size.height + '}');
  return lines;
}

function groupLines(group: ColumnGroup): string[] {
  return ['id: ' + scalar(group.id), 'label: ' + scalar(group.name), 'columns: [' + group.columnIds.map(item => scalar(item)).join(', ') + ']'];
}

/** One stage as a single-line flow mapping, for a columns list authored in flow style. */
function stageFlow(stage: StageDefinition): string {
  const fields = ['id: ' + scalar(stage.id), 'key: ' + scalar(stage.key), 'label: ' + scalar(stage.name)];
  if (stage.onEnterPrompt !== undefined && stage.onEnterPrompt.trim().length > 0) fields.push('on_enter_prompt: ' + scalar(stage.onEnterPrompt));
  if (stage.allowedTransitions !== undefined) {
    const rules = stage.allowedTransitions.map(rule => (rule.when === undefined ? '{to: ' + scalar(rule.to) + '}' : '{to: ' + scalar(rule.to) + ', when: ' + scalar(rule.when) + '}'));
    fields.push('allowed_transitions: [' + rules.join(', ') + ']');
  }
  if (stage.position !== undefined) fields.push('position: {x: ' + stage.position.x + ', y: ' + stage.position.y + '}');
  if (stage.size !== undefined) fields.push('size: {width: ' + stage.size.width + ', height: ' + stage.size.height + '}');
  return '{' + fields.join(', ') + '}';
}

/** One group as a single-line flow mapping, for a groups list authored in flow style. */
function groupFlow(group: ColumnGroup): string {
  return '{id: ' + scalar(group.id) + ', label: ' + scalar(group.name) + ', columns: [' + group.columnIds.map(item => scalar(item)).join(', ') + ']}';
}

/** Rewrite the layout of one stage without touching another stage's layout. */
function setLayout(text: string, workflow: Workflow, id: string, next: { position?: StagePosition | null; size?: StageSize | null }): string {
  let value = text;
  if (next.position !== undefined) {
    const positions = Object.create(null) as Record<string, StagePosition | undefined>;
    for (const column of workflow.columns) if (column.position !== undefined) positions[column.id] = column.position;
    positions[id] = next.position === null ? undefined : next.position;
    value = setStagePositions(value, positions);
  }
  if (next.size !== undefined) {
    const sizes = Object.create(null) as Record<string, StageSize | undefined>;
    for (const column of workflow.columns) if (column.size !== undefined) sizes[column.id] = column.size;
    sizes[id] = next.size === null ? undefined : next.size;
    value = setStageSizes(value, sizes);
  }
  return value;
}

/**
 * Remove one stage and every authored reference that would otherwise be dangling.
 * The references are cleared first, because a document that names a stage it no
 * longer defines cannot be parsed again.
 */
function removeStage(text: string, key: string): string {
  const workflow = seedStageIdentities(parseWorkflow(text));
  const column = workflow.columns.find(candidate => candidate.key === key);
  if (column === undefined) stageMissing(key);
  const id = column!.id;
  const remaining = workflow.columns.filter(candidate => candidate.id !== id);
  if (remaining.length === 0) invalid('A workflow requires at least one stage.');

  let value = text;
  for (const other of workflow.columns) {
    if (other.id === id) continue;
    const transitions = other.allowedTransitions ?? [];
    if (!transitions.some(rule => rule.to === id)) continue;
    const kept = transitions.filter(rule => rule.to !== id);
    value = updateStage({ text: value, stageId: other.id, patch: { allowedTransitions: kept.length === 0 ? null : kept } }).text;
  }

  for (const group of workflow.groups) {
    if (!group.columnIds.includes(id)) continue;
    const kept = group.columnIds.filter(member => member !== id);
    if (kept.length === 0) value = removeSequenceItem({ text: value, sequenceKey: 'groups', fields: { id: group.id } });
    else value = replaceSequenceItem({ text: value, sequenceKey: 'groups', fields: { id: group.id }, item: groupLines({ ...group, columnIds: kept }) });
  }
  value = pruneEmptySequence(value, 'groups');

  const connections = workflow.connections ?? [];
  if (connections.some(layout => layout.from === id || layout.to === id)) {
    value = writeConnectionList(value, connections.filter(layout => layout.from !== id && layout.to !== id));
  }

  if (workflow.initialColumnId === id) {
    value = writeRootField({ text: value, fieldKeys: ['initial_column'], render: (_existing, _indent, field) => field + ': ' + scalar(remaining[0]!.id), invalid });
  }

  value = removeSequenceItem({ text: value, sequenceKey: 'columns', fields: { id } });
  return pruneEmptySequence(value, 'groups');
}

function readConnectionList(text: string): ConnectionLayout[] {
  const workflow = parseWorkflow(text);
  return (workflow.connections ?? []).map(layout => ({ ...layout }));
}

function writeConnectionList(text: string, layouts: readonly ConnectionLayout[]): string {
  const record: Record<string, ConnectionLayout | undefined> = Object.create(null) as Record<string, ConnectionLayout | undefined>;
  for (const layout of parseWorkflow(text).connections ?? []) record[connectionKey(layout.from, layout.to)] = undefined;
  for (const layout of layouts) record[connectionKey(layout.from, layout.to)] = layout;
  return setConnections(text, record);
}

/** Apply one board change to the authored workflow text. */
export function materialize(text: string, change: BoardChange): string {
  switch (change.kind) {
    case 'workflow.replaced':
      return change.text;
    case 'workflow.field-changed':
      return writeRootField({
        text,
        fieldKeys: change.field === 'name' ? ['name'] : ['default_view'],
        render: (_existing, _indent, field) => (change.value === null ? null : field + ': ' + scalar(change.value)),
        invalid,
      });
    case 'workflow.initial-changed': {
      const workflow = parseWorkflow(text);
      if (!workflow.columns.some(column => column.id === change.columnId)) invalid('Initial column does not exist.');
      return writeRootField({ text, fieldKeys: ['initial_column'], render: (_existing, _indent, field) => field + ': ' + scalar(change.columnId), invalid });
    }
    case 'stage.created':
      return appendSequenceItem({ text, sequenceKey: 'columns', item: stageLines(change.stage), flowItem: stageFlow(change.stage) });
    case 'stage.field-changed': {
      const workflow = seedStageIdentities(parseWorkflow(text));
      const stageId = stageIdentifier(workflow, change.key);
      if (change.field === 'allowedTransitions' && Array.isArray(change.value) && change.value.length === 0) {
        // The stage editor refuses an empty restricted set, but an authored empty list is
        // valid input and must stay expressible when the team publishes one.
        return writeSequenceItemField({
          text, sequenceKey: 'columns', idKey: 'id', id: stageId,
          fieldKeys: ['allowed_transitions'],
          render: (_existing, _indent, field) => field + ': []',
          invalid,
        });
      }
      const patch = change.field === 'name'
        ? { name: change.value }
        : change.field === 'onEnterPrompt'
          ? { onEnterPrompt: change.value }
          : { allowedTransitions: change.value };
      return updateStage({ text, stageId, patch }).text;
    }
    case 'stage.id-changed': {
      const workflow = seedStageIdentities(parseWorkflow(text));
      const current = stageIdentifier(workflow, change.key);
      // A local rename the team never saw is a divergence, not a change to apply: the
      // two sides disagree about what this stage is called, and only the user decides.
      if (current !== change.from && current !== change.id) {
        throw new KanbanError('JOURNAL_IDENTITY_CONFLICT', 'The stage was renamed differently on this installation and by the team.', { key: change.key, local: current, teamFrom: change.from, teamTo: change.id });
      }
      return updateStage({ text, stageId: current, patch: { id: change.id } }).text;
    }
    case 'stage.removed':
      return removeStage(text, change.key);
    case 'stage.layout-set': {
      const workflow = seedStageIdentities(parseWorkflow(text));
      return setLayout(text, workflow, stageIdentifier(workflow, change.key), { position: change.position, size: change.size });
    }
    case 'group.created':
      return appendSequenceItem({ text, sequenceKey: 'groups', item: groupLines(change.group), flowItem: groupFlow(change.group) });
    case 'group.field-changed':
      if (change.field === 'columns') {
        const group = parseWorkflow(text).groups.find(candidate => candidate.id === change.id);
        if (group === undefined) throw new KanbanError('JOURNAL_GROUP_MISSING', 'The board workflow does not contain the group this change addresses.', { id: change.id });
        return replaceSequenceItem({ text, sequenceKey: 'groups', fields: { id: change.id }, item: groupLines({ ...group, columnIds: change.value }), flowItem: groupFlow({ ...group, columnIds: change.value }) });
      }
      return writeSequenceItemField({
        text, sequenceKey: 'groups', idKey: 'id', id: change.id,
        fieldKeys: ['label', 'name'],
        render: (_existing, _indent, field) => field + ': ' + scalar(change.value),
        invalid,
      });
    case 'group.removed':
      return pruneEmptySequence(removeSequenceItem({ text, sequenceKey: 'groups', fields: { id: change.id } }), 'groups');
    case 'connection.set': {
      const layouts = readConnectionList(text);
      const key = connectionKey(change.layout.from, change.layout.to);
      const index = layouts.findIndex(layout => connectionKey(layout.from, layout.to) === key);
      if (index < 0) layouts.push(change.layout); else layouts[index] = change.layout;
      return writeConnectionList(text, layouts);
    }
    case 'connection.removed': {
      const layouts = readConnectionList(text).filter(layout => connectionKey(layout.from, layout.to) !== connectionKey(change.from, change.to));
      return writeConnectionList(text, layouts);
    }
    default:
      return text;
  }
}

/** Write the stable identity of every stage into the authored text. */
export function materializeIdentities(text: string): string {
  const workflow = parseWorkflow(text);
  const seeded = seedStageIdentities(workflow);
  let value = text;
  for (const column of seeded.columns) {
    if (workflow.columns.find(candidate => candidate.id === column.id)?.key !== undefined) continue;
    value = writeSequenceItemField({
      text: value, sequenceKey: 'columns', idKey: 'id', id: column.id,
      fieldKeys: ['key'],
      render: (_existing, _indent, field) => field + ': ' + scalar(column.key!),
      invalid,
    });
  }
  return value;
}
