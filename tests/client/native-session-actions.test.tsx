// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';
import { NativeSessionActions, nativeStatusActions, type NativeActionTranslate } from '../../src/client/native-session-actions.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function source<T>(initial: T) {
  return {
    value: initial,
    listeners: new Set<() => void>(),
    getSnapshot() { return this.value; },
    subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; },
    set(next: T) { this.value = next; for (const listener of this.listeners) listener(); },
  };
}

function entry(id: string, order: number, locale: string, component: React.ComponentType<Record<string, unknown>>, inject: (...args: unknown[]) => Record<string, unknown>): StoredEntry {
  return { component, options: { id, order }, locale, inject } as unknown as StoredEntry;
}

function standard() {
  return {
    sessionId: 's1',
    useSession: (selector: (value: unknown) => unknown) => selector({ openState: 'open', blank: false }),
    useSessions: (selector: (value: unknown) => unknown) => selector({ byId: { s1: { origin: 'root' } } }),
    useSessionStatus: (selector: (value: unknown) => unknown) => selector(new Map()),
    useSessionRetainInfo: (selector: (value: unknown) => unknown) => selector({ retainedBy: { kanbanTaskDrawer: 1 } }),
    useProjection: () => undefined,
    useAccess: () => true,
  };
}

describe('native session actions host', () => {
  it('renders the three pinned native entries in order with their inject faces, locale, and hooks', () => {
    const presetSource = source({ options: [{ id: 'standard', name: 'Standard' }] });
    const jobsSource = source({ rows: { s1: [{ id: 'job-1' }] } });
    const presetLoad = vi.fn(async () => {});
    const watchRows = vi.fn(() => () => {});
    const translate = vi.fn((namespace: string): NativeActionTranslate => key => namespace + ':' + key);

    function PresetProbe(props: Record<string, unknown>) {
      const options = (props.useAgentPresets as (selector: (value: unknown) => unknown) => readonly { id: string }[])(state => (state as { options: readonly { id: string }[] }).options);
      return <span data-testid="preset" data-load={typeof props.load}>preset:{options[0]?.id}:{(props.t as NativeActionTranslate)('label')}:{String(props.sessionId)}</span>;
    }
    function SubagentProbe(props: Record<string, unknown>) {
      const origin = (props.useSessions as (selector: (value: unknown) => unknown) => string)(state => (state as { byId: Record<string, { origin: string }> }).byId.s1!.origin);
      const status = (props.useSessionStatus as (selector: (value: unknown) => unknown) => unknown)(value => value);
      return <span data-testid="subagent" data-actions={[typeof props.openChild, typeof props.openChildAside, typeof props.refreshProjection].join(',')} data-status={status instanceof Map ? 'map' : typeof status}>subagents:{origin}:{(props.t as NativeActionTranslate)('count')}</span>;
    }
    function JobProbe(props: Record<string, unknown>) {
      const rows = (props.useJobs as (selector: (value: unknown) => unknown) => readonly { id: string }[])(state => (state as { rows: Record<string, readonly { id: string }[]> }).rows.s1 ?? []);
      return <span data-testid="jobs" data-actions={[typeof props.watchRows, typeof props.observe, typeof props.killJob].join(',')}>jobs:{rows.length}:{(props.t as NativeActionTranslate)('count')}</span>;
    }
    function TeamProbe() { return <span data-testid="team">team</span>; }

    const presetInject = vi.fn(() => ({ hooks: { agentPresets: presetSource }, load: presetLoad }));
    const preset = entry('agent-preset', -10, 'settings.agentPreset', PresetProbe, presetInject);
    const subagent = entry('subagent-catalog', 10, 'subagent', SubagentProbe, () => ({ openChild: vi.fn(), openChildAside: vi.fn(), refreshProjection: vi.fn() }));
    const jobs = entry('job-list', 20, 'job', JobProbe, () => ({ hooks: { jobs: jobsSource }, watchRows, observe: vi.fn(), killJob: vi.fn() }));
    const team = entry('agent-team', -20, 'team', TeamProbe, () => ({}));

    const { container } = render(<NativeSessionActions entries={[jobs, team, preset, subagent]} translate={translate} standard={standard()} />);

    expect(screen.queryByTestId('team')).toBeNull();
    expect(screen.getByTestId('preset').textContent).toBe('preset:standard:settings.agentPreset:label:s1');
    expect(screen.getByTestId('preset').getAttribute('data-load')).toBe('function');
    expect(screen.getByTestId('subagent').textContent).toBe('subagents:root:subagent:count');
    expect(screen.getByTestId('subagent').getAttribute('data-actions')).toBe('function,function,function');
    expect(screen.getByTestId('subagent').getAttribute('data-status')).toBe('map');
    expect(screen.getByTestId('jobs').textContent).toBe('jobs:1:job:count');
    expect(screen.getByTestId('jobs').getAttribute('data-actions')).toBe('function,function,function');
    expect(container.textContent?.indexOf('preset:')).toBeLessThan(container.textContent?.indexOf('subagents:') ?? -1);
    expect(container.textContent?.indexOf('subagents:')).toBeLessThan(container.textContent?.indexOf('jobs:') ?? -1);
    expect(preset.inject).toHaveBeenCalledWith('s1');
    expect(presetLoad).not.toHaveBeenCalled();

    act(() => { jobsSource.set({ rows: { s1: [{ id: 'job-1' }, { id: 'job-2' }] } }); });
    expect(screen.getByTestId('jobs').textContent).toBe('jobs:2:job:count');
  });

  it('hides when no native status entry is available and never renders header-only actions', () => {
    const team = entry('agent-team', -20, 'team', () => <span data-testid="team">team</span>, () => ({}));
    const { container } = render(<NativeSessionActions entries={[team]} translate={() => key => key} standard={standard()} />);
    expect(container.innerHTML).toBe('');
    expect(nativeStatusActions([team])).toEqual([]);
  });

  it('contains an assembly failure for one action without taking down the row', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const localeProbe = ({ t }: Record<string, unknown>) => <span data-testid="locale-probe">{(t as NativeActionTranslate)('mode')}</span>;
    const preset = entry('agent-preset', -10, 'settings.agentPreset', localeProbe, () => ({}));
    const jobs = entry('job-list', 20, 'job', () => <span data-testid="ok">ok</span>, () => ({}));
    const translate = (namespace: string): NativeActionTranslate => { if (namespace === 'settings.agentPreset') throw new Error('locale missing'); return key => key; };
    render(<NativeSessionActions entries={[preset, jobs]} translate={translate} standard={standard()} />);
    expect(screen.queryByTestId('locale-probe')).toBeNull();
    expect(screen.getByTestId('ok')).toBeTruthy();
    expect(errors).toHaveBeenCalled();
  });

  it('contains a crashing native action without taking down the row', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom = entry('job-list', 20, 'job', () => { throw new Error('native action failed'); }, () => ({}));
    const preset = entry('agent-preset', -10, 'settings.agentPreset', () => <span data-testid="ok">ok</span>, () => ({}));
    render(<NativeSessionActions entries={[boom, preset]} translate={() => key => key} standard={standard()} />);
    expect(screen.getByTestId('ok')).toBeTruthy();
    expect(errors).toHaveBeenCalled();
  });
});
