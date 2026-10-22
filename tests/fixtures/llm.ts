import { LlmAdapter, type GenerateOptions, type LlmModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm';

export interface FixtureTurn {
  text?: string;
  tool?: { name: string; arguments: Record<string, unknown> };
  error?: { code: string; message: string };
  delayMs?: number;
}

/**
 * Deterministic test-only provider. It never performs network I/O and returns
 * one scripted turn per stream call, falling back to a fixed text response.
 */
export class ScriptedAdapter extends LlmAdapter {
  private turns: FixtureTurn[];
  constructor(turns: FixtureTurn[] = [{ text: 'Fixture response.' }]) {
    super();
    this.turns = [...turns];
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return [{ provider, id: 'deterministic-1', name: 'Deterministic fixture', inputModalities: ['text'] }];
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const turn = this.turns.shift() ?? { text: 'Fixture response.' };
    if (turn.delayMs) await new Promise<void>(resolve => setTimeout(resolve, turn.delayMs));
    options.signal?.throwIfAborted();
    if (turn.error) {
      yield { type: 'finish', reason: { kind: 'error', failure: { code: turn.error.code, message: turn.error.message } } };
      return;
    }
    if (turn.tool) {
      const id = 'fixture-call-1' as never;
      const args = JSON.stringify(turn.tool.arguments);
      yield { type: 'block-start', index: 0, blockType: 'tool-call' };
      yield { type: 'tool-call-delta', index: 0, id, name: turn.tool.name, argumentsDelta: args };
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: turn.tool.name, arguments: args } };
      yield { type: 'finish', reason: { kind: 'tool-calls' } };
      return;
    }
    const text = turn.text ?? '';
    yield { type: 'block-start', index: 0, blockType: 'text' };
    if (text) yield { type: 'text-delta', index: 0, text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
