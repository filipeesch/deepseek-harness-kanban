import { describe, expect, it } from 'vitest';
import * as operations from '../../src/domain/hub-operations.js';
import { canonicalEndpoints, epicCyclePath, relationDirection, relationIndex, relationReference, relationsOf } from '../../src/domain/card-relation.js';
import { HubStateSchema } from '../../src/domain/hub-schema.js';
import type { HubRelation, HubState } from '../../src/shared/types.js';
import { operationDeps, sampleHub } from './hub-helpers.js';

/** A Hub with the requested tasks, already in its initial stage. */
function hubWithTasks(count: number): { hub: HubState; deps: ReturnType<typeof operationDeps>; ids: string[] } {
  const hub = sampleHub();
  const deps = operationDeps();
  for (let index = 0; index < count; index += 1) {
    operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'Task ' + index, description: '' }, deps);
  }
  return { hub, deps, ids: hub.tasks.map(task => task.id) };
}

describe('relation endpoints', () => {
  it('keeps a directed pair as written and canonicalizes a symmetric pair', () => {
    expect(canonicalEndpoints('epic', 'b', 'a')).toEqual({ from: 'b', to: 'a' });
    expect(canonicalEndpoints('related', 'b', 'a')).toEqual({ from: 'a', to: 'b' });
    expect(canonicalEndpoints('related', 'a', 'b')).toEqual({ from: 'a', to: 'b' });
  });

  it('derives the direction each endpoint reads', () => {
    const epic: HubRelation = { id: 'r', type: 'epic', from: 'a', to: 'b' };
    const related: HubRelation = { id: 'r2', type: 'related', from: 'a', to: 'b' };
    expect(relationDirection(epic, 'a')).toBe('outgoing');
    expect(relationDirection(epic, 'b')).toBe('incoming');
    expect(relationDirection(related, 'a')).toBe('symmetric');
  });
});

describe('relation index', () => {
  it('reports both directions of a stored relation', () => {
    const { hub, deps, ids } = hubWithTasks(2);
    operations.createRelations(hub, [{ type: 'epic', from: ids[0]!, to: ids[1]! }], deps);
    expect(relationsOf(hub, ids[0]!)).toHaveLength(1);
    expect(relationsOf(hub, ids[1]!)).toHaveLength(1);
    expect(relationIndex(hub.relations ?? []).get(ids[0]!)?.[0]?.type).toBe('epic');
    expect(relationIndex(hub.relations ?? []).get('unknown')).toBeUndefined();
  });

  it('reads a symmetric relation the same from the card at either end', () => {
    const { hub, deps, ids } = hubWithTasks(2);
    const [relation] = operations.createRelations(hub, [{ type: 'related', from: ids[0]!, to: ids[1]! }], deps);
    expect(relationReference(relation!, ids[0]!)).toEqual({ id: relation!.id, type: 'related', direction: 'symmetric', otherTaskId: ids[1] });
    expect(relationReference(relation!, ids[1]!)).toEqual({ id: relation!.id, type: 'related', direction: 'symmetric', otherTaskId: ids[0] });
  });

  it('stores many epic relations for one card, in both directions', () => {
    const { hub, deps, ids } = hubWithTasks(6);
    operations.createRelations(hub, [
      { type: 'epic', from: ids[0]!, to: ids[2]! },
      { type: 'epic', from: ids[1]!, to: ids[2]! },
      { type: 'epic', from: ids[2]!, to: ids[3]! },
      { type: 'epic', from: ids[2]!, to: ids[4]! },
      { type: 'epic', from: ids[2]!, to: ids[5]! },
    ], deps);
    const relations = relationsOf(hub, ids[2]!);
    expect(relations.filter(relation => relation.to === ids[2])).toHaveLength(2);
    expect(relations.filter(relation => relation.from === ids[2])).toHaveLength(3);
    expect(HubStateSchema.safeParse(hub).success).toBe(true);
  });
});

describe('relation writes', () => {
  it('stores a batch and keeps the Hub aggregate valid', () => {
    const { hub, deps, ids } = hubWithTasks(3);
    const written = operations.createRelations(hub, [
      { type: 'epic', from: ids[0]!, to: ids[1]! },
      { type: 'epic', from: ids[0]!, to: ids[2]! },
    ], deps);
    expect(written).toHaveLength(2);
    expect(written.every(relation => relation.id.length > 0)).toBe(true);
    expect(hub.relations).toHaveLength(2);
    expect(HubStateSchema.safeParse(hub).success).toBe(true);
  });

  it('returns the stored relation when the reverse symmetric pair is requested', () => {
    const { hub, deps, ids } = hubWithTasks(2);
    const first = operations.createRelations(hub, [{ type: 'related', from: ids[0]!, to: ids[1]! }], deps);
    const second = operations.createRelations(hub, [{ type: 'related', from: ids[1]!, to: ids[0]! }], deps);
    expect(second[0]!.id).toBe(first[0]!.id);
    expect(hub.relations).toHaveLength(1);
  });

  it('rejects a relation from a task to itself', () => {
    const { hub, deps, ids } = hubWithTasks(1);
    expect(() => operations.createRelations(hub, [{ type: 'epic', from: ids[0]!, to: ids[0]! }], deps)).toThrowError(/own task/);
    expect(hub.relations).toBeUndefined();
  });

  it('rejects an endpoint that names no task of the Hub', () => {
    const { hub, deps, ids } = hubWithTasks(1);
    expect(() => operations.createRelations(hub, [{ type: 'epic', from: ids[0]!, to: 'ghost' }], deps)).toThrowError(/does not exist/);
  });

  it('rejects a batch that would close an epic cycle and stores nothing', () => {
    const { hub, deps, ids } = hubWithTasks(3);
    operations.createRelations(hub, [{ type: 'epic', from: ids[0]!, to: ids[1]! }], deps);
    expect(() => operations.createRelations(hub, [
      { type: 'epic', from: ids[1]!, to: ids[2]! },
      { type: 'epic', from: ids[2]!, to: ids[0]! },
    ], deps)).toThrowError(/cycle/);
    expect(hub.relations).toHaveLength(1);
  });

  it('allows a diamond that is not a cycle', () => {
    const { hub, deps, ids } = hubWithTasks(4);
    operations.createRelations(hub, [
      { type: 'epic', from: ids[0]!, to: ids[1]! },
      { type: 'epic', from: ids[0]!, to: ids[2]! },
      { type: 'epic', from: ids[1]!, to: ids[3]! },
    ], deps);
    expect(HubStateSchema.safeParse(hub).success).toBe(true);
    expect(epicCyclePath(hub.relations ?? [])).toBeUndefined();
  });

  it('allows a nested epic that stays acyclic', () => {
    const { hub, deps, ids } = hubWithTasks(3);
    operations.createRelations(hub, [
      { type: 'epic', from: ids[0]!, to: ids[1]! },
      { type: 'epic', from: ids[1]!, to: ids[2]! },
    ], deps);
    expect(HubStateSchema.safeParse(hub).success).toBe(true);
  });

  it('rejects an empty batch and a batch over the accepted limit', () => {
    const { hub, deps, ids } = hubWithTasks(2);
    expect(() => operations.createRelations(hub, [], deps)).toThrowError(/at least one/);
    const oversized = Array.from({ length: 101 }, () => ({ type: 'epic' as const, from: ids[0]!, to: ids[1]! }));
    expect(() => operations.createRelations(hub, oversized, deps)).toThrowError(/At most 100/);
  });

  it('removes a batch by identifier and rejects an unknown identifier without changes', () => {
    const { hub, deps, ids } = hubWithTasks(3);
    const written = operations.createRelations(hub, [
      { type: 'epic', from: ids[0]!, to: ids[1]! },
      { type: 'epic', from: ids[0]!, to: ids[2]! },
    ], deps);
    const removed = operations.deleteRelations(hub, [written[0]!.id], deps);
    expect(removed).toHaveLength(1);
    expect(hub.relations).toHaveLength(1);
    expect(() => operations.deleteRelations(hub, [written[0]!.id, 'ghost'], deps)).toThrowError(/does not exist/);
    expect(hub.relations).toHaveLength(1);
  });
});

describe('relation lifecycle with task deletion', () => {
  it('removes every relation of the deleted task and keeps unrelated ones', () => {
    const { hub, deps, ids } = hubWithTasks(4);
    operations.createRelations(hub, [
      { type: 'epic', from: ids[0]!, to: ids[1]! },
      { type: 'related', from: ids[2]!, to: ids[3]! },
    ], deps);
    operations.deleteTask(hub, ids[0]!);
    expect(hub.relations).toHaveLength(1);
    expect(hub.relations?.[0]?.type).toBe('related');
    expect(HubStateSchema.safeParse(hub).success).toBe(true);
  });
});

describe('Hub aggregate relation validation', () => {
  it('rejects a stored relation whose endpoint task is absent', () => {
    const { hub, ids } = hubWithTasks(1);
    hub.relations = [{ id: 'relation', type: 'epic', from: ids[0]!, to: 'ghost' }];
    const parsed = HubStateSchema.safeParse(hub);
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain('Relation task does not exist');
  });

  it('rejects a stored epic cycle', () => {
    const { hub, deps, ids } = hubWithTasks(3);
    operations.createRelations(hub, [
      { type: 'epic', from: ids[0]!, to: ids[1]! },
      { type: 'epic', from: ids[1]!, to: ids[2]! },
    ], deps);
    hub.relations?.push({ id: 'closing', type: 'epic', from: ids[2]!, to: ids[0]! });
    const parsed = HubStateSchema.safeParse(hub);
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain('cycle');
  });

  it('rejects a stored relation from a task to itself', () => {
    const { hub, ids } = hubWithTasks(1);
    hub.relations = [{ id: 'self', type: 'epic', from: ids[0]!, to: ids[0]! }];
    const parsed = HubStateSchema.safeParse(hub);
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain('own task');
  });

  it('opens a Hub stored before the relation collection existed', () => {
    const { hub } = hubWithTasks(1);
    expect(hub.relations).toBeUndefined();
    expect(HubStateSchema.safeParse(hub).success).toBe(true);
  });
});
