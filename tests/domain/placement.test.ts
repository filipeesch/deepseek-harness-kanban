import { describe, expect, it } from 'vitest';
import { placementFromAnchor, placementIndex } from '../../src/domain/placement.js';

describe('placement', () => {
  it('maps an absent anchor to the start, null to the end, and an id to before that task', () => {
    expect(placementFromAnchor(undefined)).toBe('start');
    expect(placementFromAnchor(null)).toBe('end');
    expect(placementFromAnchor('task-2')).toEqual({ before: 'task-2' });
  });

  it('resolves the start and the end of an empty destination', () => {
    expect(placementIndex('start', [])).toBe(0);
    expect(placementIndex('end', [])).toBe(0);
  });

  it('resolves a start, an anchored, and an end position in an ordered destination', () => {
    const ordered = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(placementIndex('start', ordered)).toBe(0);
    expect(placementIndex({ before: 'b' }, ordered)).toBe(1);
    expect(placementIndex('end', ordered)).toBe(3);
  });

  it('falls back to the end when the anchor is not in the destination', () => {
    expect(placementIndex({ before: 'missing' }, [{ id: 'a' }])).toBe(1);
  });
});
