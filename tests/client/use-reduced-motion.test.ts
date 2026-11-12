// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useReducedMotion, type MotionPreferencePort } from '../../src/client/workflow-view/use/use-reduced-motion.js';

/** A host preference a test can change, with the subscription it publishes. */
function preferencePort(initial: boolean): { port: MotionPreferencePort; emit: (reduced: boolean) => void; unsubscribe: ReturnType<typeof vi.fn> } {
  let reduced = initial;
  let listener: (() => void) | null = null;
  const unsubscribe = vi.fn();
  return {
    port: {
      read: () => reduced,
      subscribe: onChange => { listener = onChange; return unsubscribe; },
    },
    emit: next => { reduced = next; listener?.(); },
    unsubscribe,
  };
}

describe('motion preference', () => {
  it('reads the preference the host publishes', () => {
    const { port } = preferencePort(true);
    const { result } = renderHook(() => useReducedMotion(port));
    expect(result.current).toBe(true);
  });

  it('follows a preference change with no other render', () => {
    const { port, emit } = preferencePort(false);
    const { result } = renderHook(() => useReducedMotion(port));
    expect(result.current).toBe(false);
    act(() => { emit(true); });
    expect(result.current).toBe(true);
    act(() => { emit(false); });
    expect(result.current).toBe(false);
  });

  it('unsubscribes when the diagram closes', () => {
    const { port, unsubscribe } = preferencePort(false);
    const { unmount } = renderHook(() => useReducedMotion(port));
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('keeps a fixed preference when the host cannot report changes', () => {
    const { result } = renderHook(() => useReducedMotion({ read: () => true }));
    expect(result.current).toBe(true);
  });
});
