import { describe, expect, it } from 'vitest';
import { ownedSessionIds } from '../../src/domain/session-lineage.js';

const lineage = [
  { sessionId: 'a' },
  { sessionId: 'b', parentSessionId: 'a' },
  { sessionId: 'child', parentSessionId: 'a', origin: 'subagent' as const },
  { sessionId: 'grand', parentSessionId: 'child', origin: 'subagent' as const },
  { sessionId: 'fork', parentSessionId: 'a' },
];

describe('ownedSessionIds', () => {
  it('owns only roots and explicit subagent descendants', () => {
    expect([...ownedSessionIds(['a'], lineage)].sort()).toEqual(['a', 'child', 'grand']);
  });

  it('does not own a fork with a parent link but no subagent origin', () => {
    expect(ownedSessionIds(['a'], lineage).has('fork')).toBe(false);
  });

  it('does not own a child whose parent cannot be reached from a root', () => {
    expect(ownedSessionIds(['b'], [{ sessionId: 'orphan', parentSessionId: 'missing', origin: 'subagent' }]).has('orphan')).toBe(false);
  });

  it('terminates on cycles and duplicate edges', () => {
    const cyclic = [
      { sessionId: 'a', parentSessionId: 'child', origin: 'subagent' as const },
      { sessionId: 'child', parentSessionId: 'a', origin: 'subagent' as const },
      { sessionId: 'child', parentSessionId: 'a', origin: 'subagent' as const },
    ];
    expect([...ownedSessionIds(['a'], cyclic)].sort()).toEqual(['a', 'child']);
  });

  it('returns the roots when the lineage is empty', () => {
    expect([...ownedSessionIds(['a', 'b'], [])]).toEqual(['a', 'b']);
  });
});
