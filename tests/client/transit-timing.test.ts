import { describe, expect, it } from 'vitest';
import { TRANSIT_POLICY, type TransitPolicy } from '../../src/client/workflow-view/transit/policy.js';
import { delayFor, diameterFor, durationFor } from '../../src/client/workflow-view/transit/timing.js';

const policy: TransitPolicy = { ...TRANSIT_POLICY, minDurationMs: 300, maxDurationMs: 700, msPerFlowUnit: 1.4, trailGapMs: 30, coreDiameterPx: 12 };

describe('transit duration', () => {
  it('keeps a short path at the shortest duration', () => {
    expect(durationFor(1, policy)).toBe(300);
    expect(durationFor(0, policy)).toBe(300);
    expect(durationFor(Number.NaN, policy)).toBe(300);
  });

  it('follows the path length between the bounds', () => {
    expect(durationFor(300, policy)).toBe(420);
  });

  it('bounds a long path at the longest duration', () => {
    expect(durationFor(500, policy)).toBe(700);
    expect(durationFor(5000, policy)).toBe(700);
  });
});

describe('transit particles', () => {
  it('starts the core immediately and each trail particle later', () => {
    expect(delayFor(0, policy)).toBe(0);
    expect(delayFor(1, policy)).toBe(30);
    expect(delayFor(3, policy)).toBe(90);
  });

  it('draws the core largest and each trail particle smaller', () => {
    expect(diameterFor(0, policy)).toBe(12);
    const trail = diameterFor(1, policy);
    expect(trail).toBeLessThan(12);
    expect(diameterFor(2, policy)).toBeLessThan(trail);
  });
});
