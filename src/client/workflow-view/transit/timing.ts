import { TRANSIT_POLICY, type TransitPolicy } from './policy.js';

/** How long one transit of a drawn path of this length takes, bounded by the policy. */
export function durationFor(length: number, policy: TransitPolicy = TRANSIT_POLICY): number {
  if (!Number.isFinite(length) || length <= 0) return policy.minDurationMs;
  const scaled = Math.round(length * policy.msPerFlowUnit);
  return Math.min(policy.maxDurationMs, Math.max(policy.minDurationMs, scaled));
}

/** How long one particle of the transit waits before it starts. */
export function delayFor(index: number, policy: TransitPolicy = TRANSIT_POLICY): number {
  return Math.max(0, Math.round(index) * policy.trailGapMs);
}

/** The diameter one particle draws: the core, then each trail particle smaller than the one ahead. */
export function diameterFor(index: number, policy: TransitPolicy = TRANSIT_POLICY): number {
  const core = policy.coreDiameterPx;
  if (index <= 0) return core;
  return core * Math.pow(policy.trailSizeRatio, index);
}
