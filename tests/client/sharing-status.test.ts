import { describe, expect, it } from 'vitest';
import { describeChange } from '../../src/client/sharing/status.js';

describe('change descriptions', () => {
  it('names the recorded default a publish would send', () => {
    expect(describeChange({ kind: 'board.preset-changed', mode: 'operator' })).toContain('workflow operator');
    expect(describeChange({ kind: 'board.preset-changed', mode: 'host' })).toContain('host default');
    expect(describeChange({ kind: 'board.preset-changed', mode: null })).toContain('cleared');
  });

  it('names a workflow description change', () => {
    expect(describeChange({ kind: 'workflow.field-changed', field: 'description' })).toBe('The workflow description changed');
  });
});
