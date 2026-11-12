/** Whether the host can animate an element along an arbitrary SVG path. */
export type SupportsPathMotion = () => boolean;

/**
 * The capability probe the transit layer needs. A host without it settles every
 * stage change, exactly as the reduced-motion preference does, so an older renderer
 * loses the transit and nothing else.
 */
export const supportsPathMotion: SupportsPathMotion = () => {
  const api = typeof CSS === 'undefined' ? undefined : CSS;
  if (api === undefined || typeof api.supports !== 'function') return false;
  try {
    return api.supports('offset-path', 'path("M 0 0 L 1 1")');
  } catch {
    return false;
  }
};
