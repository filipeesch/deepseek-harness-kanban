import { describe, expect, it } from 'vitest';
import { writeBoardAgentPresetField } from '../../src/domain/board-agent-preset-field.js';
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

describe('writing the board default agent preset', () => {
  it('appends the scalar without touching any other authored character', () => {
    const next = writeBoardAgentPresetField(authored, 'kanban-workflow-architect');
    expect(next).toContain("agent_preset: kanban-workflow-architect\n");
    expect(next).toContain('# the starting stage of the board');
    expect(parseWorkflow(next).agentPreset).toBe('kanban-workflow-architect');
  });

  it('rewrites an authored scalar in place, keeping the key order and the comments around it', () => {
    const withPreset = writeBoardAgentPresetField(authored, 'standard');
    const withComment = withPreset.replace('initial_column: backlog', 'initial_column: backlog # keep me');
    const next = writeBoardAgentPresetField(withComment, 'ptc');
    expect(next).toContain('# keep me');
    expect(next.match(/^agent_preset: /gm)).toHaveLength(1);
    expect(parseWorkflow(next).agentPreset).toBe('ptc');
  });

  it('removes the scalar when the board returns to the host default', () => {
    const cleared = writeBoardAgentPresetField(writeBoardAgentPresetField(authored, 'standard'), undefined);
    expect(cleared).toBe(authored);
    expect(parseWorkflow(cleared).agentPreset).toBeUndefined();
  });

  it('leaves a document that names no preset untouched when clearing', () => {
    expect(writeBoardAgentPresetField(authored, undefined)).toBe(authored);
  });

  it('quotes an identity YAML would otherwise misread', () => {
    const next = writeBoardAgentPresetField(authored, 'true');
    expect(next).toContain("agent_preset: 'true'");
    expect(parseWorkflow(next).agentPreset).toBe('true');
  });

  it('keeps a flow document readable', () => {
    const flow = '{name: Flow, initial_column: one, columns: [{id: one, label: One}]}';
    const next = writeBoardAgentPresetField(flow, 'standard');
    expect(parseWorkflow(next).agentPreset).toBe('standard');
  });

  it('trims the authored identity and drops a blank one', () => {
    expect(parseWorkflow(writeBoardAgentPresetField(authored, '  standard  ')).agentPreset).toBe('standard');
    expect(writeBoardAgentPresetField(writeBoardAgentPresetField(authored, 'standard'), '   ')).toBe(authored);
  });

  it('refuses to write a document the parser rejects and leaves the choice on screen', () => {
    expect(() => writeBoardAgentPresetField('name: Broken\n', 'standard')).toThrow(expect.objectContaining({ code: 'INVALID_WORKFLOW' }));
  });
});
