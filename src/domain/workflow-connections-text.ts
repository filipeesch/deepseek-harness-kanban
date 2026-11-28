import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import type { ConnectionAnchor, ConnectionLayout, ConnectionSegmentOffset } from '../shared/types.js';
import { KanbanError } from '../shared/errors.js';
import { connectionKey, sameConnectionLayout } from './connection-anchor.js';
import { parseWorkflow } from './workflow.js';

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

/** One authored connection entry. */
interface FlowEntry { readonly key: string; readonly layout: ConnectionLayout }

function flowEntriesOf(sequence: unknown): FlowEntry[] {
  if (!isSeq(sequence)) return [];
  const entries: FlowEntry[] = [];
  for (const item of sequence.items) {
    if (!isMap(item)) continue;
    const layout = connectionOf(item);
    if (layout === null) continue;
    entries.push({ key: connectionKey(layout.from, layout.to), layout });
  }
  return entries;
}

/** One parser source token: its kind, offset, and exact text. */
interface SourceToken { readonly type: string; readonly offset: number; readonly source: string }
/** One parser collection item: the tokens before it, and its key/value tokens. */
interface SourceItem { readonly start: readonly SourceToken[]; readonly key?: SourceToken | null; readonly sep?: readonly SourceToken[]; readonly value?: SourceToken | SourceFlow }
/** A parser flow collection: where it opens, its items, and the tokens up to its close. */
interface SourceFlow {
  readonly type: 'flow-collection';
  readonly offset: number;
  readonly start: SourceToken;
  readonly items: readonly SourceItem[];
  readonly end: readonly SourceToken[];
}
interface TextSpan { readonly start: number; readonly end: number }

function isSourceToken(value: unknown): value is SourceToken {
  return typeof value === 'object' && value !== null && typeof (value as SourceToken).offset === 'number' && typeof (value as SourceToken).source === 'string';
}

/** A flow collection token carries no text of its own: its start and end tokens do. */
function isSourceFlow(value: unknown): value is SourceFlow {
  if (typeof value !== 'object' || value === null) return false;
  const flow = value as { type?: unknown; offset?: unknown; start?: { offset?: unknown }; items?: unknown };
  return flow.type === 'flow-collection' && typeof flow.offset === 'number' && typeof flow.start?.offset === 'number' && Array.isArray(flow.items);
}

function isFlowClose(token: SourceToken): boolean {
  return token.type === 'flow-seq-end' || token.type === 'flow-map-end';
}

/** The offset just past a value token, never including tokens that follow it. */
function sourceEnd(token: SourceToken | SourceFlow): number {
  if (!isSourceFlow(token)) return token.offset + token.source.length;
  const close = token.end.find(isFlowClose);
  return close === undefined ? token.offset : close.offset + close.source.length;
}

/** Every top-level comma token of one collection, in source order. */
function commaSpans(tokens: readonly SourceToken[] | undefined): TextSpan[] {
  return (tokens ?? []).filter(token => token.type === 'comma').map(token => ({ start: token.offset, end: token.offset + token.source.length }));
}

/** One entry of a flow list, located by the parser's tokens. */
interface FlowListEntry {
  readonly start: number;
  readonly end: number;
  /** The separator token before this entry, when the parser attributed one to it. */
  readonly precedingComma?: TextSpan;
  /** The separator token after this entry, when one follows it. */
  readonly followingComma?: TextSpan;
}

interface FlowList {
  /** The offset of the closing bracket, where a new entry is inserted. */
  readonly close: number;
  readonly entries: readonly FlowListEntry[];
  /** Every separator token the list authors, surviving or not. */
  readonly commas: readonly TextSpan[];
}

/**
 * The parser's own view of one flow list: entry value ranges, separator tokens,
 * and the closing bracket. Commas are tokens of their own, a legal final comma is
 * an item without a value, and comments and quoted or nested commas never appear
 * as separators here.
 */
function flowListOf(flow: unknown): FlowList | null {
  if (!isSourceFlow(flow) || flow.start.source !== '[') return null;
  const close = flow.end.find(isFlowClose);
  if (close === undefined) return null;
  const commas: TextSpan[] = [];
  const entries: FlowListEntry[] = [];
  flow.items.forEach((item, index) => {
    commas.push(...commaSpans(item.start));
    if (item.value === undefined) return;
    const value = item.value;
    const following = flow.items[index + 1];
    const followingComma = following === undefined ? undefined : commaSpans(following.start)[0];
    const entry: FlowListEntry = {
      start: value.offset,
      end: sourceEnd(value),
      ...(commaSpans(item.start)[0] === undefined ? {} : { precedingComma: commaSpans(item.start)[0] }),
      ...(followingComma === undefined ? {} : { followingComma }),
    };
    entries.push(entry);
  });
  commas.push(...commaSpans(flow.end));
  return { close: close.offset, entries, commas };
}

/**
 * Remove the authored connections pair, taking exactly one separator token with it.
 *
 * In a flow mapping the comma and the comment that introduces the next key are
 * separate tokens: only the pair and one comma go, so the comment stays. In a block
 * mapping the key owns its own lines and no comment sits between the pair and the
 * next key.
 */
function removeConnectionsKey(text: string, document: unknown): string {
  const pair = connectionsPair(document);
  if (pair === null) return text;
  const contents = rootNode(document);
  if (contents?.flow === true) {
    const root = (contents as { srcToken?: unknown }).srcToken;
    if (isSourceFlow(root)) {
      const index = root.items.findIndex(item => isSourceToken(item.key) && item.key.offset === pair.key[0]);
      if (index >= 0) {
        const item = root.items[index]!;
        const following = root.items[index + 1];
        const comma = (following === undefined ? undefined : commaSpans(following.start)[0]) ?? commaSpans(item.start)[0];
        const edits: TextEdit[] = [{ start: pair.key[0], end: pair.value[1], text: '' }];
        if (comma !== undefined) edits.push({ start: comma.start, end: comma.end, text: '' });
        return applyEdits(text, edits);
      }
    }
  }
  const lines = documentKey(text, document);
  return lines === null ? text : text.slice(0, lines.start) + text.slice(lines.end);
}

/**
 * Rewrite a flow-style connections list from the parser's tokens.
 *
 * Only the entries that changed are replaced, and a removed entry loses only its
 * own value token and one separator token; every other byte, including the comments
 * and spaces between adjacent removed entries, is untouched. Insertions are planned
 * against what survives: no leading comma when every old entry goes, a surviving
 * trailing comma reused as the separator, and exactly one comma otherwise.
 */
function writeFlowSequence(text: string, document: unknown, sequence: unknown, wanted: ReadonlyMap<string, ConnectionLayout>): string {
  if (wanted.size === 0) return removeConnectionsKey(text, document);
  const entries = flowEntriesOf(sequence);
  const list = flowListOf((sequence as { srcToken?: unknown }).srcToken);
  // Both sides are the same document in source order: the parsed entries the
  // workflow exposes and the parser's own value items. A mismatch means the list
  // holds something this editor does not understand, so it fails closed rather
  // than rewriting bytes it cannot account for.
  if (list === null || entries.length !== list.entries.length) {
    invalid('The authored connections list could not be matched to its source tokens.');
  }
  const edits: TextEdit[] = [];
  const used = new Set<number>();
  const kept: number[] = [];
  entries.forEach((entry, index) => {
    const item = list.entries[index]!;
    const next = wanted.get(entry.key);
    if (next !== undefined) {
      kept.push(index);
      if (!sameConnectionLayout(entry.layout, next)) edits.push({ start: item.start, end: item.end, text: renderFlowEntry(next) });
      return;
    }
    // The value and one separator are separate, non-overlapping ranges, so the text
    // between them — a space, a comment, or another removed entry's gap — survives.
    const comma = [item.followingComma, item.precedingComma].find(candidate => candidate !== undefined && !used.has(candidate.start));
    if (comma !== undefined) {
      used.add(comma.start);
      edits.push({ start: comma.start, end: comma.end, text: '' });
    }
    edits.push({ start: item.start, end: item.end, text: '' });
  });
  const missing = [...wanted.values()].filter(layout => !kept.some(index => entries[index]!.key === connectionKey(layout.from, layout.to)));
  if (missing.length > 0) {
    const lastKeptEnd = kept.length === 0 ? -1 : list.entries[kept[kept.length - 1]!]!.end;
    // A surviving comma after the last entry is a separator the inserted entry can use.
    const reusable = kept.length > 0 && list.commas.some(comma => !used.has(comma.start) && comma.start >= lastKeptEnd);
    const leadingComma = kept.length > 0 && !reusable;
    edits.push({ start: list.close, end: list.close, text: (leadingComma ? ', ' : '') + missing.map(renderFlowEntry).join(', ') });
  }
  return applyEdits(text, edits);
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
 * with the last one. A flow-style list is edited from the parser's own tokens: only
 * the chosen entry values and separator commas change, so untouched entries, their
 * quoting, and the comments around them keep their bytes.
 */
export function writeConnections(text: string, layouts: ConnectionLayouts): string {
  let document;
  try {
    // Source tokens give the exact spans of entries, separators, and the brackets;
    // the editor never infers a delimiter from adjacent characters.
    document = parseDocument(text, { keepSourceTokens: true, uniqueKeys: true, prettyErrors: false, version: '1.2' });
  } catch (error) {
    invalid('Invalid workflow YAML: ' + (error instanceof Error ? error.message : String(error)));
  }
  if (document.errors.length > 0) invalid(document.errors.map(error => error.message).join('; '));

  const wanted = new Map<string, ConnectionLayout>();
  for (const layout of Object.values(layouts)) if (layout !== undefined) wanted.set(connectionKey(layout.from, layout.to), layout);
  const next = writeConnectionText(text, document, wanted);
  // The existing validation is the authority on the composed document; the editor
  // never falls back to emitting the whole list or document to make it parse.
  parseWorkflow(next);
  return next;
}

/** Compose the new document text without validating it yet. */
function writeConnectionText(text: string, document: ReturnType<typeof parseDocument>, wanted: ReadonlyMap<string, ConnectionLayout>): string {
  const sequence = document.getIn([KEY]);

  // A flow mapping cannot take a block entry, so it is edited inside its braces.
  if (rootNode(document)?.flow === true) return writeFlowRoot(text, document, wanted);

  if (!isSeq(sequence)) {
    if (wanted.size === 0) return text;
    if (sequence !== undefined) invalid('Workflow connections must be an array.');
    return appendBlock(text, [...wanted.values()]);
  }

  if (sequence.flow === true) {
    // A flow list cannot hold a block entry, so it stays flow and is edited entry
    // by entry. An empty list authors nothing.
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
