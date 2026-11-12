/** The timing values the board's card motion uses; the Host's keyed rows use the same glide and fade values. */
export interface MotionTiming { readonly glideMs: number; readonly fadeMs: number; readonly easing: string }

/** Everything the card motion frame needs besides the rows themselves. */
export interface CardMotionConfig {
  readonly timing: MotionTiming;
  /** More changed cards than this settle immediately, so a bulk change never launches a cascade. */
  readonly batchLimit: number;
  /** The stacking index a card keeps only while it glides above the columns it crosses. */
  readonly stackingIndex: number;
}

/** More cards than this moving in one change settle immediately, in either presentation. */
export const MOTION_BATCH_LIMIT = 8;

export const CARD_MOTION: CardMotionConfig = {
  timing: { glideMs: 200, fadeMs: 100, easing: 'ease-out' },
  batchLimit: MOTION_BATCH_LIMIT,
  stackingIndex: 3,
};
