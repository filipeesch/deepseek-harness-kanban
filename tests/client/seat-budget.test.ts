import { describe, expect, it } from 'vitest';
import { distributeByNeed, seatPlan, stripNeed, type StripMetrics } from '../../src/client/seat-budget.js';

function strip(header: number, footer: number, content: number, expanded = true): StripMetrics {
  return { header, fixed: expanded ? header + footer : header, content: expanded ? content : 0, expanded };
}

const GATE: StripMetrics = strip(34, 45, 349);
const LONG: StripMetrics = strip(34, 45, 760);
const COLLAPSED: StripMetrics = strip(34, 45, 0, false);

describe('strip need', () => {
  it('counts the fixed controls and the body content of an expanded strip', () => {
    expect(stripNeed(GATE)).toBe(428);
  });

  it('counts only the header of a collapsed strip', () => {
    expect(stripNeed(COLLAPSED)).toBe(34);
  });
});

describe('sharing a height by need', () => {
  it('returns nothing when there is no space or no strip', () => {
    expect(distributeByNeed(0, [10, 20])).toEqual([0, 0]);
    expect(distributeByNeed(100, [])).toEqual([]);
  });

  it('gives every strip exactly what it needs when the space is enough', () => {
    expect(distributeByNeed(1_200, [349, 760])).toEqual([349, 760]);
  });

  it('satisfies the short strip first and leaves the rest to the long one', () => {
    expect(distributeByNeed(740, [349, 760])).toEqual([349, 391]);
    expect(distributeByNeed(200, [50, 500])).toEqual([50, 150]);
  });

  it('splits in proportion when both strips are still short', () => {
    expect(distributeByNeed(500, [400, 600])).toEqual([200, 300]);
  });

  it('satisfies the needs that fit and shares the remainder among the rest', () => {
    expect(distributeByNeed(600, [100, 200, 900])).toEqual([100, 200, 300]);
  });

  it('never returns more than the space even when rounding cannot divide it evenly', () => {
    expect(distributeByNeed(100, [1, 1, 1])).toEqual([1, 1, 1]);
    const values = distributeByNeed(100, [40, 70, 70]);
    expect(values.reduce((left, right) => left + right, 0)).toBe(100);
    expect(values.every(value => value >= 0)).toBe(true);
  });

  it('never gives a strip more than its need', () => {
    for (const value of distributeByNeed(90, [10, 100, 100])) expect(value).toBeLessThanOrEqual(100);
  });
});

describe('seat plan', () => {
  it('grows a short strip to its content instead of a fixed cap', () => {
    const plan = seatPlan([GATE], { dockSpace: 900, crampedSpace: 900 });
    expect(plan.mode).toBe('dock');
    expect(plan.tight).toBe(false);
    expect(plan.budgets).toEqual([428]);
  });

  it('lets a large conversation give a long strip more than the old fixed cap', () => {
    const plan = seatPlan([strip(34, 45, 1_200)], { dockSpace: 1_440, crampedSpace: 1_440 });
    expect(plan.budgets[0]).toBe(1_279);
    expect(plan.budgets[0]!).toBeGreaterThan(1_200);
  });

  it('bounds a long strip by what the seat can spare and lets its body scroll', () => {
    const plan = seatPlan([LONG], { dockSpace: 500, crampedSpace: 500 });
    expect(plan.mode).toBe('dock');
    expect(plan.tight).toBe(false);
    expect(plan.budgets).toEqual([500]);
  });

  it('shares the seat by need between two strips', () => {
    const plan = seatPlan([GATE, LONG], { dockSpace: 900, crampedSpace: 900 });
    expect(plan.budgets).toEqual([428, 472]);
    expect(plan.budgets[0]).toBeGreaterThanOrEqual(stripNeed(GATE));
  });

  it('gives a collapsed strip only its header', () => {
    const plan = seatPlan([COLLAPSED, GATE], { dockSpace: 900, crampedSpace: 900 });
    expect(plan.budgets).toEqual([34, 428]);
  });

  it('keeps every header and shares the rest evenly between the expanded strips', () => {
    const plan = seatPlan([GATE, LONG], { dockSpace: 100, crampedSpace: 100 });
    expect(plan.mode).toBe('dock');
    expect(plan.tight).toBe(true);
    expect(plan.budgets).toEqual([50, 50]);
    expect(plan.budgets.reduce((left, right) => left + right, 0)).toBe(100);
  });

  it('gives a collapsed strip no share of the tight remainder', () => {
    const plan = seatPlan([GATE, COLLAPSED], { dockSpace: 100, crampedSpace: 100 });
    expect(plan.tight).toBe(true);
    // The collapsed strip needs its header only; the expanded strip gets the rest.
    expect(plan.budgets[1]).toBe(34);
    expect(plan.budgets[0]).toBe(66);
    expect(plan.budgets.reduce((left, right) => left + right, 0)).toBe(100);
  });

  it('never allocates more than a fractional space', () => {
    expect(distributeByNeed(161.25, [100, 100]).reduce((left, right) => left + right, 0)).toBe(161);
    const plan = seatPlan([GATE, LONG], { dockSpace: 100.25, crampedSpace: 100.25 });
    expect(plan.budgets.reduce((left, right) => left + right, 0)).toBeLessThanOrEqual(100);
  });

  it('falls back to cramped panels when not even the headers fit', () => {
    const plan = seatPlan([GATE, LONG, strip(34, 45, 100)], { dockSpace: 60, crampedSpace: 400, gap: 6 });
    expect(plan.mode).toBe('cramped');
    expect(plan.launcher).toBe(false);
    expect(plan.panelHeight).toBeGreaterThanOrEqual(96);
  });

  it('uses compact launchers when the visible conversation is too shallow', () => {
    const plan = seatPlan([GATE, LONG, strip(34, 45, 100)], { dockSpace: 60, crampedSpace: 200, gap: 6 });
    expect(plan.mode).toBe('cramped');
    expect(plan.launcher).toBe(true);
    expect(plan.panelHeight).toBe(0);
  });

  it('presents nothing for an empty seat', () => {
    expect(seatPlan([], { dockSpace: 900, crampedSpace: 900 })).toEqual({ mode: 'dock', budgets: [], tight: false, panelHeight: 0, launcher: false });
  });
});
