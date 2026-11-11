// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { TransitionRule, Workflow } from '../../src/shared/types.js';
import { useTransitionOverrides } from '../../src/client/workflow-view/use/use-transition-overrides.js';

function workflowWith(rules: TransitionRule[] | undefined): Workflow {
  return {
    name: 'Flow',
    initialColumnId: 'a',
    columns: [
      { id: 'a', name: 'A', ...(rules === undefined ? {} : { allowedTransitions: rules }) },
      { id: 'b', name: 'B' },
    ],
    groups: [],
  };
}

describe('transition overrides', () => {
  it('presents an authored transition before the store acknowledges it', () => {
    const view = renderHook(({ stored }) => useTransitionOverrides(stored), { initialProps: { stored: workflowWith(undefined) } });
    act(() => { view.result.current.intend('a', [{ to: 'b' }]); });
    expect(view.result.current.overrides).toEqual({ a: [{ to: 'b' }] });
  });

  it('drops the override once the store holds the same transitions', () => {
    const view = renderHook(({ stored }) => useTransitionOverrides(stored), { initialProps: { stored: workflowWith(undefined) } });
    act(() => { view.result.current.intend('a', [{ to: 'b', when: 'later' }]); });
    act(() => { view.rerender({ stored: workflowWith([{ to: 'b', when: ' later ' }]) }); });
    expect(view.result.current.overrides).toEqual({});
  });

  it('drops the override when another writer replaces that stage', () => {
    const view = renderHook(({ stored }) => useTransitionOverrides(stored), { initialProps: { stored: workflowWith([{ to: 'b' }]) } });
    act(() => { view.result.current.intend('a', [{ to: 'b' }, { to: 'c' }]); });
    act(() => { view.rerender({ stored: workflowWith([{ to: 'c' }]) }); });
    expect(view.result.current.overrides).toEqual({});
  });

  it('previews a restored set and clears it on reset', () => {
    const view = renderHook(({ stored }) => useTransitionOverrides(stored), { initialProps: { stored: workflowWith([{ to: 'b' }]) } });
    act(() => { view.result.current.preview({ a: [{ to: 'c' }] }); });
    expect(view.result.current.overrides).toEqual({ a: [{ to: 'c' }] });
    act(() => { view.result.current.reset(); });
    expect(view.result.current.overrides).toEqual({});
  });

  it('keeps the newer intent when the store acknowledges an earlier one', () => {
    const view = renderHook(({ stored }) => useTransitionOverrides(stored), { initialProps: { stored: workflowWith(undefined) } });
    act(() => { view.result.current.intend('a', [{ to: 'b' }]); });
    act(() => { view.result.current.intend('a', [{ to: 'b' }, { to: 'c' }]); });
    // The store acknowledges only the first intent, which is this client's own write.
    act(() => { view.rerender({ stored: workflowWith([{ to: 'b' }]) }); });
    expect(view.result.current.overrides).toEqual({ a: [{ to: 'b' }, { to: 'c' }] });
    // The newer intent lands, so the override settles.
    act(() => { view.rerender({ stored: workflowWith([{ to: 'b' }, { to: 'c' }]) }); });
    expect(view.result.current.overrides).toEqual({});
  });

  it('drops the override when a value this client never intended arrives', () => {
    const view = renderHook(({ stored }) => useTransitionOverrides(stored), { initialProps: { stored: workflowWith([{ to: 'b' }]) } });
    act(() => { view.result.current.intend('a', [{ to: 'b' }, { to: 'c' }]); });
    act(() => { view.rerender({ stored: workflowWith([{ to: 'c' }]) }); });
    expect(view.result.current.overrides).toEqual({});
  });

  it('releases only the stages it is given', () => {
    const view = renderHook(({ stored }) => useTransitionOverrides(stored), { initialProps: { stored: workflowWith(undefined) } });
    act(() => { view.result.current.intend('a', [{ to: 'b' }]); });
    act(() => { view.result.current.intend('b', [{ to: 'c' }]); });
    act(() => { view.result.current.release({ a: [{ to: 'b' }] }); });
    expect(view.result.current.overrides).toEqual({ b: [{ to: 'c' }] });
  });

  it('keeps the newer intent when a stale baseline refresh arrives', () => {
    const view = renderHook(({ stored }) => useTransitionOverrides(stored), { initialProps: { stored: workflowWith(undefined) } });
    act(() => { view.result.current.intend('a', [{ to: 'b' }]); });
    // An unrelated snapshot refresh that still carries the unchanged stage.
    act(() => { view.rerender({ stored: workflowWith(undefined) }); });
    expect(view.result.current.overrides).toEqual({ a: [{ to: 'b' }] });
  });

  it('leaves a newer gesture on the same stage alone when an older one is released', () => {
    const view = renderHook(({ stored }) => useTransitionOverrides(stored), { initialProps: { stored: workflowWith(undefined) } });
    act(() => { view.result.current.intend('a', [{ to: 'b' }]); });
    act(() => { view.result.current.intend('a', [{ to: 'b' }, { to: 'c' }]); });
    act(() => { view.result.current.release({ a: [{ to: 'b' }] }); });
    expect(view.result.current.overrides).toEqual({ a: [{ to: 'b' }, { to: 'c' }] });
  });
});
