import { parseDocument, stringify } from 'yaml';
import { KanbanError, invariant } from '../shared/errors.js';
import { isDomainId } from './validation.js';
import { parseWorkflow } from './workflow.js';
import { authoredScalar, writeNestedSequenceItemField, writeRootField, writeSequenceItemField } from './yaml-map-fields.js';
import { invalidWorkflow } from './yaml-fields.js';
import { renderTransitionList } from './transition-write.js';
import { appendSequenceItem, insertSequenceItemAfter, pruneEmptySequence, removeSequenceItem } from './journal/authored-text.js';

/** One stage definition offered to an authored workflow. */
export interface AddStageInput {
  readonly text: string;
  /** The stage mapping as YAML lines, with or without its sequence marker. */
  readonly stageYaml: string;
  /** The stage the new one follows; absent appends it at the end of the sequence. */
  readonly after?: string;
}

/** What removing one stage rewrote on the way out. */
export interface RemoveStageResult {
  readonly text: string;
  /** How many other stages lost a transition to the removed stage. */
  readonly clearedTransitions: number;
  /** The script exits dropped, written as stage:exit. */
  readonly clearedExits: readonly string[];
  readonly removedConnections: number;
  readonly removedGroups: readonly string[];
}

/**
 * The stage snippet rendered as mapping lines. The snippet may arrive as a
 * mapping or as a one-entry sequence, at any indentation; re-rendering it keeps
 * the authored indentation out of the document while preserving the values,
 * including a script's own text.
 */
function stageLines(stageYaml: string): string[] {
  let document;
  try { document = parseDocument(stageYaml, { uniqueKeys: true, prettyErrors: false, version: '1.2' }); }
  catch (error) { throw new KanbanError('INVALID_INPUT', 'Invalid stage YAML: ' + (error instanceof Error ? error.message : String(error))); }
  if (document.errors.length > 0) throw new KanbanError('INVALID_INPUT', 'Invalid stage YAML: ' + document.errors[0]!.message);
  const raw = document.toJS() as unknown;
  const value = Array.isArray(raw) ? raw[0] : raw;
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_INPUT', 'A stage definition is a mapping.');
  const id = (value as Record<string, unknown>).id;
  invariant(typeof id === 'string' && isDomainId(id), 'INVALID_INPUT', 'A stage definition requires a safe identifier as its id.');
  return stringify(value, { indent: 2 }).replace(/\n$/, '').split('\n');
}

/** Insert one authored stage, keeping every other character of the document. */
export function addStage(input: AddStageInput): string {
  const workflow = parseWorkflow(input.text);
  if (input.after !== undefined) {
    invariant(workflow.columns.some(column => column.id === input.after), 'STAGE_NOT_FOUND', 'The workflow has no stage ' + input.after + '.');
  }
  const item = stageLines(input.stageYaml);
  const text = input.after === undefined
    ? appendSequenceItem({ text: input.text, sequenceKey: 'columns', item, invalid: invalidWorkflow })
    : insertSequenceItemAfter({ text: input.text, sequenceKey: 'columns', after: { fields: { id: input.after } }, item, invalid: invalidWorkflow });
  parseWorkflow(text);
  return text;
}

/**
 * Remove one authored stage and every reference to it in the same document.
 *
 * A transition to the stage is dropped from the list that authored it, a named
 * script exit that routed there is dropped, a group that only claimed it is
 * removed, and a connection layout that named it disappears. A script stage whose
 * only exit points at the removed stage is refused: the stage would leave the
 * definition without a single destination.
 */
export function removeStage(input: { readonly text: string; readonly stageId: string; readonly replacementInitial?: string }): RemoveStageResult {
  const workflow = parseWorkflow(input.text);
  const target = workflow.columns.find(column => column.id === input.stageId);
  invariant(target, 'STAGE_NOT_FOUND', 'The workflow has no stage ' + input.stageId + '.');
  let text = input.text;
  if (workflow.initialColumnId === input.stageId) {
    const replacement = input.replacementInitial;
    invariant(replacement !== undefined && replacement !== input.stageId && workflow.columns.some(column => column.id === replacement), 'INITIAL_STAGE_REQUIRED', 'Removing the initial stage requires naming another stage as the initial one.');
    text = writeRootField({ text, fieldKeys: ['initial_column'], render: (_existing, _indent, key) => key + ': ' + authoredScalar(replacement!), invalid: invalidWorkflow });
  }
  let clearedTransitions = 0;
  for (const column of workflow.columns) {
    if (column.id === input.stageId) continue;
    const rules = column.allowedTransitions;
    if (rules === undefined || !rules.some(rule => rule.to === input.stageId)) continue;
    const remaining = rules.filter(rule => rule.to !== input.stageId);
    text = writeSequenceItemField({
      text, sequenceKey: 'columns', idKey: 'id', id: column.id, fieldKeys: ['allowed_transitions'], invalid: invalidWorkflow,
      render: (_existing, indent, _key, flow) => renderTransitionList(remaining, indent, flow),
    });
    clearedTransitions += 1;
  }
  const clearedExits: string[] = [];
  for (const column of workflow.columns) {
    const definition = column.deterministic;
    if (column.id === input.stageId || definition === undefined) continue;
    const dropped = Object.entries(definition.exits).filter(([, destination]) => destination === input.stageId).map(([exit]) => exit);
    if (dropped.length === 0) continue;
    invariant(dropped.length < Object.keys(definition.exits).length, 'STAGE_ROUTED_FROM_SCRIPT', 'Stage ' + column.id + ' routes to ' + input.stageId + ' with its only named exit; give it another destination first.');
    for (const exit of dropped) {
      text = writeNestedSequenceItemField({ text, sequenceKey: 'columns', idKey: 'id', id: column.id, path: ['deterministic', 'exits'], fieldKeys: [exit], invalid: invalidWorkflow, render: () => null });
      clearedExits.push(column.id + ':' + exit);
    }
  }
  const removedGroups: string[] = [];
  const groupEdits = workflow.groups.flatMap((group, index) => group.columnIds.includes(input.stageId)
    ? [{ index, id: group.id, remaining: group.columnIds.filter(member => member !== input.stageId) }]
    : []);
  for (const group of [...groupEdits].sort((left, right) => right.index - left.index)) {
    if (group.remaining.length === 0) {
      text = removeSequenceItem({ text, sequenceKey: 'groups', index: group.index });
      removedGroups.push(group.id);
    } else {
      text = writeSequenceItemField({
        text, sequenceKey: 'groups', idKey: 'id', index: group.index, fieldKeys: ['columns'], invalid: invalidWorkflow,
        render: (_existing, _indent, key) => key + ': ' + JSON.stringify(group.remaining),
      });
    }
  }
  if (removedGroups.length > 0) text = pruneEmptySequence(text, 'groups');
  let removedConnections = 0;
  for (const layout of workflow.connections ?? []) {
    if (layout.from !== input.stageId && layout.to !== input.stageId) continue;
    text = removeSequenceItem({ text, sequenceKey: 'connections', fields: { from: layout.from, to: layout.to } });
    removedConnections += 1;
  }
  if (removedConnections > 0) text = pruneEmptySequence(text, 'connections');
  text = removeSequenceItem({ text, sequenceKey: 'columns', fields: { id: input.stageId } });
  parseWorkflow(text);
  return { text, clearedTransitions, clearedExits, removedConnections, removedGroups };
}

/** Whether one authored workflow defines a stage. */
export function definesStage(text: string, stageId: string): boolean {
  return parseWorkflow(text).columns.some(column => column.id === stageId) && isDomainId(stageId);
}

/** The error a caller reports when it asked to add a stage whose identifier is taken. */
export function assertNewStageId(text: string, stageId: string): void {
  invariant(!parseWorkflow(text).columns.some(column => column.id === stageId), 'STAGE_EXISTS', 'The workflow already defines stage ' + stageId + '.');
  if (stageId.length === 0) throw new KanbanError('INVALID_INPUT', 'A stage identifier must be nonempty.');
}
