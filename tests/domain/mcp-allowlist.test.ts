import { describe, expect, it } from 'vitest';
import { deniedMcpTools, mcpAllowlistEntry, mcpAllowlistText, mcpToolAllowed, mcpToolName } from '../../src/domain/mcp-allowlist.js';

describe('MCP allowlist entries', () => {
  it('reads a bare server entry and a single-tool entry', () => {
    expect(mcpAllowlistEntry('atlassian')).toEqual({ server: 'atlassian' });
    expect(mcpAllowlistEntry('atlassian/search')).toEqual({ server: 'atlassian', tool: 'search' });
  });

  it('trims an authored entry and renders the normalized spelling', () => {
    const entry = mcpAllowlistEntry('  atlassian/search  ');
    expect(entry).toEqual({ server: 'atlassian', tool: 'search' });
    expect(mcpAllowlistText(entry!)).toBe('atlassian/search');
  });

  it('refuses a blank, spaced, empty-segment, or over-segmented entry', () => {
    for (const value of ['', '   ', 'atlassian search', 'a/b/c', '/tool', 'server/', undefined, 7, null]) {
      expect(mcpAllowlistEntry(value), String(value)).toBeUndefined();
    }
  });

  it('splits an MCP tool name into its server and tool', () => {
    expect(mcpToolName('mcp__atlassian__search')).toEqual({ server: 'atlassian', tool: 'search' });
    expect(mcpToolName('mcp__server_name__some_tool')).toEqual({ server: 'server_name', tool: 'some_tool' });
    expect(mcpToolName('bash')).toBeUndefined();
    expect(mcpToolName('mcp__onlyserver')).toBeUndefined();
    expect(mcpToolName('mcp____tool')).toBeUndefined();
  });
});

describe('MCP allowlist matching', () => {
  const atlassianTools = ['mcp__atlassian__search', 'mcp__atlassian__createJiraIssue'];
  const trinoTools = ['mcp__trino__execute_query'];

  it('allows every tool of a bare server entry', () => {
    const allowlist = ['atlassian'];
    expect(atlassianTools.filter(name => mcpToolAllowed(allowlist, name))).toEqual(atlassianTools);
    expect(trinoTools.filter(name => mcpToolAllowed(allowlist, name))).toEqual([]);
  });

  it('allows only the named tool of a server/tool entry', () => {
    const allowlist = ['atlassian/search'];
    expect(mcpToolAllowed(allowlist, 'mcp__atlassian__search')).toBe(true);
    expect(mcpToolAllowed(allowlist, 'mcp__atlassian__createJiraIssue')).toBe(false);
  });

  it('never allows a non-MCP tool through an MCP entry', () => {
    expect(mcpToolAllowed(['bash'], 'bash')).toBe(false);
    expect(mcpToolAllowed([''], 'mcp__atlassian__search')).toBe(false);
  });

  it('denies the catalog entries an allowlist does not allow, and only MCP ones', () => {
    const catalog = [...atlassianTools, ...trinoTools, 'bash', 'get_card'];
    expect(deniedMcpTools(['atlassian/search'], catalog)).toEqual(['mcp__atlassian__createJiraIssue', 'mcp__trino__execute_query']);
    expect(deniedMcpTools([], catalog)).toEqual([...atlassianTools, ...trinoTools]);
    expect(deniedMcpTools(['atlassian', 'trino'], catalog)).toEqual([]);
  });
});
