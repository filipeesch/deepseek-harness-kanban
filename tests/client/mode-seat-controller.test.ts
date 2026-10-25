import { describe, expect, it, vi } from 'vitest';
import { ModePortError, createModePort, createModePortSource, type ModePort, type ModeSelectResult } from '../../src/client/mode-port.js';
import { ModeSeatController } from '../../src/client/mode-seat-controller.js';

const options = [{ id: 'standard', name: 'Standard', isDefault: true }, { id: 'ptc', name: 'PTC' }];
function port(selectResult: Awaited<ReturnType<ModePort['select']>> = { ok: true }): ModePort {
  return { list: vi.fn(async () => options), select: vi.fn(async () => selectResult) };
}

describe('ModeSeatController', () => {
  it('loads the native roster and starts from the recorded or default preset', async () => {
    const current = vi.fn(() => 'ptc');
    const controller = new ModeSeatController(port(), 'session-a', current);
    await controller.load();
    expect(controller.getSnapshot()).toMatchObject({ options, current: 'ptc', busy: false, error: null });
    expect(current).toHaveBeenCalled();
  });

  it('selects the exact session and keeps the previous mode on refusal', async () => {
    const p = port({ ok: false, message: 'locked' });
    const controller = new ModeSeatController(p, 'session-a', () => 'standard');
    await controller.load();
    await expect(controller.select('ptc')).resolves.toBe('locked');
    expect(p.select).toHaveBeenCalledWith('session-a', 'ptc');
    expect(controller.getSnapshot()).toMatchObject({ current: 'standard', busy: false });
    expect(controller.getSnapshot().error).toMatchObject({ reason: 'locked', preset: { id: 'ptc' } });
    controller.dismissRefusal(controller.getSnapshot().error as never);
    expect(controller.getSnapshot().error).toBeNull();
  });

  it('records the canonical id returned by the host', async () => {
    const p = port({ ok: true, id: 'canonical' });
    const controller = new ModeSeatController(p, 'session-a', () => 'standard');
    await controller.load();
    await controller.select('alias');
    expect(controller.getSnapshot().current).toBe('canonical');
  });

  it('reports roster failure and clears the picker options without inventing a default', async () => {
    const p = port(); p.list = vi.fn(async () => { throw new Error('roster unavailable'); });
    const controller = new ModeSeatController(p, 'session-a', () => undefined);
    await controller.load();
    expect(controller.getSnapshot()).toMatchObject({ options: [], current: '', busy: false, error: 'roster unavailable' });
  });

  it('coalesces overlapping roster reads', async () => {
    const p = port();
    let resolveList!: (value: typeof options) => void;
    p.list = vi.fn(() => new Promise<typeof options>(resolve => { resolveList = resolve; }));
    const controller = new ModeSeatController(p, 'session-a', () => undefined);
    const first = controller.load(); const second = controller.load();
    expect(p.list).toHaveBeenCalledOnce();
    resolveList(options); await Promise.all([first, second]);
    expect(controller.getSnapshot().options).toEqual(options);
    expect(controller.getSnapshot().busy).toBe(false);
  });

  it('does not start overlapping selections', async () => {
    let resolve!: (value: ModeSelectResult) => void;
    const p = port(); p.select = vi.fn(() => new Promise<ModeSelectResult>(resolveSelection => { resolve = resolveSelection; }));
    const controller = new ModeSeatController(p, 'session-a', () => 'standard');
    await controller.load();
    const first = controller.select('ptc');
    await expect(controller.select('minimal')).resolves.toBeUndefined();
    expect(p.select).toHaveBeenCalledOnce();
    resolve({ ok: true }); await first;
    expect(controller.getSnapshot().current).toBe('ptc');
  });
});

describe('createModePortSource', () => {
  it('publishes a late-mounted namespace and withdraws it again', async () => {
    const namespace = { list: vi.fn(async () => ({ ok: true, value: { presets: [{ id: 'standard', name: 'Standard', isDefault: true }] } })), select: vi.fn(async () => ({ ok: true, value: 'standard' })) };
    const source = createModePortSource(undefined, { developerTools: () => true });
    const listener = vi.fn();
    source.subscribe(listener);
    expect(source.getSnapshot()).toBeNull();
    source.set(namespace);
    expect(listener).toHaveBeenCalledOnce();
    await expect(source.getSnapshot()!.list()).resolves.toEqual([{ id: 'standard', name: 'Standard', isDefault: true }]);
    source.set(undefined);
    expect(source.getSnapshot()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('createModePort', () => {
  const remote = (presets: readonly object[], select?: object) => ({
    agentPresets: {
      list: vi.fn(async () => ({ ok: true, value: { presets } })),
      select: vi.fn(async () => select ?? { ok: true, value: {} }),
    },
  });

  it('maps healthy presets and filters coding-tools modes when the preference is off', async () => {
    const value = remote([{ id: 'standard', name: 'Standard', isDefault: true }, { id: 'ptc' }, { id: 'custom-ptc', name: 'PTC' }, { id: 'broken', broken: 'bad' }]);
    const enabled = createModePort(value, { developerTools: () => true })!;
    expect(await enabled.list()).toEqual([{ id: 'standard', name: 'Standard', isDefault: true }, { id: 'ptc' }, { id: 'custom-ptc', name: 'PTC' }]);
    const disabled = createModePort(value, { developerTools: () => false })!;
    expect(await disabled.list()).toEqual([{ id: 'standard', name: 'Standard', isDefault: true }, { id: 'custom-ptc', name: 'PTC' }]);
  });

  it('surfaces the native selection reason and stays absent without the namespace', async () => {
    const value = remote([], { ok: false, error: { message: 'refused', details: { reason: 'not blank' } } });
    const port = createModePort(value, { developerTools: () => true })!;
    await expect(port.select('session-a', 'ptc')).resolves.toEqual({ ok: false, message: 'not blank' });
    expect(value.agentPresets.select).toHaveBeenCalledWith('session-a', 'ptc');
    expect(createModePort({}, { developerTools: () => true })).toBeNull();
  });

  it('turns a failing roster read into a typed port error', async () => {
    const value = { agentPresets: { list: vi.fn(async () => ({ ok: false, error: { message: 'offline' } })), select: vi.fn() } };
    const port = createModePort(value, { developerTools: () => true })!;
    await expect(port.list()).rejects.toBeInstanceOf(ModePortError);
  });
});
