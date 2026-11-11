import { randomUUID } from 'node:crypto';
import type { ConnectionLayout, TransitionRule, Workflow } from '../../shared/types.js';
import { connectionKey } from '../connection-anchor.js';
import { transitionRule } from '../transition-rule.js';
import { parseWorkflow } from '../workflow.js';
import { assignStageIdentities, seedStageIdentities, stageIdentitySeeds } from '../stage-identity.js';
import type { BoardChange, StageDefinition } from './event.js';

/**
 * Derive the changes that carry one board from its last published state to its
 * current state.
 *
 * Publishing derives rather than records, so no write path has to remember to emit
 * an event: the worst case is a coarser difference, never a missing fact. A board
 * with no previous state is published whole.
 *
 * The local stage identities are *matched*, never re-seeded: a local edit that lost
 * its authored identity fields keeps the identity its identifier already held, which
 * is what makes a whole-workflow replacement an ordinary change instead of a removal
 * of every stage followed by a creation of every stage.
 *
 * Cross-references are compared through the stable identity, so a rename is one
 * event and never a ripple through groups, connections, or the initial stage. The
 * emitted values name the identifiers the board has after the change, which is what
 * the reducer sees once it has applied the rename.
 */

export interface BoardVersion {
  readonly text: string;
}

export interface DeriveOptions {
  /** Allocates the identity of a stage this installation has never seen. */
  readonly allocate?: () => string;
}

function definition(stage: Workflow['columns'][number]): StageDefinition {
  const result: StageDefinition = { id: stage.id, key: stage.key!, name: stage.name };
  if (stage.onEnterPrompt !== undefined) result.onEnterPrompt = stage.onEnterPrompt;
  if (stage.allowedTransitions !== undefined) result.allowedTransitions = stage.allowedTransitions.map(rule => cloneRule(rule));
  if (stage.position !== undefined) result.position = { ...stage.position };
  if (stage.size !== undefined) result.size = { ...stage.size };
  return result;
}

function cloneRule(rule: TransitionRule): TransitionRule {
  return rule.when === undefined ? { to: rule.to } : { to: rule.to, when: rule.when };
}

/** The stable identity behind one authored identifier, so a rename is not a change. */
function identity(map: ReadonlyMap<string, string>, id: string): string {
  return map.get(id) ?? id;
}

function rulesSignature(value: readonly TransitionRule[] | undefined, map: ReadonlyMap<string, string>): string {
  return JSON.stringify((value ?? []).map(rule => [identity(map, rule.to), transitionRule(rule.to, rule.when).when ?? null]));
}

function layoutSignature(value: { position?: { x: number; y: number }; size?: { width: number; height: number } }): string {
  return JSON.stringify([value.position ?? null, value.size ?? null]);
}

function cloneLayout(layoutValue: ConnectionLayout): ConnectionLayout {
  const copy: ConnectionLayout = { from: layoutValue.from, to: layoutValue.to };
  if (layoutValue.source !== undefined) copy.source = { ...layoutValue.source };
  if (layoutValue.target !== undefined) copy.target = { ...layoutValue.target };
  if (layoutValue.segments !== undefined) copy.segments = layoutValue.segments.map(segment => ({ ...segment }));
  return copy;
}

function identityMap(workflow: Workflow): Map<string, string> {
  return new Map(workflow.columns.map(column => [column.id, column.key!]));
}

/** Derive the changes that turn the published board into the local board. */
export function deriveChanges(previous: BoardVersion | null, local: BoardVersion, options: DeriveOptions = {}): BoardChange[] {
  if (previous === null) return local.text.trim().length === 0 ? [] : [{ kind: 'workflow.replaced', text: local.text }];
  if (previous.text === local.text) return [];
  // A published stage without an authored identity predates the identity model (or was
  // hand-edited), so its identifier is its genesis identity. Seeding fills only the
  // missing ones, so a partially keyed state is handled like a fully keyed one instead
  // of leaving a column without an identity to diff.
  const before = seedStageIdentities(parseWorkflow(previous.text));
  const after = assignStageIdentities({
    workflow: parseWorkflow(local.text),
    previous: stageIdentitySeeds(before),
    allocate: options.allocate ?? (() => randomUUID()),
  });

  const changes: BoardChange[] = [];
  const beforeById = new Map(before.columns.map(column => [column.key!, column]));
  const afterById = new Map(after.columns.map(column => [column.key!, column]));
  const beforeIdentity = identityMap(before);
  const afterIdentity = identityMap(after);

  if (before.name !== after.name) changes.push({ kind: 'workflow.field-changed', field: 'name', value: after.name });
  if (before.defaultView !== after.defaultView) changes.push({ kind: 'workflow.field-changed', field: 'defaultView', value: after.defaultView ?? null });

  // A removal is derived first: a batch may reuse an identifier a removed stage held,
  // and applying the creation before the removal would duplicate it.
  for (const column of before.columns) if (!afterById.has(column.key!)) changes.push({ kind: 'stage.removed', key: column.key! });

  for (const column of after.columns) {
    const previousColumn = beforeById.get(column.key!);
    if (previousColumn === undefined) { changes.push({ kind: 'stage.created', stage: definition(column) }); continue; }
    if (previousColumn.id !== column.id) changes.push({ kind: 'stage.id-changed', key: column.key!, from: previousColumn.id, id: column.id });
    if (previousColumn.name !== column.name) changes.push({ kind: 'stage.field-changed', key: column.key!, field: 'name', value: column.name });
    if ((previousColumn.onEnterPrompt ?? null) !== (column.onEnterPrompt ?? null)) {
      changes.push({ kind: 'stage.field-changed', key: column.key!, field: 'onEnterPrompt', value: column.onEnterPrompt ?? null });
    }
    if (rulesSignature(previousColumn.allowedTransitions, beforeIdentity) !== rulesSignature(column.allowedTransitions, afterIdentity)) {
      changes.push({
        kind: 'stage.field-changed', key: column.key!, field: 'allowedTransitions',
        value: column.allowedTransitions === undefined ? null : column.allowedTransitions.map(rule => cloneRule(rule)),
      });
    }
    if (layoutSignature(previousColumn) !== layoutSignature(column)) {
      changes.push({
        kind: 'stage.layout-set', key: column.key!,
        position: column.position === undefined ? null : { ...column.position },
        size: column.size === undefined ? null : { ...column.size },
      });
    }
  }

  const beforeGroups = new Map(before.groups.map(group => [group.id, group]));
  const afterGroups = new Map(after.groups.map(group => [group.id, group]));
  for (const group of after.groups) {
    const previousGroup = beforeGroups.get(group.id);
    if (previousGroup === undefined) { changes.push({ kind: 'group.created', group: { id: group.id, name: group.name, columnIds: [...group.columnIds] } }); continue; }
    if (previousGroup.name !== group.name) changes.push({ kind: 'group.field-changed', id: group.id, field: 'name', value: group.name });
    const beforeMembers = previousGroup.columnIds.map(member => identity(beforeIdentity, member)).join('\u0000');
    const afterMembers = group.columnIds.map(member => identity(afterIdentity, member)).join('\u0000');
    if (beforeMembers !== afterMembers) changes.push({ kind: 'group.field-changed', id: group.id, field: 'columns', value: [...group.columnIds] });
  }
  for (const group of before.groups) if (!afterGroups.has(group.id)) changes.push({ kind: 'group.removed', id: group.id });

  const beforeConnections = new Map((before.connections ?? []).map(item => [connectionKey(identity(beforeIdentity, item.from), identity(beforeIdentity, item.to)), item]));
  const afterConnections = new Map((after.connections ?? []).map(item => [connectionKey(identity(afterIdentity, item.from), identity(afterIdentity, item.to)), item]));
  // The layout is compared through the stable identity too, so a rename alone never
  // rewrites the connection entry.
  const connectionSignature = (value: ConnectionLayout, map: ReadonlyMap<string, string>): string => JSON.stringify([
    identity(map, value.from), identity(map, value.to),
    value.source ?? null, value.target ?? null, value.segments ?? null,
  ]);
  for (const [key, item] of afterConnections) {
    const previousItem = beforeConnections.get(key);
    if (previousItem !== undefined && connectionSignature(previousItem, beforeIdentity) === connectionSignature(item, afterIdentity)) continue;
    changes.push({ kind: 'connection.set', layout: cloneLayout(item) });
  }
  // A removal addresses the identifiers the board has now, because the rename that
  // preceded it already moved the authored entry.
  const afterIdOf = new Map(after.columns.map(column => [column.key!, column.id]));
  const now = (id: string): string => {
    const key = beforeIdentity.get(id);
    return key === undefined ? id : (afterIdOf.get(key) ?? id);
  };
  for (const [key, item] of beforeConnections) {
    if (afterConnections.has(key)) continue;
    changes.push({ kind: 'connection.removed', from: now(item.from), to: now(item.to) });
  }

  if (identity(beforeIdentity, before.initialColumnId) !== identity(afterIdentity, after.initialColumnId)) {
    changes.push({ kind: 'workflow.initial-changed', columnId: after.initialColumnId });
  }
  return changes;
}
