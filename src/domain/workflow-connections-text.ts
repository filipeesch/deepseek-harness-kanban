import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import type { ConnectionAnchor, ConnectionLayout, ConnectionSegmentOffset } from '../shared/types.js';
import { KanbanError } from '../shared/errors.js';
import { connectionKey, sameConnectionLayout } from './connection-anchor.js';

/** The authored connection layouts keyed by source and target; a missing key means the automatic route. */
export type ConnectionLayouts = Readonly<Record<string, ConnectionLayout | undefined>>;

const NEWLINE = String.fromCharCode(10);
const CARRIAGE_RETURN = String.fromCharCode(13);
const DEFAULT_INDENT = '  ';
const KEY = 'connections';

interface TextEdit { readonly start: number; readonly end: number; readonly text: string }
interface AuthoredEntry { readonly key: string; readonly layout: ConnectionLayout; readonly start: number; readonly end: number }

function invalid(message: string): never {
  throw new KanbanError('INVALID_WORKFLOW', message);
}

function lineStart(text: string, offset: number): number {
  return text.lastIndexOf(NEWLINE, offset - 1) + 1;
}

/** The offset just past the line that contains the offset, including its newline. */
function afterLine(text: string, offset: number): number {
  const end = text.indexOf(NEWLINE, offset);
  return end < 0 ? text.length : end + 1;
}

/** A plain scalar render for a stage identifier, quoted when YAML would read it as a number or a keyword. */
function scalar(value: string): string {
  return /^[0-9]/.test(value) || /^(true|false|null|yes|no|on|off|~)$/i.test(value) ? "'" + value + "'" : value;
}

function renderAnchor(anchor: ConnectionAnchor): string {
  return '{side: ' + anchor.side + ', at: ' + anchor.at + '}';
}

function renderSegment(segment: ConnectionSegmentOffset): string {
  return '{axis: ' + segment.axis + ', offset: ' + segment.offset + '}';
}

/** The newline the document itself uses, so an inserted entry never mixes line endings. */
function documentNewline(text: string): string {
  return text.includes(CARRIAGE_RETURN + NEWLINE) ? CARRIAGE_RETURN + NEWLINE : NEWLINE;
}

/** One authored entry as block lines, with the dash at the given indentation. */
function renderEntry(layout: ConnectionLayout, dashIndent: string, newline: string): string {
  const pad = dashIndent + '  ';
  const lines = ['- from: ' + scalar(layout.from), pad + 'to: ' + scalar(layout.to)];
  if (layout.source !== undefined) lines.push(pad + 'source: ' + renderAnchor(layout.source));
  if (layout.target !== undefined) lines.push(pad + 'target: ' + renderAnchor(layout.target));
  if (layout.segments !== undefined && layout.segments.length > 0) lines.push(pad + 'segments: [' + layout.segments.map(renderSegment).join(', ') + ']');
  return lines.join(newline);
}

/** One authored entry in flow style, used where a block entry is not valid YAML. */
function renderFlowEntry(layout: ConnectionLayout): string {
  const parts = ['from: ' + scalar(layout.from), 'to: ' + scalar(layout.to)];
  if (layout.source !== undefined) parts.push('source: ' + renderAnchor(layout.source));
  if (layout.target !== undefined) parts.push('target: ' + renderAnchor(layout.target));
  if (layout.segments !== undefined && layout.segments.length > 0) parts.push('segments: [' + layout.segments.map(renderSegment).join(', ') + ']');
  return '{' + parts.join(', ') + '}';
}

function renderFlow(layouts: readonly ConnectionLayout[]): string {
  return '[' + layouts.map(renderFlowEntry).join(', ') + ']';
}

function pairValue(map: unknown, key: string): unknown {
  const node = map as { get?: (name: string, keepScalar: true) => { value?: unknown } | null } | null;
  return node?.get?.(key, true)?.value;
}

function readAnchor(map: unknown, key: string): ConnectionAnchor | undefined {
  const node = map as { get?: (name: string) => unknown } | null;
  const found = node?.get?.(key);
  if (found === undefined || found === null) return undefined;
  const side = pairValue(found, 'side');
  const at = pairValue(found, 'at');
  if (typeof side !== 'string' || typeof at !== 'number') return undefined;
  return { side: side as ConnectionAnchor['side'], at };
}

function readSegments(map: unknown): ConnectionSegmentOffset[] | undefined {
  const node = map as { get?: (name: string) => unknown } | null;
  const found = node?.get?.('segments');
  if (!isSeq(found)) return undefined;
  const values: ConnectionSegmentOffset[] = [];
  for (const item of found.items) {
    const axis = pairValue(item, 'axis');
    const offset = pairValue(item, 'offset');
    if (typeof axis !== 'string' || typeof offset !== 'number') return undefined;
    values.push({ axis: axis as ConnectionSegmentOffset['axis'], offset });
  }
  return values;
}

function connectionOf(map: unknown): ConnectionLayout | null {
  const from = pairValue(map, 'from');
  const to = pairValue(map, 'to');
  if (typeof from !== 'string' || typeof to !== 'string') return null;
  const layout: ConnectionLayout = { from, to };
  const source = readAnchor(map, 'source');
  if (source !== undefined) layout.source = source;
  const target = readAnchor(map, 'target');
  if (target !== undefined) layout.target = target;
  const segments = readSegments(map);
  if (segments !== undefined) layout.segments = segments;
  return layout;
}

/** The item's whole lines, from the dash that starts it through its trailing newline. */
/** The offset just past a node's value, whether or not its range already includes the newline. */
function valueEnd(text: string, offset: number): number {
  return offset > 0 && text[offset - 1] === NEWLINE ? offset : afterLine(text, offset);
}

function itemRange(text: string, item: unknown): { start: number; end: number } {
  const range = (item as { range?: [number, number, number] }).range;
  if (range === undefined) return { start: 0, end: 0 };
  return { start: lineStart(text, range[0]), end: valueEnd(text, range[1]) };
}

function authoredEntries(text: string, sequence: unknown): AuthoredEntry[] {
  if (!isSeq(sequence)) return [];
  const entries: AuthoredEntry[] = [];
  for (const item of sequence.items) {
    if (!isMap(item)) continue;
    const layout = connectionOf(item);
    if (layout === null) continue;
    entries.push({ key: connectionKey(layout.from, layout.to), layout, ...itemRange(text, item) });
  }
  return entries;
}

function sequenceIndent(text: string, sequence: unknown): string {
  if (!isSeq(sequence)) return DEFAULT_INDENT;
  const range = (sequence.items[0] as { range?: [number, number, number] } | undefined)?.range;
  if (range === undefined) return DEFAULT_INDENT;
  const line = text.slice(lineStart(text, range[0]), range[0]);
  const dash = line.indexOf('-');
  return dash < 0 ? DEFAULT_INDENT : line.slice(0, dash);
}

type NodeRange = [number, number, number];

function rootNode(document: unknown): { items?: unknown[]; flow?: boolean; range?: NodeRange } | null {
  return (document as { contents?: { items?: unknown[]; flow?: boolean; range?: NodeRange } | null }).contents ?? null;
}

/** The pair that holds the authored connections, with its raw node ranges. */
function connectionsPair(document: unknown): { key: NodeRange; value: NodeRange } | null {
  const contents = rootNode(document);
  if (contents?.items === undefined) return null;
  for (const pair of contents.items) {
    const key = (pair as { key?: { value?: unknown; range?: NodeRange } }).key;
    if (!isScalar(key) || key.value !== KEY) continue;
    const value = (pair as { value?: { range?: NodeRange } }).value;
    if (key.range === undefined || value?.range === undefined) return null;
    return { key: key.range, value: value.range };
  }
  return null;
}

/** The lines that hold the whole key, used only where the key owns its own lines. */
function documentKey(text: string, document: unknown): { start: number; end: number } | null {
  const pair = connectionsPair(document);
  if (pair === null) return null;
  return { start: lineStart(text, pair.key[0]), end: keyEnd(text, pair.value[1]) };
}

interface FlowEntry { readonly key: string; readonly layout: ConnectionLayout; readonly start: number; readonly end: number }

function flowEntriesOf(sequence: unknown): FlowEntry[] {
  if (!isSeq(sequence)) return [];
  const entries: FlowEntry[] = [];
  for (const item of sequence.items) {
    if (!isMap(item)) continue;
    const layout = connectionOf(item);
    const range = (item as { range?: NodeRange }).range;
    if (layout === null || range === undefined) continue;
    entries.push({ key: connectionKey(layout.from, layout.to), layout, start: range[0], end: range[1] });
  }
  return entries;
}

/** Remove the authored connections pair, taking one adjacent separator with it. */
function removeConnectionsKey(text: string, document: unknown): string {
  const pair = connectionsPair(document);
  if (pair === null) return text;
  const contents = rootNode(document);
  if (contents?.flow === true) {
    const items = contents.items ?? [];
    const index = items.findIndex(item => (item as { key?: { range?: NodeRange } }).key?.range?.[0] === pair.key[0]);
    const following = index >= 0 ? items[index + 1] as { key?: { range?: NodeRange } } | undefined : undefined;
    const preceding = index > 0 ? items[index - 1] as { value?: { range?: NodeRange } } | undefined : undefined;
    if (following?.key?.range !== undefined) return text.slice(0, pair.key[0]) + text.slice(following.key.range[0]);
    if (preceding?.value?.range !== undefined) return text.slice(0, preceding.value.range[1]) + text.slice(pair.value[1]);
    return text.slice(0, pair.key[0]) + text.slice(pair.value[1]);
  }
  const lines = documentKey(text, document);
  return lines === null ? text : text.slice(0, lines.start) + text.slice(lines.end);
}

/**
 * Rewrite a flow-style connections list. Only the entries that changed are
 * replaced, so an untouched neighbour keeps its quoting, spacing, and the
 * comments around it. A removal rebuilds the list, because dropping an item also
 * has to drop one of its separators; when the last one goes, the key goes too.
 */
function writeFlowSequence(text: string, document: unknown, sequence: unknown, wanted: ReadonlyMap<string, ConnectionLayout>): string {
  const entries = flowEntriesOf(sequence);
  const edits: TextEdit[] = [];
  const present = new Set<string>();
  const removed: FlowEntry[] = [];
  for (const entry of entries) {
    const next = wanted.get(entry.key);
    if (next === undefined) { removed.push(entry); continue; }
    present.add(entry.key);
    if (sameConnectionLayout(entry.layout, next)) continue;
    edits.push({ start: entry.start, end: entry.end, text: renderFlowEntry(next) });
  }
  const missing = [...wanted.values()].filter(layout => !present.has(connectionKey(layout.from, layout.to)));
  if (removed.length === 0) {
    if (edits.length === 0 && missing.length === 0) return text;
    if (missing.length > 0) {
      const range = (sequence as { range?: NodeRange }).range;
      if (range !== undefined) {
        const close = range[1] - 1;
        const inner = text.slice(range[0] + 1, close).trim();
        edits.push({ start: close, end: close, text: (inner.length === 0 ? '' : ', ') + missing.map(renderFlowEntry).join(', ') });
      }
    }
    return applyEdits(text, edits);
  }
  if (wanted.size === 0) return removeConnectionsKey(text, document);
  const pair = connectionsPair(document);
  if (pair === null) return text;
  return applyEdits(text, [{ start: pair.value[0], end: pair.value[1], text: renderFlow([...wanted.values()]) }]);
}

/** Add or rewrite the connections key inside a flow mapping that spans the document. */
function writeFlowRoot(text: string, document: unknown, wanted: ReadonlyMap<string, ConnectionLayout>): string {
  const pair = connectionsPair(document);
  if (pair === null) {
    if (wanted.size === 0) return text;
    const range = rootNode(document)?.range;
    if (range === undefined) return text;
    const close = range[1] - 1;
    if (close < 0 || text[close] !== '}') return text;
    const inner = text.slice(range[0] + 1, close).trim();
    return applyEdits(text, [{ start: close, end: close, text: (inner.length === 0 ? '' : ', ') + KEY + ': ' + renderFlow([...wanted.values()]) }]);
  }
  const sequence = (document as { getIn?: (path: string[]) => unknown }).getIn?.([KEY]);
  if (!isSeq(sequence)) invalid('Workflow connections must be an array.');
  return writeFlowSequence(text, document, sequence, wanted);
}

/**
 * The end of the key's own lines. A comment that follows the value on the same
 * line survives, because the author wrote it for the document; everything else
 * on the key's lines belongs to the field and goes with it.
 */
function keyEnd(text: string, valueEndOffset: number): number {
  const lineStop = Math.min(text.length, afterLine(text, valueEndOffset));
  const tailStop = lineStop > 0 && text[lineStop - 1] === NEWLINE ? lineStop - 1 : lineStop;
  return text.slice(valueEndOffset, tailStop).trim().length === 0 ? lineStop : valueEndOffset;
}

function renderBlock(layouts: readonly ConnectionLayout[], newline: string): string {
  return KEY + ':' + newline + layouts.map(layout => DEFAULT_INDENT + renderEntry(layout, DEFAULT_INDENT, newline) + newline).join('');
}

function appendBlock(text: string, layouts: readonly ConnectionLayout[]): string {
  const newline = documentNewline(text);
  return (text.endsWith(NEWLINE) ? text : text + newline) + renderBlock(layouts, newline);
}

function applyEdits(text: string, edits: readonly TextEdit[]): string {
  if (edits.length === 0) return text;
  let output = text;
  for (const edit of [...edits].sort((left, right) => right.start - left.start)) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  return output;
}

/**
 * Rewrite only the authored connection entries of a workflow document,
 * preserving every character outside them: comments, quoting, block scalars, key
 * order, and the style of every other collection. An entry the document does not
 * define is appended; an entry the caller dropped is removed, and the key goes
 * with the last one. A flow-style list is edited item by item, so an untouched
 * entry keeps its text; removing an entry from one rebuilds that list, which is
 * the only case where a comment between its items is lost.
 */
export function writeConnections(text: string, layouts: ConnectionLayouts): string {
  let document;
  try {
    document = parseDocument(text, { uniqueKeys: true, prettyErrors: false, version: '1.2' });
  } catch (error) {
    invalid('Invalid workflow YAML: ' + (error instanceof Error ? error.message : String(error)));
  }
  if (document.errors.length > 0) invalid(document.errors.map(error => error.message).join('; '));

  const wanted = new Map<string, ConnectionLayout>();
  for (const layout of Object.values(layouts)) if (layout !== undefined) wanted.set(connectionKey(layout.from, layout.to), layout);
  const sequence = document.getIn([KEY]);

  // A flow mapping cannot take a block entry, so it is edited inside its braces.
  if (rootNode(document)?.flow === true) return writeFlowRoot(text, document, wanted);

  if (!isSeq(sequence)) {
    if (wanted.size === 0) return text;
    if (sequence !== undefined) invalid('Workflow connections must be an array.');
    return appendBlock(text, [...wanted.values()]);
  }

  if (sequence.flow === true) {
    // A flow list cannot hold a block entry, so it stays flow and is edited item
    // by item. An empty list authors nothing.
    if (wanted.size === 0 && sequence.items.length === 0) return text;
    return writeFlowSequence(text, document, sequence, wanted);
  }

  const entries = authoredEntries(text, sequence);
  if (wanted.size === 0) {
    if (entries.length === 0) return text;
    const key = documentKey(text, document);
    return key === null ? text : text.slice(0, key.start) + text.slice(key.end);
  }

  const indent = sequenceIndent(text, sequence);
  const newline = documentNewline(text);
  const edits: TextEdit[] = [];
  const present = new Set<string>();
  for (const entry of entries) {
    const next = wanted.get(entry.key);
    if (next === undefined) {
      edits.push({ start: entry.start, end: entry.end, text: '' });
      continue;
    }
    present.add(entry.key);
    if (sameConnectionLayout(entry.layout, next)) continue;
    edits.push({ start: entry.start, end: entry.end, text: indent + renderEntry(next, indent, newline) + newline });
  }

  const missing = [...wanted.values()].filter(layout => !present.has(connectionKey(layout.from, layout.to)));
  if (missing.length > 0) {
    const end = entries.reduce((value, entry) => Math.max(value, entry.end), -1);
    const rendered = missing.map(layout => indent + renderEntry(layout, indent, newline) + newline).join('');
    // An insertion point at the end of a document without a final newline still
    // needs a separator, or the new entry lands on the previous entry's line.
    const prefix = (at: number) => (at > 0 && text[at - 1] === NEWLINE ? '' : newline);
    if (end >= 0) {
      edits.push({ start: end, end, text: prefix(end) + rendered });
    } else {
      const range = (sequence as { range?: [number, number, number] }).range;
      if (range !== undefined) {
        const at = valueEnd(text, range[1]);
        edits.push({ start: at, end: at, text: prefix(at) + rendered });
      }
    }
  }

  return applyEdits(text, edits);
}
