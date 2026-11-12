import { describe, expect, it } from 'vitest';
import { corridorClearance, corridorOf, stageCrossesCorridor } from '../../src/domain/diagram/clearance.js';
import type { DiagramRect } from '../../src/domain/diagram/orthogonal.js';

const stages: readonly DiagramRect[] = [
  { x: 0, y: 0, width: 200, height: 100 },
  { x: 400, y: 0, width: 200, height: 100 },
  { x: 800, y: 0, width: 200, height: 300 },
];

describe('route corridor', () => {
  it('spans the two legs and widens by a detour', () => {
    expect(corridorOf(100, 500)).toEqual({ minX: 100, maxX: 500 });
    expect(corridorOf(500, 100, -72)).toEqual({ minX: -72, maxX: 500 });
  });

  it('counts a stage only when it intersects the corridor', () => {
    const corridor = corridorOf(100, 500);
    expect(stageCrossesCorridor(stages[0]!, corridor)).toBe(true);
    expect(stageCrossesCorridor(stages[1]!, corridor)).toBe(true);
    expect(stageCrossesCorridor(stages[2]!, corridor)).toBe(false);
  });

  it('keeps a stage outside the corridor from raising the floor', () => {
    expect(corridorClearance(stages, corridorOf(100, 500))).toBe(100);
    expect(corridorClearance(stages, corridorOf(100, 900))).toBe(300);
  });

  it('counts a stage that contains a leg of the corridor', () => {
    const tall: DiagramRect = { x: 0, y: 0, width: 200, height: 700 };
    expect(corridorClearance([...stages, tall], corridorOf(100, 100))).toBe(700);
  });
});
