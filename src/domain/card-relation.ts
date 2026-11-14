import type { HubRelation, HubRelationType, HubState } from '../shared/types.js';

/** Defensive limits that keep one write and one roll-up bounded. */
export const MAX_RELATIONS_PER_WRITE = 100;
export const EPIC_ROLLUP_LIMIT = 50;

/** How a relation reads from one of its endpoints. */
export type RelationDirection = 'outgoing' | 'incoming' | 'symmetric';

/** One relation as a card read reports it: the edge and the task at the other end. */
export interface RelationReference {
  id: string;
  type: HubRelationType;
  direction: RelationDirection;
  otherTaskId: string;
}

/** One rejected relation, addressed by its position in the relation collection. */
export interface RelationIssue {
  path: (string | number)[];
  message: string;
}

/**
 * The stored endpoint order. A symmetric relation has one canonical pair, so a
 * reverse request addresses the same edge instead of creating a second one.
 */
export function canonicalEndpoints(type: HubRelationType, from: string, to: string): { from: string; to: string } {
  return type === 'related' && to < from ? { from: to, to: from } : { from, to };
}

export function relationDirection(relation: Pick<HubRelation, 'type' | 'from'>, taskId: string): RelationDirection {
  if (relation.type === 'related') return 'symmetric';
  return relation.from === taskId ? 'outgoing' : 'incoming';
}

export function otherEndpoint(relation: HubRelation, taskId: string): string {
  return relation.from === taskId ? relation.to : relation.from;
}

/** One relation as a task reads it: never the task itself as the other endpoint. */
export function relationReference(relation: HubRelation, taskId: string): RelationReference {
  return {
    id: relation.id,
    type: relation.type,
    direction: relationDirection(relation, taskId),
    otherTaskId: otherEndpoint(relation, taskId),
  };
}

const EMPTY_RELATIONS: readonly HubRelation[] = [];
const indexes = new WeakMap<readonly HubRelation[], ReadonlyMap<string, readonly HubRelation[]>>();

/**
 * The relation collection indexed by endpoint. The index is keyed on the array it
 * was built from, and every accepted write replaces that array, so an in-place
 * mutation can never serve a stale index to a read.
 */
export function relationIndex(relations: readonly HubRelation[]): ReadonlyMap<string, readonly HubRelation[]> {
  const cached = indexes.get(relations);
  if (cached !== undefined) return cached;
  const index = new Map<string, HubRelation[]>();
  for (const relation of relations) {
    for (const taskId of new Set([relation.from, relation.to])) {
      const list = index.get(taskId);
      if (list === undefined) index.set(taskId, [relation]);
      else list.push(relation);
    }
  }
  indexes.set(relations, index);
  return index;
}

/** Every relation one task takes part in, in stored order. */
export function relationsOf(hub: HubState, taskId: string): readonly HubRelation[] {
  return relationIndex(hub.relations ?? EMPTY_RELATIONS).get(taskId) ?? [];
}

/** The direct children of one epic, in stored order. */
export function epicChildren(hub: HubState, taskId: string): readonly HubRelation[] {
  return relationsOf(hub, taskId).filter(relation => relation.type === 'epic' && relation.from === taskId);
}

/** The epics one task belongs to. */
export function epicParents(hub: HubState, taskId: string): readonly HubRelation[] {
  return relationsOf(hub, taskId).filter(relation => relation.type === 'epic' && relation.to === taskId);
}

/** True when the stored pair for this type and these endpoints already exists. */
export function findExistingRelation(relations: readonly HubRelation[], type: HubRelationType, from: string, to: string): HubRelation | undefined {
  const endpoints = canonicalEndpoints(type, from, to);
  return relations.find(relation => relation.type === type && relation.from === endpoints.from && relation.to === endpoints.to);
}

/**
 * The epic cycle this collection closes on, if any. The walk uses an explicit
 * stack so a pathological chain of nested epics cannot exhaust the call stack
 * during a Hub validation.
 */
export function epicCyclePath(relations: readonly HubRelation[]): string[] | undefined {
  const children = new Map<string, string[]>();
  for (const relation of relations) {
    if (relation.type !== 'epic') continue;
    const list = children.get(relation.from);
    if (list === undefined) children.set(relation.from, [relation.to]);
    else list.push(relation.to);
  }
  const settled = new Set<string>();
  for (const start of children.keys()) {
    if (settled.has(start)) continue;
    const path: string[] = [start];
    const onPath = new Set<string>([start]);
    const stack: Array<{ taskId: string; next: number }> = [{ taskId: start, next: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const nextEdges = children.get(frame.taskId);
      if (nextEdges === undefined || frame.next >= nextEdges.length) {
        settled.add(frame.taskId);
        onPath.delete(frame.taskId);
        path.pop();
        stack.pop();
        continue;
      }
      const child = nextEdges[frame.next]!;
      frame.next += 1;
      if (onPath.has(child)) return [...path.slice(path.indexOf(child)), child];
      if (settled.has(child)) continue;
      onPath.add(child);
      path.push(child);
      stack.push({ taskId: child, next: 0 });
    }
  }
  return undefined;
}

/**
 * Every reason a relation collection cannot be stored: an endpoint that names no
 * task of the Hub, an edge from a task to itself, and an epic cycle. The Hub
 * aggregate and the relation write share this pass so one rule has one home; the
 * unique-identifier rule belongs to the stored schema, which already states it.
 */
export function relationIssues(taskIds: ReadonlySet<string>, relations: readonly HubRelation[]): RelationIssue[] {
  const issues: RelationIssue[] = [];
  for (const [index, relation] of relations.entries()) {
    for (const key of ['from', 'to'] as const) {
      if (!taskIds.has(relation[key])) issues.push({ path: [index, key], message: 'Relation task does not exist in this Hub.' });
    }
    if (relation.from === relation.to) issues.push({ path: [index, 'to'], message: 'A relation cannot target its own task.' });
  }
  const cycle = epicCyclePath(relations);
  if (cycle !== undefined) {
    const index = relations.findIndex(relation => relation.type === 'epic' && relation.from === cycle[0] && relation.to === cycle[1]);
    issues.push({ path: [index < 0 ? 'relations' : index, 'to'], message: 'Epic relations cannot form a cycle: ' + cycle.join(' -> ') + '.' });
  }
  return issues;
}

/** The message of the first rejected relation, or undefined when the collection is valid. */
export function firstRelationProblem(taskIds: ReadonlySet<string>, relations: readonly HubRelation[]): string | undefined {
  return relationIssues(taskIds, relations)[0]?.message;
}
