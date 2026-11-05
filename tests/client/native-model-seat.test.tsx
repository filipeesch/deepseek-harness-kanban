// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';
import { MODEL_SELECTION_SLOT, NativeModelSeat, type PreparationSeat } from '../../src/client/execution-preparation/model-seat.js';
import type { NativeLocaleSource, NativeSlotSource } from '../../src/client/native-slot-host.js';

afterEach(cleanup);

const locale: NativeLocaleSource = {
  bind: () => key => key,
  getSnapshot: () => ({ revision: 0 }),
  subscribe: () => () => {},
};

function source(entry: StoredEntry | undefined): NativeSlotSource {
  return {
    entriesOfSlot: key => key === MODEL_SELECTION_SLOT && entry !== undefined ? [entry] : [],
    subscribe: () => () => {},
  };
}

function seatWith(entry: StoredEntry | undefined): PreparationSeat {
  return { slots: source(entry), locale };
}

describe('NativeModelSeat', () => {
  it('mounts the native seat for the exact session without submitting a selection', async () => {
    const select = vi.fn(async () => ({ ok: true }));
    const load = vi.fn(async () => undefined);
    let seen: Record<string, unknown> | undefined;
    const StubSeat = (props: Record<string, unknown>) => {
      seen = props;
      useEffect(() => { void (props.load as () => Promise<void>)(); }, [props.load]);
      const label = (props.renderSlot as (key: string, owner: unknown, options: { fallback: string }) => React.ReactNode)('conversation.input.model.label', {}, { fallback: 'Default Model' });
      return <button type="button" onClick={() => void (props.select as (value: unknown) => Promise<unknown>)({ provider: 'deepseek', model: 'deepseek-chat' })}>{label}</button>;
    };
    const entry = {
      component: StubSeat,
      options: { id: 'model-seat' },
      locale: 'ui-model-selection',
      inject: (sessionId: string) => ({ available: true, directory: { subscribe: () => () => {}, getSnapshot: () => ({}) }, load, select, sessionId }),
    } as unknown as StoredEntry;
    const onSelectingChange = vi.fn();
    render(<NativeModelSeat seat={seatWith(entry)} sessionId="session-1" onSelectingChange={onSelectingChange} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Default Model' })).toBeTruthy());
    expect(seen?.sessionId).toBe('session-1');
    expect(seen?.locked).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Default Model' }));
    await waitFor(() => expect(select).toHaveBeenCalledTimes(1));
    expect(select).toHaveBeenCalledWith({ provider: 'deepseek', model: 'deepseek-chat' });
    expect(onSelectingChange.mock.calls).toEqual([[true], [false]]);
  });

  it('renders the fallback when the native seat is not composed', () => {
    render(<NativeModelSeat seat={seatWith(undefined)} sessionId="session-1" />);
    expect(screen.getByRole('status').textContent).toContain('The native model selector is unavailable.');
  });

  it('keeps the selecting signal false when the native select rejects', async () => {
    const select = vi.fn(async () => { throw new Error('Refused.'); });
    const StubSeat = (props: Record<string, unknown>) => <button type="button" onClick={() => void (props.select as (value: unknown) => Promise<unknown>)({ provider: 'p', model: 'm' }).catch(() => undefined)}>Pick</button>;
    const entry = {
      component: StubSeat,
      options: { id: 'model-seat' },
      inject: () => ({ available: true, directory: { subscribe: () => () => {}, getSnapshot: () => ({}) }, load: async () => undefined, select }),
    } as unknown as StoredEntry;
    const onSelectingChange = vi.fn();
    render(<NativeModelSeat seat={seatWith(entry)} sessionId="session-1" onSelectingChange={onSelectingChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pick' }));
    await waitFor(() => expect(onSelectingChange).toHaveBeenLastCalledWith(false));
    expect(onSelectingChange.mock.calls).toEqual([[true], [false]]);
  });
});
