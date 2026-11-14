import { describe, expect, it, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { createSessionPresetPort } from '../../src/host/session-preset.js';

interface HarnessOptions {
  /** Present a registry; absent stands for a deployment without the service. */
  presets?: boolean;
  /** What the registry's select does. */
  select?: (agent: unknown, presetId: string) => Promise<string>;
  /** What resolveAgent answers. */
  resolve?: () => Promise<{ agent?: unknown; error?: unknown }>;
}

function harness(options: HarnessOptions = {}) {
  const agent = { id: 'agent' };
  const select = vi.fn(options.select ?? (async () => 'standard'));
  const resolveAgent = vi.fn(options.resolve ?? (async () => ({ agent })));
  const ctx = {
    get: (name: string) => (name === 'agentPresets' && options.presets !== false ? { select } : undefined),
    sessionController: { resolveAgent },
  } as unknown as Context;
  return { ctx, agent, select, resolveAgent };
}

function refusal(code: string): unknown {
  return { code, message: 'The preset registry refused the selection.' };
}

describe('session preset port', () => {
  it('selects the preset on the conversation Agent and never touches the installation default', async () => {
    const harnessed = harness();
    const port = createSessionPresetPort(harnessed.ctx);
    expect(await port.apply('session-1', 'standard')).toEqual({ applied: true });
    expect(harnessed.resolveAgent).toHaveBeenCalledWith('session-1');
    expect(harnessed.select).toHaveBeenCalledWith(harnessed.agent, 'standard');
  });

  it('reports a preset the host no longer offers as unavailable', async () => {
    const port = createSessionPresetPort(harness({ select: async () => { throw refusal('agent-preset/not-found'); } }).ctx);
    expect(await port.apply('session-1', 'retired')).toEqual({ applied: false, reason: 'unavailable' });
  });

  it('reports a preset that cannot compose a session as unavailable', async () => {
    const port = createSessionPresetPort(harness({ select: async () => { throw refusal('agent-preset/invalid'); } }).ctx);
    expect(await port.apply('session-1', 'broken')).toEqual({ applied: false, reason: 'unavailable' });
  });

  it('reports a host without the registry as unsupported', async () => {
    const harnessed = harness({ presets: false });
    expect(await createSessionPresetPort(harnessed.ctx).apply('session-1', 'standard')).toEqual({ applied: false, reason: 'unsupported' });
    expect(harnessed.select).not.toHaveBeenCalled();
  });

  it('reports an unresolved Agent as a failure', async () => {
    const harnessed = harness({ resolve: async () => ({ error: { code: 'session/not-found' } }) });
    expect(await createSessionPresetPort(harnessed.ctx).apply('session-1', 'standard')).toEqual({ applied: false, reason: 'failed' });
    expect(harnessed.select).not.toHaveBeenCalled();
  });

  it('reports an Agent resolution that throws as a failure', async () => {
    const port = createSessionPresetPort(harness({ resolve: async () => { throw new Error('offline'); } }).ctx);
    expect(await port.apply('session-1', 'standard')).toEqual({ applied: false, reason: 'failed' });
  });

  it('reports a session whose first turn already started as a failure', async () => {
    const port = createSessionPresetPort(harness({ select: async () => { throw refusal('agent-preset/locked'); } }).ctx);
    expect(await port.apply('session-1', 'standard')).toEqual({ applied: false, reason: 'failed' });
  });

  it('reports any other selection refusal as a failure without rejecting', async () => {
    const port = createSessionPresetPort(harness({ select: async () => { throw new Error('boom'); } }).ctx);
    await expect(port.apply('session-1', 'standard')).resolves.toEqual({ applied: false, reason: 'failed' });
  });
});
