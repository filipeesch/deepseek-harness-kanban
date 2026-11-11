import { describe, expect, it } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller';
import type { ModelSelection } from '../../src/shared/types.js';
import { createSessionModelPort } from '../../src/host/session-model.js';

const catalog: ModelCatalog = {
  default: { provider: 'deepseek', model: 'chat' },
  routableProviders: ['deepseek'],
  groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'chat', name: 'Chat' }, { id: 'reason', name: 'Reason' }] }],
  failures: [],
};

interface HarnessOptions {
  sessionFace?: boolean;
  /** What `resolveAgent` answers instead of an Agent; a host refusal is a plain object. */
  resolveError?: { code: string; message: string };
  catalog?: ModelCatalog;
  resolveErrorText?: string;
  /** Set to make the host refuse the selection on the conversation itself. */
  selectErrorText?: string;
  /** Set to make the catalog itself unreadable. */
  catalogError?: boolean;
  /** How long the host takes to answer a catalog read, for coalescing checks. */
  catalogDelayMs?: number;
}

function harness(options: HarnessOptions = {}) {
  const selects: ModelSelection[] = [];
  const resolvedCalls: Array<{ sessionId: string }> = [];
  const catalogCalls = { count: 0 };
  const defaultWrites: ModelSelection[] = [];
  const agent = {
    id: 'agent',
    model: options.sessionFace === false ? undefined : {
      select: (selection: ModelSelection) => {
        if (options.selectErrorText !== undefined) throw new Error(options.selectErrorText);
        selects.push({ ...selection });
      },
    },
  };
  const ctx = {
    llm: {
      resolveCallConfig: async (config: { provider: string; model: string; reasoningEffort?: string }) => {
        if (options.resolveErrorText !== undefined) throw new Error(options.resolveErrorText);
        return { ...config, ...(config.reasoningEffort === undefined ? {} : { reasoningEffort: config.reasoningEffort }) };
      },
    },
    sessionController: {
      modelCatalog: async () => {
        catalogCalls.count += 1;
        if (options.catalogError === true) throw new Error('catalog offline');
        if (options.catalogDelayMs !== undefined) await new Promise(resolve => setTimeout(resolve, options.catalogDelayMs));
        return options.catalog ?? catalog;
      },
      resolveAgent: async (sessionId: string) => {
        resolvedCalls.push({ sessionId });
        return options.resolveError === undefined ? { agent } : { error: options.resolveError };
      },
    },
    // The host command that also saves the deployment default. The plugin must
    // never reach it, so any call is a test failure rather than a silent write.
    remote: { session: { selectModel: async (request: ModelSelection) => { defaultWrites.push(request); throw new Error('the installation default must never be written'); } } },
  } as unknown as Context;
  return { ctx, selects, resolvedCalls, catalogCalls, defaultWrites };
}

describe('session model port', () => {
  it('installs the selection on the conversation Agent without any default write', async () => {
    const harnessed = harness();
    const port = createSessionModelPort(harnessed.ctx);
    const outcome = await port.apply('session', { provider: 'deepseek', model: 'reason', reasoningEffort: 'high' });
    expect(outcome).toEqual({ applied: true });
    expect(harnessed.resolvedCalls).toEqual([{ sessionId: 'session' }]);
    expect(harnessed.selects).toEqual([{ provider: 'deepseek', model: 'reason', reasoningEffort: 'high' }]);
    expect(harnessed.defaultWrites).toEqual([]);
  });

  it('reports a model that left the host catalog as unavailable before touching the Agent', async () => {
    const harnessed = harness();
    const port = createSessionModelPort(harnessed.ctx);
    const outcome = await port.apply('session', { provider: 'deepseek', model: 'gone' });
    expect(outcome).toMatchObject({ applied: false, reason: 'unavailable', message: expect.stringMatching(/no longer available/) });
    expect(harnessed.resolvedCalls).toHaveLength(0);
    expect(harnessed.selects).toHaveLength(0);
    expect(harnessed.defaultWrites).toEqual([]);
  });

  it('reports a route the host cannot name as unavailable rather than throwing', async () => {
    const port = createSessionModelPort(harness({ resolveErrorText: 'unknown provider' }).ctx);
    expect(await port.apply('session', { provider: 'nope', model: 'reason' }))
      .toMatchObject({ applied: false, reason: 'unavailable' });
  });

  it('reports a host with no session-only selection face as unsupported', async () => {
    const harnessed = harness({ sessionFace: false });
    const port = createSessionModelPort(harnessed.ctx);
    const outcome = await port.apply('session', { provider: 'deepseek', model: 'reason' });
    expect(outcome).toMatchObject({ applied: false, reason: 'unsupported', message: expect.stringMatching(/without changing the installation default/) });
    expect(harnessed.selects).toHaveLength(0);
    expect(harnessed.defaultWrites).toEqual([]);
  });

  it('reports a session that the host cannot resolve as a failure, keeping what it said', async () => {
    const harnessed = harness({ resolveError: { code: 'session/not-found', message: 'The conversation does not exist.' } });
    const port = createSessionModelPort(harnessed.ctx);
    const outcome = await port.apply('session', { provider: 'deepseek', model: 'reason' });
    // No policy may catch this, so it has to arrive as a reason with the host's own
    // words and the route the conversation is left on.
    expect(outcome).toEqual({ applied: false, reason: 'failed', message: 'The conversation does not exist.', inUse: { provider: 'deepseek', model: 'chat' } });
    expect(harnessed.selects).toHaveLength(0);
    expect(harnessed.defaultWrites).toEqual([]);
  });

  it('reports a host refusal on the conversation itself as a failure', async () => {
    const port = createSessionModelPort(harness({ selectErrorText: 'The conversation is sealed.' }).ctx);
    expect(await port.apply('session', { provider: 'deepseek', model: 'reason' }))
      .toMatchObject({ applied: false, reason: 'failed', message: 'The conversation is sealed.' });
  });

  it('reports an unreadable catalog as a failure with no route to name', async () => {
    const port = createSessionModelPort(harness({ catalogError: true }).ctx);
    const outcome = await port.apply('session', { provider: 'deepseek', model: 'reason' });
    expect(outcome).toMatchObject({ applied: false, reason: 'failed' });
    expect(outcome).not.toHaveProperty('inUse');
  });

  it('says the standing sentence when the host gives a refusal with no words', async () => {
    const port = createSessionModelPort(harness({ resolveError: { code: 'session/unavailable', message: '  ' } }).ctx);
    expect(await port.apply('session', { provider: 'deepseek', model: 'reason' }))
      .toMatchObject({ applied: false, reason: 'failed', message: 'The host could not resolve this conversation (code session/unavailable).' });
  });

  it('answers simultaneous readers with one host read and lets a refresh through', async () => {
    const harnessed = harness({ catalogDelayMs: 5 });
    const port = createSessionModelPort(harnessed.ctx);
    const [first, second] = await Promise.all([port.catalog(), port.catalog()]);
    expect(first).toEqual(second);
    expect(harnessed.catalogCalls.count).toBe(1);
    // A reader who asked for fresh data must not be answered by a read that started
    // before they asked.
    await port.catalog(true);
    expect(harnessed.catalogCalls.count).toBe(2);
  });

  it('lets a reader try again after a catalog read failed', async () => {
    const harnessed = harness({ catalogError: true });
    const port = createSessionModelPort(harnessed.ctx);
    await expect(port.catalog()).rejects.toThrow('catalog offline');
    await expect(port.catalog()).rejects.toThrow('catalog offline');
    expect(harnessed.catalogCalls.count).toBe(2);
  });

  it('serves the catalog and re-reads it on request', async () => {
    const harnessed = harness();
    const port = createSessionModelPort(harnessed.ctx, { now: () => 0 });
    await port.catalog();
    await port.catalog();
    expect(harnessed.catalogCalls.count).toBe(1);
    await port.catalog(true);
    expect(harnessed.catalogCalls.count).toBe(2);
  });
});
