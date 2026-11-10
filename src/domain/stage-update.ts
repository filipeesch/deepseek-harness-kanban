import type { StagePatch, TransitionRule } from '../shared/types.js';
import { KanbanError } from '../shared/errors.js';
import { isDomainId } from './validation.js';
import { parseWorkflow } from './workflow.js';
import { replaceListScalars, writeRootField, writeSequenceItemField } from './yaml-map-fields.js';

/** One stage edit: the authored workflow text, the stage it targets, and the fields it changes. */
export interface StageUpdateInput {
  readonly text: string;
  readonly stageId: string;
  readonly patch: StagePatch;
}

/** The task references one stage identifier owns; the caller keeps the rest of the task. */
export interface StageReferencingTask {
  columnId: string;
  pendingTransition?: { fromColumnId: string; columnId: string };
  recordedTransition?: { fromColumnId: string; columnId: string };
  instructionPending?: { columnId: string };
}

/**
 * Carry a renamed stage identifier into one task's references. The caller decides
 * which tasks may migrate; a task whose work is in flight never reaches this call.
 */
export function renameTaskStage(task: StageReferencingTask, from: string, to: string): boolean {
  let changed = false;
  if (task.columnId === from) { task.columnId = to; changed = true; }
  if (task.pendingTransition !== undefined) {
    if (task.pendingTransition.fromColumnId === from) { task.pendingTransition.fromColumnId = to; changed = true; }
    if (task.pendingTransition.columnId === from) { task.pendingTransition.columnId = to; changed = true; }
  }
  if (task.recordedTransition !== undefined) {
    if (task.recordedTransition.fromColumnId === from) { task.recordedTransition.fromColumnId = to; changed = true; }
    if (task.recordedTransition.columnId === from) { task.recordedTransition.columnId = to; changed = true; }
  }
  if (task.instructionPending !== undefined && task.instructionPending.columnId === from) { task.instructionPending.columnId = to; changed = true; }
  return changed;
}

/** What one stage edit changed, so the caller can migrate its own task data. */
export interface StageUpdateResult {
  readonly text: string;
  readonly renamedFrom?: string;
  readonly renamedTo?: string;
  /** How many authored references to a renamed identifier were rewritten. */
  readonly rewrittenReferences: number;
}

const PLAIN_SCALAR = /^[A-Za-z0-9][A-Za-z0-9 ._/@-]*$/;
const RESERVED_SCALAR = /^(true|false|null|yes|no|on|off|~)$/i;

function invalid(message: string): never {
  throw new KanbanError('INVALID_WORKFLOW', message);
}

function scalar(value: string): string {
  if (PLAIN_SCALAR.test(value) && !RESERVED_SCALAR.test(value) && !/^-?\d/.test(value)) return value;
  if (/["\\\u0000-\u001f]/.test(value)) return JSON.stringify(value);
  return "'" + value.replace(/'/g, "''") + "'";
}

/** Render one authored text field, using a block scalar when the value spans lines. */
function textField(key: string, value: string, indent: string, flow: boolean): string {
  // A flow mapping cannot hold a block scalar, so a multiline value is quoted there.
  if (flow) return key + ': ' + scalar(value);
  if (!value.includes('\n')) return key + ': ' + scalar(value);
  const lines = value.split('\n');
  const trailingNewline = value.endsWith('\n');
  const body = trailingNewline ? lines.slice(0, -1) : lines;
  const blockSafe = body.every(line => !line.startsWith(' ') && !line.endsWith(' ') && !line.includes(String.fromCharCode(9)) && !/[\u0000-\u0008\u000b-\u001f]/.test(line));
  if (!blockSafe) return key + ': ' + JSON.stringify(value);
  return key + ': ' + (trailingNewline ? '|' : '|-') + '\n' + body.map(line => indent + '  ' + line).join('\n');
}

function transitionsField(rules: readonly TransitionRule[], existing: unknown, indent: string, parentFlow: boolean): string | null {
  if (rules.length === 0) return null;
  // A flow mapping can only hold a flow sequence, and a stored flow list stays flow.
  const flow = parentFlow || (existing as { flow?: boolean } | null)?.flow === true;
  if (flow) {
    const items = rules.map(rule => rule.when === undefined ? '{to: ' + scalar(rule.to) + '}' : '{to: ' + scalar(rule.to) + ', when: ' + scalar(rule.when) + '}');
    return 'allowed_transitions: [' + items.join(', ') + ']';
  }
  const lines = rules.map(rule => indent + '  - to: ' + scalar(rule.to) + (rule.when === undefined ? '' : '\n' + indent + '    when: ' + scalar(rule.when)));
  return 'allowed_transitions:\n' + lines.join('\n');
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
      if (rules.length === 0) invalid('A restricted stage must allow at least one destination.');
      for (const rule of rules) {
        if (!isDomainId(rule.to)) invalid('A transition target must be a safe identifier.');
        if (rule.to === newId) invalid('A stage cannot be its own transition target.');
        if (!others.has(rule.to)) invalid('Transition target ' + rule.to + ' is not a stage of this workflow.');
      }
    }
  }

  let next = text;
  let rewrittenReferences = 0;
  const writeColumn = (id: string, fieldKeys: readonly string[], render: Parameters<typeof writeSequenceItemField>[0]['render']) => {
    next = writeSequenceItemField({ text: next, sequenceKey: 'columns', idKey: 'id', id, fieldKeys, render, invalid });
  };

  if (name !== undefined) writeColumn(stageId, ['label', 'name'], (_existing, indent, key, flow) => textField(key, name, indent, flow));

  if (patch.onEnterPrompt !== undefined) {
    const instruction = patch.onEnterPrompt;
    writeColumn(stageId, ['on_enter_prompt'], (_existing, indent, key, flow) => instruction === null || instruction.trim().length === 0 ? null : textField(key, instruction, indent, flow));
  }

  if (rules !== undefined) writeColumn(stageId, ['allowed_transitions'], (existing, indent, _key, flow) => transitionsField(rules ?? [], existing, indent, flow));

  if (renamed) {
    // Renaming carries the identifier into every authored reference by replacing
    // only the scalar that names it, so comments, quoting, and order stay authored.
    const rendered = scalar(newId);
    for (const column of workflow.columns) {
      if (column.id === stageId) continue;
      if (!(column.allowedTransitions ?? []).some(rule => rule.to === stageId)) continue;
      const result = replaceListScalars({ text: next, sequenceKey: 'columns', entry: { idKey: 'id', id: column.id }, fieldKey: 'allowed_transitions', innerKeys: ['to'], from: stageId, to: rendered, invalid });
      next = result.text;
      rewrittenReferences += result.replaced;
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
    next = writeRootField({ text: next, fieldKeys: ['initial_column'], render: (_existing, _indent, key) => key + ': ' + scalar(newId), invalid });
  }

  parseWorkflow(next);
  return renamed
    ? { text: next, renamedFrom: stageId, renamedTo: newId, rewrittenReferences }
    : { text: next, rewrittenReferences };
}
