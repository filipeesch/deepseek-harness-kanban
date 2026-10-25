// @vitest-environment jsdom
import React, { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';
import { NativeSlotHost, type NativeLocaleSource, type NativeSlotSource } from '../../src/client/native-slot-host.js';

afterEach(cleanup);
function entry(id: string, options: Record<string, unknown> = {}): StoredEntry {
  return { component: () => null, options: { id }, ...options } as unknown as StoredEntry;
}
function source(initial: StoredEntry[]) {
  let entries = initial; const listeners = new Set<() => void>();
  return {
    source: {
      entriesOfSlot: () => entries,
      subscribe: (_key: string, listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    } satisfies NativeSlotSource,
    set(next: StoredEntry[]) { entries = next; for (const listener of listeners) listener(); },
  };
}
const locale: NativeLocaleSource = {
  bind: namespace => key => namespace + ':' + key,
  getSnapshot: () => ({ revision: 0 }),
  subscribe: () => () => {},
};
const standard = { sessionId: 'a', useSession: (select: (value: object) => unknown) => select({ openState: 'open', blank: true }) };

describe('NativeSlotHost', () => {
  it('renders native entries in order with inject faces, hooks, owner props, and locale', () => {
    const hook = { value: 3, getSnapshot() { return this.value; }, subscribe: () => () => {} };
    const first = entry('first', {
      component: (props: Record<string, unknown>) => createElement('span', { 'data-testid': 'first' }, String((props.t as (key: string) => string)('label')) + ':' + String(props.ownerValue)),
      locale: 'settings.agentPreset',
      inject: () => ({ ownerValue: 'owner', hooks: { counter: hook } }),
      options: { id: 'first', order: -10 },
    });
    const second = entry('second', {
      component: (props: Record<string, unknown>) => {
        const value = (props.useCounter as (select: (value: number) => number) => number)(snapshot => snapshot);
        return createElement('span', { 'data-testid': 'second' }, String(value));
      },
      inject: () => ({ hooks: { counter: hook } }),
      options: { id: 'second', order: 10 },
    });
    render(<NativeSlotHost slot="actions" kind="list" source={source([second, first]).source} locale={locale} standard={standard} owner={{ ownerValue: 'owner' }} />);
    const firstNode = screen.getByTestId('first');
    const secondNode = screen.getByTestId('second');
    expect(firstNode.textContent).toBe('settings.agentPreset:label:owner');
    expect(secondNode.textContent).toBe('3');
    expect(firstNode.compareDocumentPosition(secondNode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders a fallback when empty, refreshes on late registration, and contains entry failures', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fixture = source([]);
    const { rerender } = render(<NativeSlotHost slot="actions" kind="list" source={fixture.source} locale={locale} standard={standard} fallback={<span data-testid="fallback">empty</span>} />);
    expect(screen.getByTestId('fallback')).toBeTruthy();
    const good = entry('good', { component: () => <span data-testid="good">good</span> }); const bad = entry('bad', { component: () => { throw new Error('bad native entry'); } });
    await act(async () => { fixture.set([bad, good]); });
    rerender(<NativeSlotHost slot="actions" kind="list" source={fixture.source} locale={locale} standard={standard} fallback={<span data-testid="fallback">empty</span>} />);
    expect(screen.getByTestId('good')).toBeTruthy();
    expect(screen.queryByTestId('fallback')).toBeNull();
  });

  it('re-renders bound entry copy when the native locale revision changes', async () => {
    const localeState = { revision: 0, listeners: new Set<() => void>() };
    const changing: NativeLocaleSource = {
      bind: namespace => key => namespace + ':' + key + ':' + String(localeState.revision),
      getSnapshot: () => ({ revision: localeState.revision }),
      subscribe: listener => { localeState.listeners.add(listener); return () => { localeState.listeners.delete(listener); }; },
    };
    const translated = entry('translated', { component: (props: Record<string, unknown>) => <span data-testid="translated">{(props.t as (key: string) => string)('label')}</span>, locale: 'settings.agentPreset' });
    render(<NativeSlotHost slot="actions" kind="list" source={source([translated]).source} locale={changing} standard={standard} />);
    expect(screen.getByTestId('translated').textContent).toBe('settings.agentPreset:label:0');
    await act(async () => { localeState.revision = 1; for (const listener of localeState.listeners) listener(); });
    expect(screen.getByTestId('translated').textContent).toBe('settings.agentPreset:label:1');
  });

  it('skips store-backed entries and applies a face override', () => {
    const openChild = vi.fn();
    const overriddenOpen = vi.fn();
    const override = vi.fn((face: Record<string, unknown>) => ({ ...face, openChild: overriddenOpen }));
    const action = entry('subagent-catalog', {
      component: (props: Record<string, unknown>) => createElement('button', { onClick: () => (props.openChild as () => void)() }, 'catalog'),
      inject: () => ({ openChild }),
    });
    render(<NativeSlotHost slot="actions" kind="list" source={source([entry('corner', { store: {} }), action]).source} locale={locale} standard={standard} override={(face) => override(face) as Record<string, unknown>} />);
    screen.getByRole('button', { name: 'catalog' }).click();
    expect(openChild).not.toHaveBeenCalled();
    expect(overriddenOpen).toHaveBeenCalledOnce();
    expect(override).toHaveBeenCalledOnce();
  });
});
