import type { Workflow } from '../shared/types.js';
import { isDomainId } from './validation.js';

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
 * deterministic genesis used when a workflow arrives without identities. Two
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
