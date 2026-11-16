import { describe, expect, it } from 'vitest';
import { boardAllowlistFor } from '../../src/host/board-policy-source.js';

function source(input: { boards?: Record<string, { mcp?: readonly string[] }>; parents?: Record<string, string> }) {
  return {
    boardOf: (sessionId: string) => input.boards?.[sessionId],
    parentOf: (sessionId: string) => input.parents?.[sessionId],
  };
}

describe('the board allowlist one agent starts under', () => {
  it('reads the board of the task conversation itself', () => {
    expect(boardAllowlistFor(source({ boards: { task: { mcp: ['atlassian'] } } }), 'task')).toEqual(['atlassian']);
  });

  it('keeps the authored empty list distinct from an absent field', () => {
    expect(boardAllowlistFor(source({ boards: { task: { mcp: [] } } }), 'task')).toEqual([]);
    expect(boardAllowlistFor(source({ boards: { task: {} } }), 'task')).toBeUndefined();
  });

  it('returns nothing for an ordinary chat that belongs to no board', () => {
    expect(boardAllowlistFor(source({}), 'chat')).toBeUndefined();
  });

  it('follows the ancestry of a fork created before it is attached to its task', () => {
    const lookup = source({ boards: { task: { mcp: ['atlassian/search'] } }, parents: { fork: 'task' } });
    expect(boardAllowlistFor(lookup, 'fork')).toEqual(['atlassian/search']);
  });

  it('follows a nested fork chain', () => {
    const lookup = source({ boards: { task: { mcp: [] } }, parents: { inner: 'outer', outer: 'task' } });
    expect(boardAllowlistFor(lookup, 'inner')).toEqual([]);
  });

  it('stops on a cycle instead of looping', () => {
    const lookup = source({ parents: { a: 'b', b: 'a' } });
    expect(boardAllowlistFor(lookup, 'a')).toBeUndefined();
  });

  it('bounds how far the ancestry is followed', () => {
    const parents: Record<string, string> = { n0: 'n1' };
    for (let index = 1; index < 12; index += 1) parents['n' + index] = 'n' + (index + 1);
    const lookup = source({ boards: { n11: { mcp: ['trino'] } }, parents });
    expect(boardAllowlistFor(lookup, 'n0')).toBeUndefined();
  });
});
