import { describe, expect, it } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller';
import type { ScheduleModelSelection } from '../../src/shared/types.js';
import { createScheduleModelPort } from '../../src/host/schedule-model.js';

const catalog: ModelCatalog = {
  default: { provider: 'deepseek', model: 'chat' },
  routableProviders: ['deepseek'],
  groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'chat', name: 'Chat' }, { id: 'reason', name: 'Reason' }] }],
  failures: [],
};

interface HarnessOptions {
  sessionFace?: boolean;
  resolveError?: { code: string; message: string };
  catalog?: ModelCatalog;
}

function harness(options: HarnessOptions = {}) {
  const selects: ScheduleModelSelection[] = [];
  const resolvedCalls: Array<{ sessionId: string }> = [];
  const catalogCalls = { count: 0 };
  const agent = {
    id: 'agent',
    model: options.sessionFace === false ? undefined : { select: (selection: ScheduleModelSelection) => { selects.push({ ...selection }); } },
  };
  const ctx = {
    llm: {
      resolveCallConfig: async (config: { provider: string; model: string; reasoningEffort?: string }) => ({
        ...config,
        ...(config.reasoningEffort === undefined ? {} : { reasoningEffort: config.reasoningEffort }),
      }),
    },
    sessionController: {
      modelCatalog: async () => { catalogCalls.count += 1; return options.catalog ?? catalog; },
      resolveAgent: async (sessionId: string) => {
        resolvedCalls.push({ sessionId });
        return options.resolveError === undefined ? { agent } : { error: options.resolveError };
      },
    },
  } as unknown as Context;
  return { ctx, selects, resolvedCalls, catalogCalls };
}

describe('session-only schedule model port', () => {
  it('installs the selection on the conversation Agent without any default write', async () => {
    const harnessed = harness();
    const port = createScheduleModelPort(harnessed.ctx);
    await port.apply('session', { provider: 'deepseek', model: 'reason', reasoningEffort: 'high' });
    expect(harnessed.resolvedCalls).toEqual([{ sessionId: 'session' }]);
    expect(harnessed.selects).toEqual([{ provider: 'deepseek', model: 'reason', reasoningEffort: 'high' }]);
  });

  it('refuses a model that is no longer in the host catalog before touching the Agent', async () => {
    const harnessed = harness();
    const port = createScheduleModelPort(harnessed.ctx);
    await expect(port.apply('session', { provider: 'deepseek', model: 'gone' })).rejects.toThrowError(/no longer available/);
    expect(harnessed.resolvedCalls).toHaveLength(0);
    expect(harnessed.selects).toHaveLength(0);
  });

  it('fails closed when the host exposes no session-only selection face', async () => {
    const harnessed = harness({ sessionFace: false });
    const port = createScheduleModelPort(harnessed.ctx);
    await expect(port.apply('session', { provider: 'deepseek', model: 'reason' })).rejects.toThrowError(/without changing the installation default/);
    expect(harnessed.selects).toHaveLength(0);
  });

  it('propagates a session resolution failure', async () => {
    const harnessed = harness({ resolveError: { code: 'session/not-found', message: 'The conversation does not exist.' } });
    const port = createScheduleModelPort(harnessed.ctx);
    await expect(port.apply('session', { provider: 'deepseek', model: 'reason' })).rejects.toMatchObject({ code: 'session/not-found' });
  });

  it('propagates a route validation failure', async () => {
    const ctx = {
      llm: { resolveCallConfig: async () => { throw new Error('unknown provider'); } },
      sessionController: { modelCatalog: async () => catalog, resolveAgent: async () => ({ agent: { model: { select: () => {} } } }) },
    } as unknown as Context;
    const port = createScheduleModelPort(ctx);
    await expect(port.apply('session', { provider: 'nope', model: 'reason' })).rejects.toThrow('unknown provider');
  });
});
