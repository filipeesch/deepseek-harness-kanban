import { describe, expect, it } from 'vitest';
import {
  CONVERSATION_MIN, DIVIDER, RAIL_MIN, clampDrawerWidth, clampRailWidth, defaultRailWidth, planWorkspace, railUpperBound,
} from '../../src/client/conversations/workspace-layout.js';
import { RAIL_WIDTH_KEY, readRailWidth, writeRailWidth } from '../../src/client/rail-width.js';

function storage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe('planWorkspace', () => {
  it('splits with the 45% default clamped to the rail minimum', () => {
    const plan = planWorkspace({ drawerWidth: 620, viewportWidth: 1400, railWidthPreference: undefined });
    expect(plan.kind).toBe('split');
    if (plan.kind !== 'split') return;
    expect(plan.railWidth).toBe(RAIL_MIN);
    expect(plan.extra).toBe(RAIL_MIN + DIVIDER);
    expect(CONVERSATION_MIN + plan.extra).toBe(CONVERSATION_MIN + RAIL_MIN + DIVIDER);
  });

  it('keeps a drawer that already fits without growing', () => {
    const plan = planWorkspace({ drawerWidth: 900, viewportWidth: 1400, railWidthPreference: 400 });
    expect(plan.kind).toBe('split');
    if (plan.kind !== 'split') return;
    expect(plan.railWidth).toBe(400);
    expect(plan.extra).toBe(400 + DIVIDER);
  });

  it('covers the conversation when the viewport cannot fit both', () => {
    const plan = planWorkspace({ drawerWidth: 620, viewportWidth: 800, railWidthPreference: 320 });
    expect(plan.kind).toBe('cover');
    if (plan.kind !== 'cover') return;
    expect(plan.railWidth).toBe(RAIL_MIN);
  });

  it('clamps a rail preference into the drawer bounds', () => {
    expect(clampRailWidth(120, 620)).toBe(RAIL_MIN);
    expect(clampRailWidth(900, 620)).toBe(railUpperBound(620));
    expect(defaultRailWidth(1000)).toBe(450);
  });

  it('clamps the drawer to its contract range', () => {
    expect(clampDrawerWidth(200, 1400)).toBe(360);
    expect(clampDrawerWidth(5000, 1000)).toBe(900);
    expect(clampDrawerWidth(700, 1000)).toBe(700);
  });
});

describe('rail width preference', () => {
  it('falls back to the drawer default when nothing is stored', () => {
    expect(readRailWidth(620, storage())).toBe(RAIL_MIN);
  });

  it('reads and clamps a stored width', () => {
    expect(readRailWidth(620, storage({ [RAIL_WIDTH_KEY]: '400' }))).toBe(400);
    expect(readRailWidth(620, storage({ [RAIL_WIDTH_KEY]: '100' }))).toBe(RAIL_MIN);
    expect(readRailWidth(620, storage({ [RAIL_WIDTH_KEY]: '900' }))).toBe(railUpperBound(620));
  });

  it('ignores invalid stored values', () => {
    expect(readRailWidth(620, storage({ [RAIL_WIDTH_KEY]: 'wide' }))).toBe(RAIL_MIN);
    expect(readRailWidth(620, storage({ [RAIL_WIDTH_KEY]: '-40' }))).toBe(RAIL_MIN);
  });

  it('persists the rounded width and ignores non-finite values', () => {
    const store = storage();
    writeRailWidth(411.6, store);
    expect(store.getItem(RAIL_WIDTH_KEY)).toBe('412');
    writeRailWidth(Number.NaN, store);
    expect(store.getItem(RAIL_WIDTH_KEY)).toBe('412');
  });
});
