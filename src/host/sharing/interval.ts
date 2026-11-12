import { invariant } from '../../shared/errors.js';

export const DEFAULT_SHARING_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 1440;

/** The supported check interval: manual only (0) or a whole number of minutes. */
export function normalizeSharingInterval(value: number | undefined, fallback = DEFAULT_SHARING_INTERVAL_MINUTES): number {
  const minutes = value ?? fallback;
  invariant(Number.isInteger(minutes) && minutes >= 0 && minutes <= MAX_INTERVAL_MINUTES, 'INVALID_INPUT', 'The check interval must be a whole number of minutes between 0 and ' + MAX_INTERVAL_MINUTES + '.');
  invariant(minutes === 0 || minutes >= 1, 'INVALID_INPUT', 'The check interval is either 0 (manual checks) or at least one minute.');
  return minutes;
}
