import { describe, expect, it } from 'vitest';
import { analyzeWorkflow } from '../../src/client/workflow-diagnostics.js';

const valid = ['name: Delivery', 'initial_column: one', 'columns:', '  - id: one', '    label: One', '  - id: two', '    label: Two', ''].join(String.fromCharCode(10));

describe('workflow diagnostics', () => {
  it('accepts the same workflow shape the host parser accepts', () => {
    const result = analyzeWorkflow(valid);
    expect(result.status).toBe('valid');
    expect(result.workflow?.columns.map(column => column.id)).toEqual(['one', 'two']);
    expect(result.diagnostics).toEqual([]);
  });

  it('reports YAML syntax errors at their document position without schema recovery', () => {
    const result = analyzeWorkflow('columns:' + String.fromCharCode(10) + '  - id: one' + String.fromCharCode(10) + '   label: One');
    expect(result.status).toBe('invalid');
    expect(result.issues[0]?.code).toBe('YAML_SYNTAX');
    expect(result.diagnostics[0]?.from).toBeGreaterThan(0);
    expect(result.workflow).toBeUndefined();
  });

  it('reports schema failures at the document start with the parser code', () => {
    const result = analyzeWorkflow('columns: []');
    expect(result.status).toBe('invalid');
    expect(result.issues[0]?.code).toBe('INVALID_WORKFLOW');
    expect(result.diagnostics[0]).toMatchObject({ from: 0, to: 1, severity: 'error' });
  });

  it('keeps a locally valid workflow valid even when only the host can detect an orphaned column', () => {
    const result = analyzeWorkflow(valid);
    expect(result.status).toBe('valid');
    expect(result.issues).toEqual([]);
  });

  it('does not mutate or reformat the input and rejects empty text', () => {
    const input = valid + 'groups:' + String.fromCharCode(10) + '  - id: g' + String.fromCharCode(10) + '    label: G' + String.fromCharCode(10) + '    columns: [one]' + String.fromCharCode(10);
    const before = input;
    expect(analyzeWorkflow(input).status).toBe('valid');
    expect(input).toBe(before);
    expect(analyzeWorkflow('   ').status).toBe('invalid');
  });
});
