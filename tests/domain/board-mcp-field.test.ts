import { describe, expect, it } from 'vitest';
import { writeBoardMcpField } from '../../src/domain/board-mcp-field.js';
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

describe('writing the board MCP allowlist', () => {
  it('appends the list without touching any other authored character', () => {
    const next = writeBoardMcpField(authored, ['atlassian', 'atlassian/search']);
    expect(next).toContain('mcp:\n  - atlassian\n  - atlassian/search\n');
    expect(next).toContain('# the flow comment');
    expect(next).toContain('label: Backlog # keep me');
    expect(parseWorkflow(next).mcp).toEqual(['atlassian', 'atlassian/search']);
  });

  it('rewrites an authored list in place with a single field', () => {
    const withList = writeBoardMcpField(authored, ['atlassian']);
    const next = writeBoardMcpField(withList, ['trino']);
    expect(next.match(/^mcp:/gm)).toHaveLength(1);
    expect(parseWorkflow(next).mcp).toEqual(['trino']);
    expect(next).toContain('# the flow comment');
  });

  it('removes the list when every server stays visible, restoring the authored document', () => {
    const cleared = writeBoardMcpField(writeBoardMcpField(authored, ['atlassian']), undefined);
    expect(cleared).toBe(authored);
    expect(parseWorkflow(cleared).mcp).toBeUndefined();
  });

  it('keeps an empty selection distinct from an absent one', () => {
    const empty = writeBoardMcpField(authored, []);
    expect(empty).toContain('mcp: []');
    expect(parseWorkflow(empty).mcp).toEqual([]);
    expect(writeBoardMcpField(empty, undefined)).toBe(authored);
  });

  it('normalizes and de-duplicates the entries it writes', () => {
    const next = writeBoardMcpField(authored, ['  atlassian ', 'atlassian']);
    expect(parseWorkflow(next).mcp).toEqual(['atlassian']);
  });

  it('refuses an entry the parser would reject instead of writing it', () => {
    expect(() => writeBoardMcpField(authored, ['a/b/c'])).toThrow(expect.objectContaining({ code: 'INVALID_WORKFLOW' }));
  });

  it('keeps a flow document readable', () => {
    const flow = '{name: Flow, initial_column: one, columns: [{id: one, label: One}]}';
    const next = writeBoardMcpField(flow, ['atlassian', 'trino/query']);
    expect(parseWorkflow(next).mcp).toEqual(['atlassian', 'trino/query']);
  });
});
