/**
 * Whether the system asks for reduced motion. A host without `matchMedia` is
 * treated as allowing motion, matching the board's previous behavior.
 */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
