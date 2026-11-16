/** The prefix every MCP tool name carries; the MCP client owns the rest of the name. */
export const MCP_TOOL_PREFIX = 'mcp__';

/** One allowlist entry, split into the server it names and, optionally, one of its tools. */
export interface McpAllowlistEntry { readonly server: string; readonly tool?: string }

/** One MCP tool name, split into its server and tool segments. */
export interface McpToolName { readonly server: string; readonly tool: string }

const SEPARATOR = '/';

function segments(value: string): string[] | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/\s/.test(trimmed) || /[\u0000-\u001f]/.test(trimmed)) return undefined;
  const parts = trimmed.split(SEPARATOR);
  if (parts.length > 2) return undefined;
  if (parts.some(part => part.length === 0)) return undefined;
  return parts;
}

/**
 * Parse one authored allowlist entry: a server name, or a `server/tool` pair.
 * The value is trimmed; a blank entry, an entry with whitespace, or an entry with
 * more than one separator is not a valid entry.
 */
export function mcpAllowlistEntry(value: unknown): McpAllowlistEntry | undefined {
  if (typeof value !== 'string') return undefined;
  const parts = segments(value);
  if (parts === undefined) return undefined;
  const [server, tool] = parts as [string, string?];
  return tool === undefined ? { server } : { server, tool };
}

/** The authored spelling of one already-parsed entry. */
export function mcpAllowlistText(entry: McpAllowlistEntry): string {
  return entry.tool === undefined ? entry.server : entry.server + SEPARATOR + entry.tool;
}

/**
 * Normalize one authored allowlist: trim every entry, refuse an invalid one, and
 * drop a repeated entry while keeping the author's order.
 */
export function normalizeMcpAllowlist(value: unknown, invalid: (message: string) => never): string[] {
  if (!Array.isArray(value)) invalid('Workflow mcp must be an array of server or server/tool entries.');
  const result: string[] = [];
  for (const [index, item] of value.entries()) {
    const entry = mcpAllowlistEntry(item);
    if (entry === undefined) invalid('Workflow mcp[' + index + '] must be a server or server/tool entry.');
    const text = mcpAllowlistText(entry);
    if (!result.includes(text)) result.push(text);
  }
  return result;
}

/** Split one MCP tool name into its server and tool segments. */
export function mcpToolName(name: string): McpToolName | undefined {
  if (!name.startsWith(MCP_TOOL_PREFIX)) return undefined;
  const rest = name.slice(MCP_TOOL_PREFIX.length);
  const boundary = rest.indexOf('__');
  if (boundary <= 0 || boundary + 2 >= rest.length) return undefined;
  return { server: rest.slice(0, boundary), tool: rest.slice(boundary + 2) };
}

/**
 * Whether an allowlist allows one tool. A bare server entry allows every tool of
 * that server; a `server/tool` entry allows only that tool. A tool that is not an
 * MCP tool, or whose name cannot be split, is never allowed by an MCP entry.
 */
export function mcpToolAllowed(allowlist: readonly string[], toolName: string): boolean {
  const tool = mcpToolName(toolName);
  if (tool === undefined) return false;
  for (const value of allowlist) {
    const entry = mcpAllowlistEntry(value);
    if (entry === undefined || entry.server !== tool.server) continue;
    if (entry.tool === undefined || entry.tool === tool.tool) return true;
  }
  return false;
}

/** The MCP tool names of a catalog that an allowlist does not allow. */
export function deniedMcpTools(allowlist: readonly string[], catalog: readonly string[]): string[] {
  return catalog.filter(name => name.startsWith(MCP_TOOL_PREFIX) && !mcpToolAllowed(allowlist, name));
}
