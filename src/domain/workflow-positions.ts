import { parseDocument, isMap, isScalar, isSeq } from 'yaml';
import type { StagePosition, Workflow } from '../shared/types.js';
import { KanbanError } from '../shared/errors.js';

/** Stage placements keyed by stage id; a missing key means automatic placement. */
export type StagePositions = Readonly<Record<string, StagePosition | undefined>>;

/** The authored placements of a parsed workflow, in workflow order. */
export function readStagePositions(workflow: Workflow): Record<string, StagePosition> {
  // A stage id can be any safe identifier, including inherited names like `toString`.
  const result: Record<string, StagePosition> = Object.create(null) as Record<string, StagePosition>;
  for (const column of workflow.columns) {
    if (column.position !== undefined) result[column.id] = { x: column.position.x, y: column.position.y };
  }
  return result;
}

interface TextEdit { readonly start: number; readonly end: number; readonly text: string }
type Range = [number, number, number?] | undefined;
interface NodePair { readonly key: unknown; readonly value: unknown }

const NEWLINE = String.fromCharCode(10);

function lineStart(text: string, offset: number): number {
  return text.lastIndexOf(NEWLINE, offset - 1) + 1;
}

function lineEnd(text: string, offset: number): number {
  const index = text.indexOf(NEWLINE, offset);
  return index < 0 ? text.length : index;
}

function indentAt(text: string, offset: number): string {
  const match = /^[ \t]*/.exec(text.slice(lineStart(text, offset), offset));
  return match === null ? '' : match[0];
}

function pairKey(pair: NodePair): string | undefined {
  return isScalar(pair.key) && typeof pair.key.value === 'string' ? pair.key.value : undefined;
}

function pairRange(pair: NodePair): Range {
  return ((pair.value as { range?: Range } | null)?.range ?? (pair.key as { range?: Range } | null)?.range) ?? undefined;
}

function keyStart(pair: NodePair): number | undefined {
  const range = (pair.key as { range?: Range } | null)?.range;
  return range === undefined ? undefined : range[0];
}

/** The indentation a new column field needs, whether the stage starts inline with its dash or below it. */
function fieldIndent(text: string, pairs: readonly NodePair[]): string | undefined {
  const source = pairs.length > 1 ? pairs[1] : pairs[0];
  if (source === undefined) return undefined;
  const start = keyStart(source);
  if (start === undefined) return undefined;
  const before = text.slice(lineStart(text, start), start);
  const inline = /^([ \t]*)-[ \t]+$/.exec(before);
  return inline === null ? indentAt(text, start) : inline[1] + '  ';
}

function invalid(message: string): never {
  throw new KanbanError('INVALID_WORKFLOW', message);
}

function flowRemoval(text: string, start: number, end: number): TextEdit {
  let from = start;
  while (from > 0 && (text[from - 1] === ' ' || text[from - 1] === String.fromCharCode(9))) from -= 1;
  if (text[from - 1] === ',') return { start: from - 1, end, text: '' };
  let to = end;
  while (to < text.length && text[to] === ' ') to += 1;
  if (text[to] === ',') to += 1;
  return { start, end: to, text: '' };
}

/**
 * Rewrite only the position keys of an authored workflow document. The document
 * is edited by text range, not re-serialized, so every other character the
 * author wrote is preserved: comments, quoting, block scalars, key order, and
 * the style of every other collection. A stage with no requested position
 * loses its key; a requested position for a stage the document does not define
 * is ignored, which keeps an undo harmless after a stage was removed.
 */
export function setStagePositions(text: string, positions: StagePositions): string {
  let document;
  try {
    document = parseDocument(text, { uniqueKeys: true, prettyErrors: false, version: '1.2' });
  } catch (error) {
    invalid('Invalid workflow YAML: ' + (error instanceof Error ? error.message : String(error)));
  }
  if (document.errors.length > 0) invalid(document.errors.map(error => error.message).join('; '));
  const columns = document.getIn(['columns']);
  if (!isSeq(columns)) return text;
  const edits: TextEdit[] = [];
  for (const item of columns.items) {
    if (!isMap(item)) continue;
    const pairs = item.items as unknown as NodePair[];
    const idPair = pairs.find(pair => pairKey(pair) === 'id');
    if (idPair === undefined) continue;
    const rawId = (idPair.value as { value?: unknown } | null)?.value;
    if (typeof rawId !== 'string') continue;
    const wanted = Object.prototype.hasOwnProperty.call(positions, rawId) ? positions[rawId] : undefined;
    const existing = pairs.find(pair => pairKey(pair) === 'position');
    const flow = item.flow === true;
    if (wanted === undefined) {
      if (existing === undefined) continue;
      const start = keyStart(existing);
      const range = pairRange(existing);
      if (start === undefined || range === undefined) continue;
      // A block collection's value end includes its trailing newline; deleting
      // through it removes the position lines and leaves the next key intact.
      const endsWithNewline = range[1] > 0 && text[range[1] - 1] === NEWLINE;
      const deleteEnd = endsWithNewline ? range[1] : Math.min(text.length, lineEnd(text, range[1]) + 1);
      edits.push(flow ? flowRemoval(text, start, range[1]) : { start: lineStart(text, start), end: deleteEnd, text: '' });
      continue;
    }
    const rendered = 'position: {x: ' + wanted.x + ', y: ' + wanted.y + '}';
    if (existing !== undefined) {
      const start = keyStart(existing);
      const range = pairRange(existing);
      if (start === undefined || range === undefined) continue;
      const current = existing.value as { get?: (key: string, keepScalar: true) => { value?: unknown } | null } | null;
      const currentX = current?.get?.('x', true)?.value;
      const currentY = current?.get?.('y', true)?.value;
      if (currentX === wanted.x && currentY === wanted.y) continue;
      // Keep the newline that ends a block value; it belongs to the next line.
      const replaceEnd = range[1] > 0 && text[range[1] - 1] === NEWLINE ? range[1] - 1 : range[1];
      edits.push({ start, end: replaceEnd, text: rendered });
      continue;
    }
    if (flow) {
      // A flow collection's value end is exactly one past its closing brace, even
      // when a comment follows the item, so YAML's own ranges delimit the map.
      const range = (item as unknown as { range?: [number, number, number] }).range;
      if (range === undefined) continue;
      const close = range[1] - 1;
      if (close < 0 || text[close] !== '}') continue;
      edits.push({ start: close, end: close, text: ', ' + rendered });
      continue;
    }
    const itemRange = (item as unknown as { range?: [number, number, number] }).range;
    const indent = fieldIndent(text, pairs);
    if (itemRange === undefined || indent === undefined) continue;
    // The item's node end sits after its last line's newline, so the new pair can
    // be appended without touching a block scalar or a trailing comment.
    const at = itemRange[2];
    const prefix = at > 0 && text[at - 1] === NEWLINE ? '' : NEWLINE;
    edits.push({ start: at, end: at, text: prefix + indent + rendered + NEWLINE });
  }
  if (edits.length === 0) return text;
  edits.sort((left, right) => right.start - left.start);
  let output = text;
  for (const edit of edits) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  return output;
}
