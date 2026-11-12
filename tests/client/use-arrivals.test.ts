// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useArrivals } from '../../src/client/workflow-view/use/use-arrivals.js';

describe('arrival pulses', () => {
  it('gives a card a new token each time it arrives', () => {
    const { result } = renderHook(() => useArrivals());
    act(() => { result.current.arrive('a'); });
    const first = result.current.tokens.get('a');
    act(() => { result.current.arrive('a'); });
    expect(result.current.tokens.get('a')).not.toBe(first);
  });

  it('clears only the pulse the card presented', () => {
    const { result } = renderHook(() => useArrivals());
    act(() => { result.current.arrive('a'); });
    const first = result.current.tokens.get('a')!;
    act(() => { result.current.arrive('a'); });
    const second = result.current.tokens.get('a')!;
    // A stale completion of the earlier pulse cannot clear the newer one.
    act(() => { result.current.settle('a', first); });
    expect(result.current.tokens.get('a')).toBe(second);
    act(() => { result.current.settle('a', second); });
    expect(result.current.tokens.has('a')).toBe(false);
  });

  it('drops the pulse of a card the diagram no longer presents', () => {
    const { result } = renderHook(() => useArrivals());
    act(() => { result.current.arrive('a'); result.current.arrive('b'); });
    act(() => { result.current.retain(new Set(['b'])); });
    expect(result.current.tokens.has('a')).toBe(false);
    expect(result.current.tokens.has('b')).toBe(true);
    act(() => { result.current.retain(new Set(['b'])); });
    expect(result.current.tokens.has('b')).toBe(true);
  });

  it('drops every pulse when the arrangement settles', () => {
    const { result } = renderHook(() => useArrivals());
    act(() => { result.current.arrive('a'); result.current.arrive('b'); });
    act(() => { result.current.clear(); });
    expect(result.current.tokens.size).toBe(0);
  });
});
