import { z } from 'zod';
import type { Board, Column, Workflow } from '../shared/types.js';
import type { ScriptedTarget } from '../shared/scripted.js';
import { isDomainId } from './validation.js';

const id = z.string().refine(isDomainId);

/** What a previous version of a workflow knew about one stage's identity. */
export interface StageIdentitySeed {
  readonly id: string;
  readonly key?: string;
}

/**
 * Give every stage of a workflow a stable identity.
 *
 * Authored identities win, because a board that carries them has already been
 * published and an edit must not move an identity from one stage to another. A
 * stage that lost its authored identity, which is what a handwritten whole-workflow
 * replacement produces, reuses the identity its previous authored identifier held.
 * Every other stage gets a freshly allocated identity.
 *
 * The result is a new workflow; the input is never mutated.
 */
export function assignStageIdentities(input: {
  readonly workflow: Workflow;
  readonly previous?: readonly StageIdentitySeed[];
  readonly allocate: () => string;
}): Workflow {
  const used = new Set<string>();
  const assigned = new Map<number, string>();

  // 1. An authored identity is the strongest claim: keep it, in authored order.
  input.workflow.columns.forEach((column, index) => {
    if (column.key === undefined || !isDomainId(column.key) || used.has(column.key)) return;
    used.add(column.key);
    assigned.set(index, column.key);
  });

  // 2. A stage with no authored identity inherits the one its identifier held.
  const previousById = new Map<string, string>();
  for (const seed of input.previous ?? []) {
    if (seed.key === undefined || !isDomainId(seed.key) || previousById.has(seed.id)) continue;
    previousById.set(seed.id, seed.key);
  }
  input.workflow.columns.forEach((column, index) => {
    if (assigned.has(index)) return;
    const inherited = previousById.get(column.id);
    if (inherited === undefined || used.has(inherited)) return;
    used.add(inherited);
    assigned.set(index, inherited);
  });

  // 3. Anything left is a stage this installation has never seen.
  const allocate = (): string => {
    for (let attempt = 0; attempt < 10_000; attempt++) {
      const candidate = input.allocate();
      if (isDomainId(candidate) && !used.has(candidate)) {
        used.add(candidate);
        return candidate;
      }
    }
    throw new Error('Could not allocate a stage identity.');
  };
  const columns = input.workflow.columns.map((column, index) => {
    const key = assigned.get(index) ?? allocate();
    return column.key === key ? column : { ...column, key };
  });
  return { ...input.workflow, columns, ...(input.workflow.connections === undefined ? {} : { connections: input.workflow.connections }) };
}

/**
 * Give every stage the identity its authored identifier names, which is the
 * scripted genesis used when a workflow arrives without identities. Two
 * installations reading the same document derive the same identities.
 */
export function seedStageIdentities(workflow: Workflow): Workflow {
  if (workflow.columns.every(column => column.key !== undefined)) return workflow;
  return { ...workflow, columns: workflow.columns.map(column => (column.key === undefined ? { ...column, key: column.id } : column)) };
}

/** Every stage identity a workflow carries, which is what a later match reads. */
export function stageIdentitySeeds(workflow: Workflow): StageIdentitySeed[] {
  return workflow.columns.map(column => (column.key === undefined ? { id: column.id } : { id: column.id, key: column.key }));
}
/** The stored association between an authored stage identifier and its stable local identity. */
export const localStageIdentitiesSchema = z.record(id, id).refine(value => new Set(Object.values(value)).size === Object.keys(value).length, 'Local stage associations must be unique.');

/** One stage destination frozen as an identity, never as a reusable authored identifier. */
export const stageTargetSchema = z.strictObject({ columnId: id, stageIdentity: id });

/** Resolve a captured identity, never a newly reused authored identifier. */
export function resolveStageTarget(board: Pick<Board, 'workflow' | 'localStageIdentities'>, target: ScriptedTarget): Column | undefined {
  return board.workflow.columns.find(column => (board.localStageIdentities?.[column.id] ?? column.key) === target.stageIdentity);
}

/** Reconcile only existing associations; a removed/recreated identifier receives a fresh identity. */
export function reconcileLocalStageIdentities(board: Pick<Board, 'workflow' | 'localStageIdentities'>, next: Workflow): void {
  if (board.localStageIdentities === undefined) return;
  const previous = board.workflow.columns;
  const mapping: Record<string, string> = {};
  for (const column of next.columns) {
    const old = previous.find(item => column.key !== undefined && item.key === column.key) ?? previous.find(item => item.id === column.id && item.key === undefined);
    if (old !== undefined && board.localStageIdentities[old.id] !== undefined) mapping[column.id] = board.localStageIdentities[old.id]!;
  }
  board.localStageIdentities = mapping;
}

/** Allocate local scope without manufacturing an authored publication key. */
export function ensureLocalStageIdentity(board: Pick<Board, 'workflow' | 'localStageIdentities'>, columnId: string, allocate: () => string): string {
  const column = board.workflow.columns.find(item => item.id === columnId);
  if (column === undefined) throw new Error('The stage no longer exists.');
  const existing = board.localStageIdentities?.[columnId];
  if (existing !== undefined) {
    if (!isDomainId(existing) || Object.entries(board.localStageIdentities ?? {}).some(([id, value]) => id !== columnId && value === existing)) throw new Error('The local stage association is invalid or reused by another stage.');
    return existing;
  }
  const used = new Set(Object.entries(board.localStageIdentities ?? {}).filter(([id]) => id !== columnId).map(([, identity]) => identity));
  for (const other of board.workflow.columns) if (other.id !== columnId && other.key !== undefined) used.add(other.key);
  for (let attempt = 0; attempt < 10_000; attempt++) {
    const identity = column.key ?? allocate();
    if (!isDomainId(identity) || used.has(identity)) {
      if (column.key !== undefined) throw new Error('The authored stage identity conflicts with another local association.');
      continue;
    }
    (board.localStageIdentities ??= {})[columnId] = identity;
    return identity;
  }
  throw new Error('Could not allocate a unique local stage identity.');
}

/**
 * Freeze the destinations of one stage's authored routing mode: a scripted
 * stage's named exits or a decision stage's options.
 */
export function captureStageTargets(board: Pick<Board, 'workflow' | 'localStageIdentities'>, column: Column, allocate: () => string): Record<string, ScriptedTarget> {
  if (column.decision !== undefined) {
    return Object.fromEntries(column.decision.options.map(option => [option.id, { columnId: option.to, stageIdentity: ensureLocalStageIdentity(board, option.to, allocate) }]));
  }
  if (column.scripted === undefined) return {};
  return Object.fromEntries(Object.entries(column.scripted.exits).map(([name, columnId]) => [name, { columnId, stageIdentity: ensureLocalStageIdentity(board, columnId, allocate) }]));
}
