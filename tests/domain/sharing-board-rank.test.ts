import { describe, expect, it } from 'vitest';
import { compareRanks, planRanks, rankBetween, rebalanceRanks } from '../../src/domain/sharing/board-rank.js';

describe('published board positions', () => {
  it('produces a position between two others', () => {
    const rank = rankBetween('a', 'b');
    expect(rank).not.toBeNull();
    expect(compareRanks('a', rank!)).toBeLessThan(0);
    expect(compareRanks(rank!, 'b')).toBeLessThan(0);
  });

  it('produces positions at either end', () => {
    const first = rankBetween(null, 'a');
    expect(first).not.toBeNull();
    expect(compareRanks(first!, 'a')).toBeLessThan(0);
    const last = rankBetween('z', null);
    expect(last).not.toBeNull();
    expect(compareRanks('z', last!)).toBeLessThan(0);
    expect(rankBetween(null, null)).toBe('i');
  });

  it('refuses a position that is not ordered', () => {
    expect(rankBetween('b', 'a')).toBeNull();
    expect(rankBetween('a', 'a')).toBeNull();
  });

  it('keeps a board whose position is already consistent and moves one with a single change', () => {
    const order = ['a', 'b', 'c'];
    const published = new Map([['a', 'a'], ['b', 'b'], ['c', 'c']]);
    expect(planRanks(order, published)?.size).toBe(0);
    const moved = planRanks(['a', 'c', 'b'], published);
    expect(moved).not.toBeNull();
    expect([...moved!.keys()]).toEqual(['c']);
    const rank = moved!.get('c')!;
    expect(compareRanks('a', rank)).toBeLessThan(0);
    expect(compareRanks(rank, 'b')).toBeLessThan(0);
  });

  it('reports no plan when a new board needs a position', () => {
    const plan = planRanks(['a', 'b', 'new'], new Map([['a', 'a'], ['b', 'b']]));
    expect(plan).not.toBeNull();
    expect(plan!.has('new')).toBe(true);
  });

  it('rebalances the whole order when no position fits', () => {
    const ranks = rebalanceRanks(['a', 'b', 'c']);
    expect([...ranks.keys()]).toEqual(['a', 'b', 'c']);
    expect(compareRanks(ranks.get('a')!, ranks.get('b')!)).toBeLessThan(0);
    expect(compareRanks(ranks.get('b')!, ranks.get('c')!)).toBeLessThan(0);
  });
});
