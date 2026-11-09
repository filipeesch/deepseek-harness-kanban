import { isMap, isScalar, isSeq, parseDocument } from 'yaml';

/** One literal text replacement inside an authored workflow document. */
export interface TextEdit { readonly start: number; readonly end: number; readonly text: string }
type Range = [number, number, number?] | undefined;
interface NodePair { readonly key: unknown; readonly value: unknown }

const NEWLINE = String.fromCharCode(10);

/** One authored field value: the numeric members a map field keeps (x/y, width/height). */
export type MapFieldValues = Readonly<Record<string, number>>;

export interface MapFieldEdit {
  /** The authored workflow text. */
  readonly text: string;
  /** The sequence that holds the maps, e.g. `columns`. */
  readonly sequenceKey: string;
  /** The key that identifies one map inside the sequence, e.g. `id`. */
  readonly idKey: string;
  /** The key this edit writes, e.g. `position` or `size`. */
  readonly fieldKey: string;
  /** The wanted value per map id; a missing or undefined entry removes the field. */
  readonly values: Readonly<Record<string, MapFieldValues | undefined>>;
  /** Render the complete `field: {...}` pair for one value. */
  readonly render: (values: MapFieldValues) => string;
  readonly invalid: (message: string) => never;
}

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

function flowRemoval(text: string, start: number, end: number): TextEdit {
  let from = start;
  while (from > 0 && (text[from - 1] === ' ' || text[from - 1] === String.fromCharCode(9))) from -= 1;
  if (text[from - 1] === ',') return { start: from - 1, end, text: '' };
  let to = end;
  while (to < text.length && text[to] === ' ') to += 1;
  if (text[to] === ',') to += 1;
  return { start, end: to, text: '' };
}

function scalarMember(node: unknown, key: string): unknown {
  const map = node as { get?: (key: string, keepScalar: true) => { value?: unknown } | null } | null;
  return map?.get?.(key, true)?.value;
}

/** True when the authored map field already holds exactly these members. */
function sameValues(node: unknown, values: MapFieldValues): boolean {
  const keys = Object.keys(values);
  if (keys.length === 0) return false;
  return keys.every(key => scalarMember(node, key) === values[key]);
}

/**
 * Rewrite only one map field of an authored workflow document. The document is
 * edited by text range, not re-serialized, so every other character the author
 * wrote is preserved: comments, quoting, block scalars, key order, and the
 * style of every other collection. A map with no requested value loses its key;
 * a value for a map the document does not define is ignored, which keeps an
 * undo harmless after a stage was removed.
 */
export function editMapFieldInSequence(edit: MapFieldEdit): string {
  let document;
  try {
    document = parseDocument(edit.text, { uniqueKeys: true, prettyErrors: false, version: '1.2' });
  } catch (error) {
    edit.invalid('Invalid workflow YAML: ' + (error instanceof Error ? error.message : String(error)));
  }
  if (document.errors.length > 0) edit.invalid(document.errors.map(error => error.message).join('; '));
  const sequence = document.getIn([edit.sequenceKey]);
  if (!isSeq(sequence)) return edit.text;
  const edits: TextEdit[] = [];
  for (const item of sequence.items) {
    if (!isMap(item)) continue;
    const pairs = item.items as unknown as NodePair[];
    const idPair = pairs.find(pair => pairKey(pair) === edit.idKey);
    if (idPair === undefined) continue;
    const rawId = (idPair.value as { value?: unknown } | null)?.value;
    if (typeof rawId !== 'string') continue;
    const wanted = Object.prototype.hasOwnProperty.call(edit.values, rawId) ? edit.values[rawId] : undefined;
    const existing = pairs.find(pair => pairKey(pair) === edit.fieldKey);
    const flow = item.flow === true;
    if (wanted === undefined) {
      if (existing === undefined) continue;
      const start = keyStart(existing);
      const range = pairRange(existing);
      if (start === undefined || range === undefined) continue;
      // A block collection's value end includes its trailing newline; deleting
      // through it removes the field lines and leaves the next key intact.
      const endsWithNewline = range[1] > 0 && edit.text[range[1] - 1] === NEWLINE;
      const lineBegin = lineStart(edit.text, start);
      // A field that starts the sequence item shares its line with the dash; it
      // must not take the dash with it, or the item stops being a sequence entry.
      const startsItem = /^[ \t]*-[ \t]+$/.test(edit.text.slice(lineBegin, start));
      const deleteStart = startsItem ? start : lineBegin;
      const deleteEnd = startsItem
        ? (endsWithNewline ? range[1] - 1 : Math.min(edit.text.length, lineEnd(edit.text, range[1])))
        : (endsWithNewline ? range[1] : Math.min(edit.text.length, lineEnd(edit.text, range[1]) + 1));
      edits.push(flow ? flowRemoval(edit.text, start, range[1]) : { start: deleteStart, end: deleteEnd, text: '' });
      continue;
    }
    const rendered = edit.render(wanted);
    if (existing !== undefined) {
      const start = keyStart(existing);
      const range = pairRange(existing);
      if (start === undefined || range === undefined) continue;
      if (sameValues(existing.value, wanted)) continue;
      // Keep the newline that ends a block value; it belongs to the next line.
      const replaceEnd = range[1] > 0 && edit.text[range[1] - 1] === NEWLINE ? range[1] - 1 : range[1];
      edits.push({ start, end: replaceEnd, text: rendered });
      continue;
    }
    if (flow) {
      // A flow collection's value end is exactly one past its closing brace, even
      // when a comment follows the item, so YAML's own ranges delimit the map.
      const range = (item as unknown as { range?: [number, number, number] }).range;
      if (range === undefined) continue;
      const close = range[1] - 1;
      if (close < 0 || edit.text[close] !== '}') continue;
      edits.push({ start: close, end: close, text: ', ' + rendered });
      continue;
    }
    const itemRange = (item as unknown as { range?: [number, number, number] }).range;
    const indent = fieldIndent(edit.text, pairs);
    if (itemRange === undefined || indent === undefined) continue;
    // The item's node end sits after its last line's newline, so the new pair can
    // be appended without touching a block scalar or a trailing comment.
    const at = itemRange[2];
    const prefix = at > 0 && edit.text[at - 1] === NEWLINE ? '' : NEWLINE;
    edits.push({ start: at, end: at, text: prefix + indent + rendered + NEWLINE });
  }
  if (edits.length === 0) return edit.text;
  edits.sort((left, right) => right.start - left.start);
  let output = edit.text;
  for (const edit of edits) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  return output;
}
