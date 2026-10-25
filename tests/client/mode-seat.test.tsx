// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';
import { NativeModeSeat } from '../../src/client/mode-seat.js';
import { ModeSeatController } from '../../src/client/mode-seat-controller.js';
import type { ModePort } from '../../src/client/mode-port.js';
import type { NativeLocaleSource, NativeSlotSource } from '../../src/client/native-slot-host.js';

afterEach(cleanup);
const locale: NativeLocaleSource = { bind: namespace => key => namespace + ':' + key, getSnapshot: () => ({ revision: 0 }), subscribe: () => () => {} };
function source(entry: StoredEntry | undefined): NativeSlotSource { return { entriesOfSlot: () => entry === undefined ? [] : [entry], subscribe: () => () => {} }; }
function entry(component: (props: Record<string, unknown>) => JSX.Element): StoredEntry { return { component, options: { id: 'seat' } } as unknown as StoredEntry; }

describe('NativeModeSeat', () => {
  it('passes a synthetic mainView retention gate and never calls the real retain hook', async () => {
    const realRetain = vi.fn();
    const port: ModePort = { list: vi.fn(async () => [{ id: 'standard', name: 'Standard', isDefault: true }, { id: 'ptc', name: 'PTC' }]), select: vi.fn(async () => ({ ok: true })) };
    const controller = new ModeSeatController(port, 'a', () => 'standard');
    let seen: Record<string, unknown> | undefined; let retained: unknown;
    const developerTools = { getSnapshot: () => false, subscribe: () => () => {} };
    const seat = entry(props => {
      seen = props;
      retained = (props.useSessionRetainInfo as (selector: (value: unknown) => unknown) => unknown)(value => (value as { retainedBy: { mainView: number } }).retainedBy.mainView);
      const tools = (props.useDeveloperTools as (selector: (value: boolean) => boolean) => boolean)(value => value);
      useEffect(() => { void (props.load as () => Promise<void>)(); }, [props.load]);
      return <button data-developer-tools={String(tools)} onClick={() => void (props.select as (id: string) => Promise<void>)('ptc')}>Pick PTC</button>;
    });
    render(<NativeModeSeat sessionId="a" source={source(seat)} locale={locale} standard={{ useSessionRetainInfo: realRetain }} controller={controller} enabled developerTools={developerTools} />);
    expect(seen).toBeDefined();
    expect(retained).toBe(1);
    expect(realRetain).not.toHaveBeenCalled();
    expect(seen?.sessionId).toBe('a');
    expect(screen.getByRole('button', { name: 'Pick PTC' }).getAttribute('data-developer-tools')).toBe('false');
    expect((seen?.t as (key: string) => string)('label')).toBe('settings.agentPreset:label');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pick PTC' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Pick PTC' }));
    await waitFor(() => expect(port.select).toHaveBeenCalledWith('a', 'ptc'));
  });

  it('renders nothing when disabled, without a controller, or without the native seat', () => {
    const component = vi.fn(() => <span data-testid="seat" />);
    const controller = new ModeSeatController({ list: vi.fn(async () => []), select: vi.fn(async () => ({ ok: true })) }, 'a', () => undefined);
    const { rerender } = render(<NativeModeSeat sessionId="a" source={source(entry(component))} locale={locale} standard={{}} controller={controller} enabled={false} />);
    expect(component).not.toHaveBeenCalled();
    rerender(<NativeModeSeat sessionId="a" source={source(entry(component))} locale={locale} standard={{}} controller={null} enabled />);
    expect(component).not.toHaveBeenCalled();
    rerender(<NativeModeSeat sessionId="a" source={source(undefined)} locale={locale} standard={{}} controller={controller} enabled />);
    expect(component).not.toHaveBeenCalled();
  });
});
