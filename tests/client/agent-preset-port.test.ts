import { describe, expect, it, vi } from 'vitest';
import { AgentPresetPortError, createAgentPresetPort, createAgentPresetPortSource } from '../../src/client/agent-preset-port.js';

describe('createAgentPresetPortSource', () => {
  it('publishes a late-mounted namespace and withdraws it again', async () => {
    const namespace = {
      list: vi.fn(async () => ({ ok: true, value: { presets: [{ id: 'standard', name: 'Standard', isDefault: true }] } })),
      select: vi.fn(async () => ({ ok: true, value: 'standard' })),
    };
    const source = createAgentPresetPortSource(undefined, { developerTools: () => true });
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

describe('createAgentPresetPort', () => {
  const remote = (presets: readonly object[], select?: object) => ({
    agentPresets: {
      list: vi.fn(async () => ({ ok: true, value: { presets } })),
      select: vi.fn(async () => select ?? { ok: true, value: {} }),
    },
  });

  it('maps healthy presets and filters coding-tools modes when the preference is off', async () => {
    const value = remote([{ id: 'standard', name: 'Standard', isDefault: true }, { id: 'ptc' }, { id: 'custom-ptc', name: 'PTC' }, { id: 'broken', broken: 'bad' }]);
    const enabled = createAgentPresetPort(value, { developerTools: () => true })!;
    expect(await enabled.list()).toEqual([{ id: 'standard', name: 'Standard', isDefault: true }, { id: 'ptc' }, { id: 'custom-ptc', name: 'PTC' }]);
    const disabled = createAgentPresetPort(value, { developerTools: () => false })!;
    expect(await disabled.list()).toEqual([{ id: 'standard', name: 'Standard', isDefault: true }, { id: 'custom-ptc', name: 'PTC' }]);
  });

  it('surfaces the native selection reason and stays absent without the namespace', async () => {
    const value = remote([], { ok: false, error: { message: 'refused', details: { reason: 'not blank' } } });
    const port = createAgentPresetPort(value, { developerTools: () => true })!;
    await expect(port.select('session-a', 'ptc')).resolves.toEqual({ ok: false, message: 'not blank' });
    expect(value.agentPresets.select).toHaveBeenCalledWith('session-a', 'ptc');
    expect(createAgentPresetPort({}, { developerTools: () => true })).toBeNull();
  });

  it('turns a failing roster read into a typed port error', async () => {
    const value = { agentPresets: { list: vi.fn(async () => ({ ok: false, error: { message: 'offline' } })), select: vi.fn() } };
    const port = createAgentPresetPort(value, { developerTools: () => true })!;
    await expect(port.list()).rejects.toBeInstanceOf(AgentPresetPortError);
  });
});
