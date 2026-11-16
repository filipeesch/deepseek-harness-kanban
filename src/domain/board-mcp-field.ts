import { KanbanError } from '../shared/errors.js';
import { authoredScalar, writeRootField } from './yaml-map-fields.js';
import { mcpAllowlistEntry, mcpAllowlistText } from './mcp-allowlist.js';
import { parseWorkflow } from './workflow.js';

/** The authored root key that carries the board's MCP allowlist. */
const MCP_KEY = 'mcp';

function invalid(message: string): never {
  throw new KanbanError('INVALID_WORKFLOW', message);
}

/** Normalize a caller's entries the same way the parser reads them, refusing an invalid one. */
function normalize(entries: readonly string[]): string[] {
  const result: string[] = [];
  for (const [index, value] of entries.entries()) {
    const entry = mcpAllowlistEntry(value);
    if (entry === undefined) invalid('Workflow mcp[' + index + '] must be a server or server/tool entry.');
    const text = mcpAllowlistText(entry);
    if (!result.includes(text)) result.push(text);
  }
  return result;
}

/**
 * Render the root list, or `null` to remove it. An absent list keeps every server
 * visible; an authored empty list keeps none, so the two states stay distinct.
 * A flow document cannot hold a block sequence, so it keeps the inline style.
 */
function mcpField(entries: readonly string[] | undefined, indent: string, flow: boolean): string | null {
  if (entries === undefined) return null;
  if (entries.length === 0) return MCP_KEY + ': []';
  const items = entries.map(entry => authoredScalar(entry));
  if (flow) return MCP_KEY + ': [' + items.join(', ') + ']';
  return MCP_KEY + ':\n' + items.map(item => indent + '  - ' + item).join('\n');
}

/**
 * Write or clear the board's MCP allowlist in an authored workflow document. Only
 * the root `mcp` list is rewritten, by text range, so comments, key order, quoting,
 * and every other authored character survive. Passing `undefined` removes the
 * list, which keeps every server visible; an empty array authors an empty list.
 * The result is parsed before it is returned, so a caller can never persist a
 * document the board would refuse.
 */
export function writeBoardMcpField(text: string, entries: readonly string[] | undefined): string {
  const wanted = entries === undefined ? undefined : normalize(entries);
  const next = writeRootField({
    text,
    fieldKeys: [MCP_KEY],
    render: (_existing, indent, _key, flow) => mcpField(wanted, indent, flow),
    invalid,
  });
  parseWorkflow(next);
  return next;
}
