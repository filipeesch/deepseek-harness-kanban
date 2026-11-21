import { describe, expect, it, vi } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { registerPreStepInjection, type PreStepInjection } from '../../src/host/pre-step-injection.js';

const message = (text: string, kind = 'user') => createUserMessage({ content: [{ type: 'text', text }], source: { kind } as never });
const agent = { id: SessionId('session-1') } as Agent;

function setup(injection: Partial<PreStepInjection> = {}) {
  const ctx = new Context();
  const select = vi.fn(injection.select ?? (async () => message('injected', 'kanban-task')));
  const reset = vi.fn(injection.reset ?? (() => {}));
  const dispose = registerPreStepInjection(ctx, { select, reset });
  const step = (messages: ReturnType<typeof message>[], signal = new AbortController().signal, decide?: () => Promise<never>) => ctx.waterfall(
    'agent/pre-step',
    { agent, turn: 1, step: 1, modelSelection: { provider: 'fixture', model: 'fixture' }, signal, messages },
    decide ?? (async () => ({ kind: 'enter' as const, messages })),
  );
  return { ctx, select, reset, dispose, step };
}

describe('pre-step injection', () => {
  it('puts the selected message before the step messages', async () => {
    const f = setup();
    const result = await f.step([message('Hello')]);
    if (result.kind !== 'enter') throw new Error('expected enter');
    expect(result.messages.map(value => (value.content[0] as { text: string }).text)).toEqual(['injected', 'Hello']);
    expect(f.select).toHaveBeenCalledWith(expect.objectContaining({ agent, messages: [expect.anything()] }));
  });

  it('puts a placed message after the step messages it names and keeps every step message', async () => {
    const f = setup({ select: async () => ({ message: message('injected', 'stage-notice'), after: 1 }) });
    const result = await f.step([message('First'), message('Second'), message('Third')]);
    if (result.kind !== 'enter') throw new Error('expected enter');
    expect(result.messages.map(value => (value.content[0] as { text: string }).text)).toEqual(['First', 'injected', 'Second', 'Third']);
  });

  it('keeps a placement inside the step messages', async () => {
    const high = setup({ select: async () => ({ message: message('injected'), after: 99 }) });
    const last = await high.step([message('First'), message('Second')]);
    const low = setup({ select: async () => ({ message: message('injected'), after: -3 }) });
    const first = await low.step([message('First'), message('Second')]);
    if (last.kind !== 'enter' || first.kind !== 'enter') throw new Error('expected enter');
    expect(last.messages.map(value => (value.content[0] as { text: string }).text)).toEqual(['First', 'Second', 'injected']);
    expect(first.messages.map(value => (value.content[0] as { text: string }).text)).toEqual(['injected', 'First', 'Second']);
  });

  it('leaves the step alone when the injector selects nothing', async () => {
    const f = setup({ select: async () => undefined });
    const result = await f.step([message('Hello')]);
    if (result.kind !== 'enter') throw new Error('expected enter');
    expect(result.messages).toHaveLength(1);
  });

  it('does not ask the injector about an empty step', async () => {
    const f = setup();
    const result = await f.step([]);
    if (result.kind !== 'enter') throw new Error('expected enter');
    expect(result.messages).toHaveLength(0);
    expect(f.select).not.toHaveBeenCalled();
  });

  it('returns a rejected decision unchanged without asking the injector', async () => {
    const f = setup();
    const decision = await f.step([message('Hello')], undefined, (async () => ({ kind: 'reject' as const })) as never);
    expect(decision).toEqual({ kind: 'reject' });
    expect(f.select).not.toHaveBeenCalled();
  });

  it('does not ask the injector about a step that is already aborted', async () => {
    const f = setup();
    const controller = new AbortController(); controller.abort();
    const result = await f.step([message('Hello')], controller.signal);
    if (result.kind !== 'enter') throw new Error('expected enter');
    expect(result.messages).toHaveLength(1);
    expect(f.select).not.toHaveBeenCalled();
  });

  it('drops a message the injector produced after the step was aborted', async () => {
    const controller = new AbortController();
    const f = setup({ select: async () => { controller.abort(); return message('injected', 'kanban-task'); } });
    const result = await f.step([message('Hello')], controller.signal);
    if (result.kind !== 'enter') throw new Error('expected enter');
    expect(result.messages).toHaveLength(1);
  });

  it('lets the injector forget an agent after a clear, and only after a clear', async () => {
    const f = setup();
    await f.ctx.serial('agent/created', { agent, source: 'clear' });
    expect(f.reset).toHaveBeenCalledWith(agent);
    f.reset.mockClear();
    await f.ctx.serial('agent/created', { agent, source: 'new' } as never);
    expect(f.reset).not.toHaveBeenCalled();
  });

  it('stops injecting once it is disposed', async () => {
    const f = setup(); f.dispose();
    const result = await f.step([message('Hello')]);
    if (result.kind !== 'enter') throw new Error('expected enter');
    expect(result.messages).toHaveLength(1);
    await f.ctx.serial('agent/created', { agent, source: 'clear' });
    expect(f.reset).not.toHaveBeenCalled();
  });
});
