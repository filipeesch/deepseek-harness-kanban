import { useEffect, useState } from 'react';
import { prefersReducedMotion } from '../../card-motion/preference.js';

/**
 * The host's motion preference, as the diagram observes it. Reading it once per render
 * is not enough: the preference can change while a transit is running, and the surface
 * has to settle that transit even when nothing else re-renders.
 */
export interface MotionPreferencePort {
  /** The preference right now. */
  read(): boolean;
  /** Subscribes to a change of the preference; returns the unsubscribe. */
  subscribe?(onChange: () => void): () => void;
}

/** The host preference, following the media query while the surface is mounted. */
export const HOST_MOTION_PREFERENCE: MotionPreferencePort = {
  read: prefersReducedMotion,
  subscribe(onChange) {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  },
};

/** The host's motion preference, kept current while it changes with no other render. */
export function useReducedMotion(port: MotionPreferencePort = HOST_MOTION_PREFERENCE): boolean {
  const [reduced, setReduced] = useState(() => port.read());
  useEffect(() => {
    setReduced(port.read());
    if (port.subscribe === undefined) return undefined;
    return port.subscribe(() => setReduced(port.read()));
  }, [port]);
  return reduced;
}
