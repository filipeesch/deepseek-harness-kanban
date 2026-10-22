import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { LlmRuntime, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { ScriptedAdapter } from '../fixtures/llm.js';

function runtime() { const ctx = new Context(); const service = new LlmRuntime(ctx); return { ctx, service }; }
async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> { const chunks: StreamChunk[] = []; for await (const chunk of stream) chunks.push(chunk); return chunks; }
const request = { provider: 'kanban-fixture', model: 'deterministic-1', messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }] } as never;

describe('deterministic fixture LLM adapter', () => {
  it('registers a provider, lists one model, and completes a scripted text stream', async () => {
    const { service } = runtime(); const adapter = new ScriptedAdapter([{ text: 'Deterministic hello.' }]);
    const dispose = service.registerAdapter(['kanban-fixture'], adapter);
    expect((await service.listModels('kanban-fixture')).map(model => model.id)).toEqual(['deterministic-1']);
    const chunks = await collect(service.stream(request));
    expect(chunks.map(chunk => chunk.type)).toEqual(['block-start', 'text-delta', 'block-end', 'finish']);
    expect(chunks.find(chunk => chunk.type === 'text-delta')?.text).toBe('Deterministic hello.');
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } });
    dispose();
    expect(service.listProviders()).toEqual([]);
  });

  it('supports scripted tool calls, errors, delays, and cancellation without network access', async () => {
    const { service } = runtime(); const adapter = new ScriptedAdapter([
      { tool: { name: 'list_cards', arguments: { query: 'fixture' } } },
      { error: { code: 'FIXTURE_FAILURE', message: 'The fixture failed.' } },
      { text: 'delayed', delayMs: 1 },
    ]);
    service.registerAdapter(['kanban-fixture'], adapter);
    const tool = await collect(service.stream(request));
    expect(tool.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'tool-calls' } });
    const failure = await collect(service.stream(request));
    expect(failure.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'FIXTURE_FAILURE' } } });
    const delayed = await collect(service.stream(request));
    expect(delayed.find(chunk => chunk.type === 'text-delta')?.text).toBe('delayed');
    const controller = new AbortController(); const aborted = new ScriptedAdapter([{ text: 'never', delayMs: 20 }]); service.registerAdapter(['kanban-abort'], aborted);
    const pending = collect(service.stream({ ...(request as object), provider: 'kanban-abort', signal: controller.signal } as never)); controller.abort();
    const abortedChunks = await pending; expect(abortedChunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'aborted' } });
  });


  it('selects a fixture provider per request without changing the global default', async () => {
    const { service } = runtime();
    service.registerAdapter(['kanban-fixture-a'], new ScriptedAdapter([{ text: 'A response' }]));
    service.registerAdapter(['kanban-fixture-b'], new ScriptedAdapter([{ text: 'B response' }]));
    const first = await collect(service.stream({ ...(request as object), provider: 'kanban-fixture-a' } as never));
    const second = await collect(service.stream({ ...(request as object), provider: 'kanban-fixture-b' } as never));
    expect(first.find(chunk => chunk.type === 'text-delta')?.text).toBe('A response');
    expect(second.find(chunk => chunk.type === 'text-delta')?.text).toBe('B response');
    expect(service.listProviders().map(provider => provider.id).sort()).toEqual(['kanban-fixture-a', 'kanban-fixture-b']);
  });

  it('keeps existing in-memory fakes independent of the fixture adapter', async () => {
    const { service } = runtime(); expect(service.listProviders()).toEqual([]);
    const adapter = new ScriptedAdapter(); const dispose = service.registerAdapter(['kanban-fixture'], adapter);
    expect(service.listProviders().map(provider => provider.id)).toEqual(['kanban-fixture']); dispose();
  });
});
