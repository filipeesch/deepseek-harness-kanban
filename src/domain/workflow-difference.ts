import type { ConnectionLayout, Column, ColumnGroup, TransitionRule, Workflow } from '../shared/types.js';
import { canonicalDeterministic } from './deterministic-definition.js';
import { connectionKey } from './connection-anchor.js';

/** One field whose value differs between two workflows. */
export interface FieldChange {
  readonly field: string;
  readonly from: unknown;
  readonly to: unknown;
}

/** What happened to one stage between two workflows. */
export interface StageDifference {
  readonly stage: string;
  readonly change: 'added' | 'removed' | 'changed';
  readonly fields?: readonly FieldChange[];
}

/** What happened to one group between two workflows. */
export interface GroupDifference {
  readonly group: string;
  readonly change: 'added' | 'removed' | 'changed';
  readonly fields?: readonly FieldChange[];
}

/** What happened to one drawn connection's authored layout. */
export interface ConnectionDifference {
  readonly from: string;
  readonly to: string;
  readonly change: 'set' | 'removed';
}

/** The semantic difference between two workflow documents. */
export interface WorkflowDifference {
  readonly workflow: readonly FieldChange[];
  readonly stages: readonly StageDifference[];
  readonly groups: readonly GroupDifference[];
  readonly connections: readonly ConnectionDifference[];
}

const EMPTY: WorkflowDifference = { workflow: [], stages: [], groups: [], connections: [] };

function rulesOf(column: Column): TransitionRule[] | null {
  return column.allowedTransitions === undefined ? null : column.allowedTransitions.map(rule => ({ ...rule }));
}

function signature(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function stageFields(before: Column, after: Column): FieldChange[] {
  const fields: FieldChange[] = [];
  const add = (field: string, from: unknown, to: unknown) => { if (signature(from) !== signature(to)) fields.push({ field, from: from ?? null, to: to ?? null }); };
  add('key', before.key, after.key);
  add('name', before.name, after.name);
  add('onEnterPrompt', before.onEnterPrompt, after.onEnterPrompt);
  add('allowedTransitions', rulesOf(before), rulesOf(after));
  add('deterministic', canonicalDeterministic(before.deterministic), canonicalDeterministic(after.deterministic));
  add('position', before.position, after.position);
  add('size', before.size, after.size);
  return fields;
}

function groupFields(before: ColumnGroup, after: ColumnGroup): FieldChange[] {
  const fields: FieldChange[] = [];
  const add = (field: string, from: unknown, to: unknown) => { if (signature(from) !== signature(to)) fields.push({ field, from, to }); };
  add('name', before.name, after.name);
  add('columns', [...before.columnIds], [...after.columnIds]);
  return fields;
}

/**
 * The semantic difference between two workflow documents, by stage, group, and
 * connection. A null `before` means there is no earlier document, so every stage,
 * group, and connection of `after` reads as added; the caller decides whether
 * that is a creation or a replacement. Comment-only and formatting-only edits
 * produce an empty difference, which is the truthful answer.
 */
export function diffWorkflow(before: Workflow | null, after: Workflow): WorkflowDifference {
  if (before === null) {
    return {
      workflow: [],
      stages: after.columns.map(column => ({ stage: column.id, change: 'added' as const })),
      groups: after.groups.map(group => ({ group: group.id, change: 'added' as const })),
      connections: (after.connections ?? []).map(layout => ({ from: layout.from, to: layout.to, change: 'set' as const })),
    };
  }
  const workflow: FieldChange[] = [];
  const addWorkflow = (field: string, from: unknown, to: unknown) => { if (signature(from) !== signature(to)) workflow.push({ field, from: from ?? null, to: to ?? null }); };
  addWorkflow('name', before.name, after.name);
  addWorkflow('initialColumnId', before.initialColumnId, after.initialColumnId);
  addWorkflow('defaultView', before.defaultView, after.defaultView);
  addWorkflow('model', before.model, after.model);

  const beforeColumns = new Map(before.columns.map(column => [column.id, column]));
  const afterColumns = new Map(after.columns.map(column => [column.id, column]));
  const stages: StageDifference[] = [];
  for (const column of before.columns) {
    if (afterColumns.has(column.id)) continue;
    stages.push({ stage: column.id, change: 'removed' });
  }
  for (const column of after.columns) {
    const previous = beforeColumns.get(column.id);
    if (previous === undefined) { stages.push({ stage: column.id, change: 'added' }); continue; }
    const fields = stageFields(previous, column);
    if (fields.length > 0) stages.push({ stage: column.id, change: 'changed', fields });
  }

  const beforeGroups = new Map(before.groups.map(group => [group.id, group]));
  const afterGroups = new Map(after.groups.map(group => [group.id, group]));
  const groups: GroupDifference[] = [];
  for (const group of before.groups) {
    if (afterGroups.has(group.id)) continue;
    groups.push({ group: group.id, change: 'removed' });
  }
  for (const group of after.groups) {
    const previous = beforeGroups.get(group.id);
    if (previous === undefined) { groups.push({ group: group.id, change: 'added' }); continue; }
    const fields = groupFields(previous, group);
    if (fields.length > 0) groups.push({ group: group.id, change: 'changed', fields });
  }

  const beforeConnections = new Map((before.connections ?? []).map(layout => [connectionKey(layout.from, layout.to), layout]));
  const afterConnections = new Map((after.connections ?? []).map(layout => [connectionKey(layout.from, layout.to), layout]));
  const connections: ConnectionDifference[] = [];
  for (const [key, layout] of afterConnections) {
    if (signature(beforeConnections.get(key)) !== signature(layout)) connections.push({ from: layout.from, to: layout.to, change: 'set' });
  }
  for (const [key, layout] of beforeConnections) {
    if (!afterConnections.has(key)) connections.push({ from: layout.from, to: layout.to, change: 'removed' });
  }
  return { workflow, stages, groups, connections };
}

/** True when two documents say the same thing, whatever their text looks like. */
export function isWorkflowDifferenceEmpty(difference: WorkflowDifference): boolean {
  return difference.workflow.length === 0 && difference.stages.length === 0 && difference.groups.length === 0 && difference.connections.length === 0;
}

/** The difference a caller that has no earlier document reports. */
export function addedWorkflow(after: Workflow): WorkflowDifference {
  return diffWorkflow(null, after);
}

/** `connection` layouts read back from one document, keyed for comparison. */
export function connectionLayouts(workflow: Workflow): Map<string, ConnectionLayout> {
  return new Map((workflow.connections ?? []).map(layout => [connectionKey(layout.from, layout.to), layout]));
}
