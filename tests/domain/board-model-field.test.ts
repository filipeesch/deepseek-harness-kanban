import { describe, expect, it } from 'vitest';
import { writeBoardModelField } from '../../src/domain/board-model-field.js';
import { parseWorkflow } from '../../src/domain/workflow.js';

const authored = [
  'name: Delivery Flow',
  '# the starting stage of the board',
  'initial_column: backlog',
  'columns:',
  '  - id: backlog',
  '    label: Backlog',
  '  - id: done',
  '    label: Done',
  '',
].join('\n');

const model = { provider: 'anthropic', model: 'claude-sonnet-4-5', reasoningEffort: 'high' };

describe('writing the board default model', () => {
  it('appends the mapping without touching any other authored character', () => {
    const next = writeBoardModelField(authored, model);
    expect(next).toContain('  - id: done\n    label: Done\nmodel:\n  provider: anthropic\n  model: claude-sonnet-4-5\n  reasoning_effort: high\n');
    expect(next).toContain('# the starting stage of the board');
    expect(parseWorkflow(next).model).toEqual(model);
  });

  it('rewrites an authored mapping in place, keeping the key order and the comments around it', () => {
    const withModel = writeBoardModelField(authored, model);
    const withComment = withModel.replace('initial_column: backlog', 'initial_column: backlog # keep me');
    const next = writeBoardModelField(withComment, { provider: 'openai', model: 'gpt-5' });
    expect(next).toContain('# keep me');
    expect(next.match(/^model:$/gm)).toHaveLength(1);
    expect(parseWorkflow(next).model).toEqual({ provider: 'openai', model: 'gpt-5' });
    expect(next).not.toContain('reasoning_effort');
  });

  it('removes the mapping when the board returns to the deployment default', () => {
    const cleared = writeBoardModelField(writeBoardModelField(authored, model), undefined);
    expect(cleared).toBe(authored);
    expect(parseWorkflow(cleared).model).toBeUndefined();
  });

  it('leaves a document that names no model untouched when clearing', () => {
    expect(writeBoardModelField(authored, undefined)).toBe(authored);
  });

  it('quotes a route that YAML would otherwise misread', () => {
    const next = writeBoardModelField(authored, { provider: 'true', model: '2026-01' });
    expect(next).toContain("provider: 'true'");
    expect(next).toContain("model: '2026-01'");
    expect(parseWorkflow(next).model).toEqual({ provider: 'true', model: '2026-01' });
  });

  it('keeps a flow document readable', () => {
    const flow = '{name: Flow, initial_column: one, columns: [{id: one, label: One}]}';
    const next = writeBoardModelField(flow, { provider: 'anthropic', model: 'claude' });
    expect(parseWorkflow(next).model).toEqual({ provider: 'anthropic', model: 'claude' });
  });

  it('drops a blank effort rather than authoring an empty one', () => {
    const next = writeBoardModelField(authored, { provider: 'anthropic', model: 'claude', reasoningEffort: '  ' });
    expect(next).not.toContain('reasoning_effort');
  });

  it('clears the mapping when the route itself is blank', () => {
    expect(writeBoardModelField(writeBoardModelField(authored, model), { provider: '', model: '' })).toBe(authored);
  });
});
