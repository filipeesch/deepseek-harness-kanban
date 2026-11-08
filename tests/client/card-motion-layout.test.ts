import { describe, expect, it } from 'vitest';
import { exitCopyRect, intersectsViewport, movementFor, planCardMotion, sameRowKeys, type CardRect, type CardSnapshot } from '../../src/client/card-motion/layout.js';

function rect(left: number, top: number, width = 240, height = 40): CardRect { return { left, top, width, height }; }
function snapshot(entries: Array<[string, CardRect]>): CardSnapshot {
  return { keys: entries.map(([key]) => key), rects: new Map(entries) };
}
const always = (): boolean => true;

describe('row keys', () => {
  it('compares rendered order, not just membership', () => {
    expect(sameRowKeys(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameRowKeys(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameRowKeys(['a'], ['a', 'b'])).toBe(false);
    expect(sameRowKeys([], [])).toBe(true);
  });
});

describe('movement', () => {
  it('returns the translation that puts the card back where it was', () => {
    expect(movementFor(rect(10, 20), rect(0, 50))).toEqual({ dx: 10, dy: -30 });
  });

  it('returns null when the card did not move', () => {
    expect(movementFor(rect(10, 20), rect(10, 20))).toBeNull();
  });
});

describe('viewport intersection', () => {
  const viewport = rect(0, 0, 300, 200);

  it('accepts a card fully or partly inside the visible area', () => {
    expect(intersectsViewport(rect(10, 10), viewport)).toBe(true);
    expect(intersectsViewport(rect(290, 10), viewport)).toBe(true);
  });

  it('rejects a card outside every edge', () => {
    expect(intersectsViewport(rect(-240, 10), viewport)).toBe(false);
    expect(intersectsViewport(rect(10, 200), viewport)).toBe(false);
    expect(intersectsViewport(rect(10, -40), viewport)).toBe(false);
  });
});

describe('exit copies', () => {
  it('places the copy relative to the overlay origin', () => {
    expect(exitCopyRect(rect(100, 150), rect(20, 40))).toEqual({ left: 80, top: 110, width: 240, height: 40 });
  });
});

describe('motion planning', () => {
  it('plans a movement for every card whose position changed', () => {
    const plan = planCardMotion(
      snapshot([['a', rect(0, 0)], ['b', rect(0, 50)]]),
      snapshot([['b', rect(0, 0)], ['a', rect(0, 50)]]),
      always,
    );
    expect(plan.movements).toEqual([{ key: 'b', dx: 0, dy: 50 }, { key: 'a', dx: 0, dy: -50 }]);
    expect(plan.entered).toEqual([]);
    expect(plan.exited).toEqual([]);
  });

  it('omits cards that did not move', () => {
    const plan = planCardMotion(snapshot([['a', rect(0, 0)]]), snapshot([['a', rect(0, 0)]]), always);
    expect(plan).toEqual({ movements: [], entered: [], exited: [] });
  });

  it('reports entries and exits', () => {
    const plan = planCardMotion(
      snapshot([['a', rect(0, 0)], ['gone', rect(0, 40)]]),
      snapshot([['a', rect(0, 0)], ['new', rect(0, 40)]]),
      always,
    );
    expect(plan.entered).toEqual(['new']);
    expect(plan.exited).toEqual(['gone']);
  });

  it('skips cards outside the visible board before and after the commit', () => {
    const plan = planCardMotion(
      snapshot([['off', rect(0, -400)], ['a', rect(0, 0)]]),
      snapshot([['off', rect(0, -400)], ['a', rect(0, 40)]]),
      rect => rect.top >= 0,
    );
    expect(plan.movements).toEqual([{ key: 'a', dx: 0, dy: -40 }]);
  });

  it('does not report an exit copy for an already invisible card', () => {
    const plan = planCardMotion(snapshot([['gone', rect(0, -400)]]), snapshot([]), rect => rect.top >= 0);
    expect(plan.exited).toEqual([]);
  });
});
