import { describe, expect, it } from 'vitest';
import { writeBoardDefaultsField } from '../../src/domain/board-defaults-field.js';
import { writeBoardAgentPresetField } from '../../src/domain/board-agent-preset-field.js';
import { writeBoardModelField } from '../../src/domain/board-model-field.js';
import { parseWorkflow } from '../../src/domain/workflow.js';

const authored = [
  'name: Delivery Flow',
  '# the flow comment',
  'initial_column: backlog',
  'columns:',
  '  - id: backlog',
  '    label: Backlog # keep me',
  '  - id: done',
  '    label: Done',
  '',
].join('\n');
const route = { provider: 'anthropic', model: 'claude-sonnet-4-5', reasoningEffort: 'high' };

describe('writing the board defaults together', () => {
  it('writes both root fields in one document and preserves every other character', () => {
    const next = writeBoardDefaultsField(authored, { model: route, preset: 'standard' });
    expect(parseWorkflow(next).model).toEqual(route);
    expect(parseWorkflow(next).agentPreset).toBe('standard');
    expect(next).toContain('# the flow comment');
    expect(next).toContain('label: Backlog # keep me');
    expect(next).toBe(writeBoardAgentPresetField(writeBoardModelField(authored, route), 'standard'));
  });

  it('changes only the model when the preset stays absent', () => {
    const next = writeBoardDefaultsField(authored, { model: route, preset: undefined });
    expect(parseWorkflow(next).model).toEqual(route);
    expect(parseWorkflow(next).agentPreset).toBeUndefined();
    expect(next).not.toContain('agent_preset');
  });

  it('changes only the preset when the model stays absent', () => {
    const next = writeBoardDefaultsField(authored, { model: undefined, preset: 'standard' });
    expect(parseWorkflow(next).model).toBeUndefined();
    expect(parseWorkflow(next).agentPreset).toBe('standard');
    expect(next).not.toContain('model:');
  });

  it('returns the authored document untouched when neither default is set', () => {
    expect(writeBoardDefaultsField(authored, { model: undefined, preset: undefined })).toBe(authored);
  });

  it('keeps the preset when only the model is rewritten', () => {
    const stored = writeBoardAgentPresetField(authored, 'standard');
    const next = writeBoardDefaultsField(stored, { model: route, preset: 'standard' });
    expect(parseWorkflow(next).agentPreset).toBe('standard');
    expect(next.match(/^agent_preset: /gm)).toHaveLength(1);
  });
});

describe('writing the board MCP allowlist with the other defaults', () => {
  it('writes all three root fields in one document', () => {
    const next = writeBoardDefaultsField(authored, { model: route, preset: 'standard', mcp: { mode: 'selected', entries: ['atlassian', 'trino/query'] } });
    expect(parseWorkflow(next).model).toEqual(route);
    expect(parseWorkflow(next).agentPreset).toBe('standard');
    expect(parseWorkflow(next).mcp).toEqual(['atlassian', 'trino/query']);
    expect(next).toContain('# the flow comment');
    expect(next).toContain('label: Backlog # keep me');
  });

  it('authors an empty list for an explicit selection with no server', () => {
    const next = writeBoardDefaultsField(authored, { model: undefined, preset: undefined, mcp: { mode: 'selected', entries: [] } });
    expect(parseWorkflow(next).mcp).toEqual([]);
    expect(next).toContain('mcp: []');
  });

  it('removes the field when every server stays visible', () => {
    const stored = writeBoardDefaultsField(authored, { model: undefined, preset: undefined, mcp: { mode: 'selected', entries: ['atlassian'] } });
    const next = writeBoardDefaultsField(stored, { model: undefined, preset: undefined, mcp: { mode: 'all' } });
    expect(parseWorkflow(next).mcp).toBeUndefined();
    expect(next).toBe(authored);
  });

  it('leaves the authored field untouched when the caller does not name the allowlist', () => {
    const stored = writeBoardDefaultsField(authored, { model: undefined, preset: undefined, mcp: { mode: 'selected', entries: ['atlassian'] } });
    const next = writeBoardDefaultsField(stored, { model: route, preset: undefined });
    expect(parseWorkflow(next).mcp).toEqual(['atlassian']);
  });
});
