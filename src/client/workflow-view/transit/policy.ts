import { MOTION_BATCH_LIMIT } from '../../card-motion/config.js';

/**
 * How the diagram's transit reads: how many cards may transit at once, how long a
 * transit lasts, and how the particle and its trail are sized. One policy, so the
 * diagram and the column board cannot disagree about the batch cap.
 */
export interface TransitPolicy {
  /** More tasks than this moving in one change settle immediately. */
  readonly batchLimit: number;
  /** The shortest transit, for a short connection. */
  readonly minDurationMs: number;
  /** The longest transit, for a long connection. */
  readonly maxDurationMs: number;
  /** How long one flow unit of drawn path takes, before the bounds apply. */
  readonly msPerFlowUnit: number;
  /** The trail particles that follow the bright core. */
  readonly trailCount: number;
  /** How long each trail particle waits before it starts, so it trails the core. */
  readonly trailGapMs: number;
  /** The core's diameter at 100% zoom, in screen pixels. */
  readonly coreDiameterPx: number;
  /** Each trail particle's diameter as a fraction of the one ahead of it. */
  readonly trailSizeRatio: number;
}

export const TRANSIT_POLICY: TransitPolicy = {
  batchLimit: MOTION_BATCH_LIMIT,
  minDurationMs: 300,
  maxDurationMs: 700,
  msPerFlowUnit: 1.4,
  trailCount: 3,
  trailGapMs: 30,
  coreDiameterPx: 12,
  trailSizeRatio: 0.66,
};
