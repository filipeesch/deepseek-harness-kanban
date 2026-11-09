import { KanbanError } from '../../shared/errors.js';
import { TEAM_FILE_READ_MAX_BYTES, TEAM_FILE_READ_MAX_LINES, TEAM_FILE_READ_MAX_LINE_LENGTH } from './limits.js';

export interface TeamFileRenderRequest { offset?: number; limit?: number }

export interface TeamFileRenderedLine { number: number; text: string }

export interface TeamFileRender {
  lines: TeamFileRenderedLine[];
  totalLines: number;
  /** The window ended before the last line of the file. */
  truncatedByLines: boolean;
  /** The byte budget stopped the window early. */
  truncatedByBytes: boolean;
}

function positiveInteger(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new KanbanError('INVALID_INPUT', name + ' must be a positive whole number.');
  return value;
}

/** Truncate one line at the host's per-line character bound. */
export function truncateTeamLine(line: string): string {
  return line.length > TEAM_FILE_READ_MAX_LINE_LENGTH
    ? line.slice(0, TEAM_FILE_READ_MAX_LINE_LENGTH) + '... (line truncated to ' + TEAM_FILE_READ_MAX_LINE_LENGTH + ' chars)'
    : line;
}

/** Indentation and separators the tool's pretty-printed JSON adds around one line. */
const PRETTY_ITEM_OVERHEAD = 20;

/** The bytes one rendered line costs once the tool result is serialized. */
export function renderedLineBytes(line: TeamFileRenderedLine): number {
  return Buffer.byteLength(JSON.stringify({ number: line.number, text: line.text }, null, 2), 'utf8') + PRETTY_ITEM_OVERHEAD;
}

/**
 * Render one window of a team file with the host's own read bounds: a maximum
 * line count, a maximum character count per line, and a maximum byte count of
 * the rendered representation. The window stops at whichever bound is reached
 * first.
 */
export function renderTeamFile(content: string, request: TeamFileRenderRequest = {}): TeamFileRender {
  const offset = positiveInteger(request.offset, 'offset') ?? 1;
  const limit = positiveInteger(request.limit, 'limit') ?? TEAM_FILE_READ_MAX_LINES;
  if (limit > TEAM_FILE_READ_MAX_LINES) throw new KanbanError('INVALID_INPUT', 'limit must be at most ' + TEAM_FILE_READ_MAX_LINES + '.');
  const all = content.length === 0 ? [] : content.split(/\r?\n/);
  if (all.length > 0 && all[all.length - 1] === '') all.pop();
  const totalLines = all.length;
  const lines: TeamFileRenderedLine[] = [];
  let bytes = 0;
  let truncatedByBytes = false;
  const end = Math.min(totalLines, offset - 1 + limit);
  for (let index = offset - 1; index < end; index++) {
    const line = { number: index + 1, text: truncateTeamLine(all[index] ?? '') };
    const size = renderedLineBytes(line);
    if (bytes + size > TEAM_FILE_READ_MAX_BYTES) { truncatedByBytes = true; break; }
    bytes += size;
    lines.push(line);
  }
  return { lines, totalLines, truncatedByLines: offset - 1 + limit < totalLines, truncatedByBytes };
}
