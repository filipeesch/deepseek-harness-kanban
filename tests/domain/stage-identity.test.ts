import { describe, expect, it } from 'vitest';
import type { Workflow } from '../../src/shared/types.js';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { assignStageIdentities, seedStageIdentities, stageIdentitySeeds } from '../../src/domain/stage-identity.js';

const NL = String.fromCharCode(10);
function workflow(columns: string): Workflow {
  return parseWorkflow('columns:' + NL + columns);
}
function counter(prefix = 'new'): () => string {
  let value = 0;
  return () => prefix + '-' + (value += 1);
}

describe('stage identity assignment', () => {
  it('keeps every authored identity', () => {
    const current = workflow('  - id: one' + NL + '    key: s1' + NL + '    label: One' + NL + '  - id: two' + NL + '    key: s2' + NL + '    label: Two' + NL);
    expect(assignStageIdentities({ workflow: current, allocate: counter() }).columns.map(column => column.key)).toEqual(['s1', 's2']);
  });

  it('keeps the identity of a stage whose identifier changed', () => {
    const current = workflow('  - id: inbox' + NL + '    key: s1' + NL + '    label: One' + NL);
    expect(assignStageIdentities({ workflow: current, allocate: counter() }).columns[0]?.key).toBe('s1');
  });

  it('reuses the identity of a stage whose authored identity a replacement dropped', () => {
    const previous = workflow('  - id: one' + NL + '    key: s1' + NL + '    label: One' + NL);
    const replaced = workflow('  - id: one' + NL + '    label: One' + NL);
    const result = assignStageIdentities({ workflow: replaced, previous: stageIdentitySeeds(previous), allocate: counter() });
    expect(result.columns[0]?.key).toBe('s1');
  });

  it('allocates an identity for a stage the previous version never had', () => {
    const previous = workflow('  - id: one' + NL + '    key: s1' + NL + '    label: One' + NL);
    const grown = workflow('  - id: one' + NL + '    label: One' + NL + '  - id: two' + NL + '    label: Two' + NL);
    expect(assignStageIdentities({ workflow: grown, previous: stageIdentitySeeds(previous), allocate: counter() }).columns.map(column => column.key)).toEqual(['s1', 'new-1']);
  });

  it('does not move an inherited identity onto a stage that authored it', () => {
    const previous = workflow('  - id: one' + NL + '    key: s1' + NL + '    label: One' + NL);
    const replaced = workflow('  - id: one' + NL + '    label: One' + NL + '  - id: two' + NL + '    key: s1' + NL + '    label: Two' + NL);
    const result = assignStageIdentities({ workflow: replaced, previous: stageIdentitySeeds(previous), allocate: counter('other') });
    expect(result.columns[1]?.key).toBe('s1');
    expect(result.columns[0]?.key).toBe('other-1');
  });

  it('replaces a duplicated identity instead of propagating it', () => {
    const duplicated: Workflow = {
      name: 'Duplicated',
      initialColumnId: 'one',
      columns: [{ id: 'one', name: 'One', key: 's1' }, { id: 'two', name: 'Two', key: 's1' }],
      groups: [],
    };
    const result = assignStageIdentities({ workflow: duplicated, allocate: counter() });
    expect(new Set(result.columns.map(column => column.key)).size).toBe(2);
    expect(result.columns[0]?.key).toBe('s1');
  });

  it('is a pure function of its input', () => {
    const current = workflow('  - id: one' + NL + '    label: One' + NL);
    assignStageIdentities({ workflow: current, allocate: counter() });
    expect(current.columns[0]?.key).toBeUndefined();
  });

  it('seeds the genesis identity from the authored identifier', () => {
    const current = workflow('  - id: one' + NL + '    label: One' + NL + '  - id: two' + NL + '    key: kept' + NL + '    label: Two' + NL);
    const seeded = seedStageIdentities(current);
    expect(seeded.columns.map(column => column.key)).toEqual(['one', 'kept']);
    expect(seedStageIdentities(seeded)).toBe(seeded);
  });
});
