import type { Task } from '../shared/types.js';
import { parseDeterministicDefinition, deterministicEqual } from './deterministic-definition.js';
import { renameDeterministicTargets, updateDeterministicFields } from './deterministic-write.js';
import type { TaskHistoryEntry } from '../shared/task-history.js';
import type { StagePatch, TransitionRule } from '../shared/types.js';
import { KanbanError } from '../shared/errors.js';
import { isDomainId } from './validation.js';
import { parseWorkflow } from './workflow.js';
import { authoredScalar, replaceListScalars, textField, writeRootField, writeSequenceItemField } from './yaml-map-fields.js';
import { renderTransitionList, writeTransitionCondition } from './transition-write.js';

/** One stage edit: the authored workflow text, the stage it targets, and the fields it changes. */
export interface StageUpdateInput {
  readonly text: string;
  readonly stageId: string;
  readonly patch: StagePatch;
}

/** The task references one stage identifier owns; the caller keeps the rest of the task. */
export interface StageReferencingTask {
  columnId: string;
  stageEntry?: Task['stageEntry'];
  deterministicHandoff?: Task['deterministicHandoff'];
  pendingTransition?: { fromColumnId: string; columnId: string };
  recordedTransition?: { fromColumnId: string; columnId: string };
  instructionPending?: { columnId: string };
  /** The task's flow record; its stage references follow the rename like every other one. */
  history?: TaskHistoryEntry[];
}

/**
 * Carry a renamed stage identifier into one task's references. The caller decides
 * which tasks may migrate; a task whose work is in flight never reaches this call.
 */
export function renameTaskStage(task: StageReferencingTask, from: string, to: string): boolean {
  let changed = false;
  if (task.columnId === from) { task.columnId = to; changed = true; }
  if (task.stageEntry?.columnId === from) { task.stageEntry.columnId = to; changed = true; }
  if (task.deterministicHandoff !== undefined) {
    if (task.deterministicHandoff.columnId === from) { task.deterministicHandoff.columnId = to; changed = true; }
    if (task.deterministicHandoff.fromColumnId === from) { task.deterministicHandoff.fromColumnId = to; changed = true; }
  }
  if (task.pendingTransition !== undefined) {
    if (task.pendingTransition.fromColumnId === from) { task.pendingTransition.fromColumnId = to; changed = true; }
    if (task.pendingTransition.columnId === from) { task.pendingTransition.columnId = to; changed = true; }
  }
  if (task.recordedTransition !== undefined) {
    if (task.recordedTransition.fromColumnId === from) { task.recordedTransition.fromColumnId = to; changed = true; }
    if (task.recordedTransition.columnId === from) { task.recordedTransition.columnId = to; changed = true; }
  }
  if (task.instructionPending !== undefined && task.instructionPending.columnId === from) { task.instructionPending.columnId = to; changed = true; }
  if (task.history !== undefined) {
    let renamed = false;
    const history = task.history.map(entry => {
      const next = renameHistoryStage(entry, from, to);
      if (next !== entry) renamed = true;
      return next;
    });
    if (renamed) { task.history = history; changed = true; }
  }
  return changed;
}

/** Carry a renamed stage identifier into one recorded entry, keeping its kind and moment. */
function renameHistoryStage(entry: TaskHistoryEntry, from: string, to: string): TaskHistoryEntry {
  if (entry.kind === 'created' || entry.kind === 'deterministic-execution') return entry.columnId === from ? { ...entry, columnId: to } : entry;
  if (entry.kind === 'stage' || entry.kind === 'intent' || entry.kind === 'deterministic-handoff') {
    const fromColumnId = entry.fromColumnId === from ? to : entry.fromColumnId;
    const columnId = entry.columnId === from ? to : entry.columnId;
    return fromColumnId === entry.fromColumnId && columnId === entry.columnId ? entry : { ...entry, fromColumnId, columnId };
  }
  return entry;
}

/** What one stage edit changed, so the caller can migrate its own task data. */
export interface StageUpdateResult {
  readonly text: string;
  readonly renamedFrom?: string;
  readonly renamedTo?: string;
  /** How many authored references to a renamed identifier were rewritten. */
  readonly rewrittenReferences: number;
}

function invalid(message: string): never {
  throw new KanbanError('INVALID_WORKFLOW', message);
}

function transitionsField(rules: readonly TransitionRule[], existing: unknown, indent: string, parentFlow: boolean): string {
  // An empty list is authored state, not absence: it is the stage that permits no
  // destination. Removing the field would turn that stage back into one that
  // permits any other stage, so the empty sequence is written out.
  // A flow mapping can only hold a flow sequence, and a stored flow list stays flow.
  const flow = parentFlow || (existing as { flow?: boolean } | null)?.flow === true;
  return renderTransitionList(rules, indent, flow);
}

function normalizedRules(rules: readonly TransitionRule[]): TransitionRule[] {
  const seen = new Set<string>();
  const result: TransitionRule[] = [];
  for (const rule of rules) {
    if (seen.has(rule.to)) invalid('A transition target can be listed once: ' + rule.to + '.');
    seen.add(rule.to);
    const condition = typeof rule.when === 'string' ? rule.when.trim() : '';
    result.push(condition.length > 0 ? { to: rule.to, when: condition } : { to: rule.to });
  }
  return result;
}

/**
 * Apply one stage patch to an authored workflow document. Only the fields the
 * patch names are rewritten, by text range, so comments, key order, quoting, and
 * every other authored character survive. A renamed identifier is carried into
 * every authored reference to it; task data belongs to the caller.
 */
export function updateStage({ text, stageId, patch }: StageUpdateInput): StageUpdateResult {
  const workflow = parseWorkflow(text);
  const stage = workflow.columns.find(column => column.id === stageId);
  if (stage === undefined) invalid('Stage ' + stageId + ' does not exist in this workflow.');

  const name = patch.name === undefined ? undefined : patch.name.trim();
  if (name !== undefined && name.length === 0) invalid('A stage name is required.');

  const newId = patch.id ?? stageId;
  if (patch.id !== undefined && !isDomainId(patch.id)) invalid('A stage id must be a nonempty safe identifier.');
  const renamed = newId !== stageId;
  if (renamed && workflow.columns.some(column => column.id === newId)) invalid('Another stage already uses the id ' + newId + '.');

  const others = new Set(workflow.columns.filter(column => column.id !== stageId).map(column => column.id));
  let rules: TransitionRule[] | null | undefined;
  if (patch.allowedTransitions !== undefined) {
    rules = patch.allowedTransitions === null ? null : normalizedRules(patch.allowedTransitions);
    if (rules !== null) {
      for (const rule of rules) {
        if (!isDomainId(rule.to)) invalid('A transition target must be a safe identifier.');
        if (rule.to === newId) invalid('A stage cannot be its own transition target.');
        if (!others.has(rule.to)) invalid('Transition target ' + rule.to + ' is not a stage of this workflow.');
      }
    }
  }

  if (patch.allowedTransitions !== undefined && patch.transitionCondition !== undefined) {
    invalid('A stage edit cannot change its destination list and one destination condition at the same time.');
  }
  const condition = patch.transitionCondition;
  if (condition !== undefined) {
    if (!isDomainId(condition.to)) invalid('A transition target must be a safe identifier.');
    if (condition.to === newId) invalid('A stage cannot be its own transition target.');
    if (!others.has(condition.to)) invalid('Transition target ' + condition.to + ' is not a stage of this workflow.');
  }

  let next = condition === undefined ? text : writeTransitionCondition({ text, stageId, to: condition.to, when: condition.when });
  let rewrittenReferences = 0;
  const writeColumn = (id: string, fieldKeys: readonly string[], render: Parameters<typeof writeSequenceItemField>[0]['render']) => {
    next = writeSequenceItemField({ text: next, sequenceKey: 'columns', idKey: 'id', id, fieldKeys, render, invalid });
  };

  if (name !== undefined) writeColumn(stageId, ['label', 'name'], (_existing, indent, key, flow) => textField(key, name, indent, flow));

  if (patch.onEnterPrompt !== undefined) {
    const instruction = patch.onEnterPrompt;
    writeColumn(stageId, ['on_enter_prompt'], (_existing, indent, key, flow) => instruction === null || instruction.trim().length === 0 ? null : textField(key, instruction, indent, flow));
  }

  if (patch.deterministic !== undefined && (patch.deterministic === null || !deterministicEqual(stage.deterministic, patch.deterministic))) {
    const definition = patch.deterministic === null ? null : parseDeterministicDefinition(patch.deterministic);
    if (definition !== null && stage.deterministic !== undefined) next = updateDeterministicFields(next, stageId, stage.deterministic, definition);
    else writeColumn(stageId, ['deterministic'], (_existing, _indent, key) => definition === null ? null : key + ': ' + JSON.stringify(definition));
  }

  if (rules !== undefined) writeColumn(stageId, ['allowed_transitions'], (existing, indent, _key, flow) => rules === null ? null : transitionsField(rules, existing, indent, flow));

  if (renamed) {
    // Renaming carries the identifier into every authored reference by replacing
    // only the scalar that names it, so comments, quoting, and order stay authored.
    const rendered = authoredScalar(newId);
    const deterministicTargets = renameDeterministicTargets(next, stageId, newId);
    next = deterministicTargets.text;
    rewrittenReferences += deterministicTargets.replaced;
    for (const column of workflow.columns) {
      if (column.id === stageId) continue;
      if (!(column.allowedTransitions ?? []).some(rule => rule.to === stageId)) continue;
      // A transition may be authored as a map or as a bare target identifier, so the
      // rename rewrites both forms: the mapped pass matches `to`, and the bare pass
      // matches the scalar entry itself.
      const mapped = replaceListScalars({ text: next, sequenceKey: 'columns', entry: { idKey: 'id', id: column.id }, fieldKey: 'allowed_transitions', innerKeys: ['to'], from: stageId, to: rendered, invalid });
      next = mapped.text;
      const bare = replaceListScalars({ text: next, sequenceKey: 'columns', entry: { idKey: 'id', id: column.id }, fieldKey: 'allowed_transitions', innerKeys: [], from: stageId, to: rendered, invalid });
      next = bare.text;
      rewrittenReferences += mapped.replaced + bare.replaced;
    }
    writeColumn(stageId, ['id'], (_existing, _indent, key) => key + ': ' + rendered);
    if (workflow.initialColumnId === stageId) {
      next = writeRootField({ text: next, fieldKeys: ['initial_column'], render: (_existing, _indent, key) => key + ': ' + rendered, invalid });
      rewrittenReferences += 1;
    }
    // A group may omit its id, so the authored entry is addressed by position: the
    // parser keeps the authored order and synthesizes an id for the missing one.
    for (const [index, group] of workflow.groups.entries()) {
      if (!group.columnIds.includes(stageId)) continue;
      const result = replaceListScalars({ text: next, sequenceKey: 'groups', entryIndex: index, fieldKey: 'columns', innerKeys: [], from: stageId, to: rendered, invalid });
      next = result.text;
      rewrittenReferences += result.replaced;
    }
    if ((workflow.connections ?? []).some(layout => layout.from === stageId || layout.to === stageId)) {
      const result = replaceListScalars({ text: next, sequenceKey: 'connections', innerKeys: ['from', 'to'], from: stageId, to: rendered, invalid });
      next = result.text;
      rewrittenReferences += result.replaced;
    }
  }

  if (patch.initial === true && workflow.initialColumnId !== newId) {
    next = writeRootField({ text: next, fieldKeys: ['initial_column'], render: (_existing, _indent, key) => key + ': ' + authoredScalar(newId), invalid });
  }

  parseWorkflow(next);
  return renamed
    ? { text: next, renamedFrom: stageId, renamedTo: newId, rewrittenReferences }
    : { text: next, rewrittenReferences };
}
