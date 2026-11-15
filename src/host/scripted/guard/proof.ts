import { createHmac, timingSafeEqual } from 'node:crypto';

const PROOF = /^[a-f0-9]{64}$/;

/** The authenticated proof one side of the lifetime channel sends. */
export function proof(token: string, text: string): string {
  return createHmac('sha256', token).update(text).digest('hex');
}

/**
 * Whether a received proof is the one this channel expects. A hostile value is rejected
 * before the comparison, so a multibyte or differently sized proof cannot throw out of
 * a channel callback.
 */
export function matches(expected: string, actual: unknown): boolean {
  if (typeof actual !== 'string' || !PROOF.test(actual) || !PROOF.test(expected)) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}
