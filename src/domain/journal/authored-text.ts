import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import { KanbanError } from '../../shared/errors.js';

/**
 * Structural edits on an authored workflow document, addressed by text range.
 *
 * An item's span is delimited by where the next item starts, not by the YAML node's
 * own end: a node end can point past the newline into the following entry. Every
 * helper rewrites only its span, so comments, key order, quoting, and every other
 * entry stay exactly as their author wrote them.
 */

const NEWLINE = String.fromCharCode(10);

function invalid(message: string): never {
  throw new KanbanError('INVALID_WORKFLOW', message);
}

function documentOf(text: string) {
  let document;
  try {
    document = parseDocument(text, { uniqueKeys: true, prettyErrors: false, version: '1.2' });
  } catch (error) {
    invalid('Invalid workflow YAML: ' + (error instanceof Error ? error.message : String(error)));
  }
  if (document.errors.length > 0) invalid(document.errors.map(error => error.message).join('; '));
  return document;
}

type NodeRange = [number, number, number];

function lineStart(text: string, offset: number): number {
  return text.lastIndexOf(NEWLINE, offset - 1) + 1;
}

function lineEnd(text: string, offset: number): number {
  const index = text.indexOf(NEWLINE, offset);
  return index < 0 ? text.length : index;
}

function nodeRange(node: unknown): NodeRange | undefined {
  return (node as { range?: NodeRange } | null)?.range;
}

function items(node: unknown): unknown[] {
  return isSeq(node) ? (node.items as unknown[]) : [];
}

function pairValueNode(item: unknown, key: string): unknown {
  if (!isMap(item)) return undefined;
  for (const pair of item.items as unknown[]) {
    const keyNode = (pair as { key?: unknown }).key;
    if (isScalar(keyNode) && keyNode.value === key) return (pair as { value?: unknown }).value;
  }
  return undefined;
}

/** Where one entry begins, dash line included. */
function itemStart(text: string, node: unknown): number | undefined {
  const range = nodeRange(node);
  if (range === undefined) return undefined;
  const keyStarts: number[] = [];
  if (isMap(node)) {
    for (const pair of node.items as unknown[]) {
      const keyRange = nodeRange((pair as { key?: unknown }).key);
      if (keyRange !== undefined) keyStarts.push(keyRange[0]);
    }
  }
  const contentStart = keyStarts.length === 0 ? range[0] : Math.min(...keyStarts);
  const begin = lineStart(text, contentStart);
  const prefix = text.slice(begin, contentStart);
  // An entry that starts on its own line owns the dash; one that starts inline keeps
  // the dash as the marker that makes it a sequence entry.
  return /^[ \t]*-[ \t]+$/.test(prefix) ? begin : contentStart;
}

/** Where the content of one entry ends, before the line's own newline. */
function itemContentEnd(text: string, node: unknown): number | undefined {
  const range = nodeRange(node);
  if (range === undefined) return undefined;
  let last = range[1];
  if (isMap(node)) {
    for (const pair of node.items as unknown[]) {
      const valueRange = nodeRange((pair as { value?: unknown }).value);
      if (valueRange !== undefined) last = Math.max(last, valueRange[1]);
    }
  }
  return lineEnd(text, last);
}

/** The start of the first top-level key that follows the sequence, or the end of the text. */
function sequenceBoundary(text: string, sequenceKey: string): number {
  const document = documentOf(text);
  const contents = (document.contents as unknown as { items?: unknown[] } | null)?.items ?? [];
  let seen = false;
  for (const pair of contents) {
    const keyNode = (pair as { key?: unknown }).key;
    const name = isScalar(keyNode) ? keyNode.value : undefined;
    if (name === sequenceKey) { seen = true; continue; }
    if (!seen) continue;
    const keyRange = nodeRange(keyNode);
    if (keyRange === undefined) continue;
    return lineStart(text, keyRange[0]);
  }
  return text.length;
}

/** The span one entry occupies, dash line through its trailing newline. */
export interface ItemSpan { readonly start: number; readonly end: number }

/**
 * The span one entry occupies. The next entry's start and the sequence boundary are
 * hard limits: a node end that points into the following entry is not usable.
 */
function spanOf(text: string, node: unknown, boundary: number, nextStart?: number): ItemSpan | undefined {
  const start = itemStart(text, node);
  if (start === undefined) return undefined;
  const limit = nextStart === undefined ? boundary : Math.min(boundary, nextStart);
  const contentEnd = itemContentEnd(text, node);
  // A content end sits before the entry's own newline, so the span consumes it. The
  // limit is already a line start, so it is used as is.
  const usable = contentEnd !== undefined && contentEnd >= start && contentEnd <= limit;
  const end = usable ? (contentEnd === text.length ? contentEnd : contentEnd + 1) : limit;
  return { start, end };
}

/** How one sequence entry is addressed. Fields must all match; an index counts entries. */
export interface EntryLocator {
  readonly index?: number;
  readonly fields?: Readonly<Record<string, string>>;
}

function matchesFields(item: unknown, fields: Readonly<Record<string, string>>): boolean {
  if (!isMap(item)) return false;
  for (const [key, wanted] of Object.entries(fields)) {
    const value = pairValueNode(item, key);
    if (!isScalar(value) || value.value !== wanted) return false;
  }
  return true;
}

function locateIndex(node: unknown, locator: EntryLocator): number | undefined {
  const entries = items(node);
  if (locator.index !== undefined) return locator.index < entries.length ? locator.index : undefined;
  if (locator.fields === undefined) return undefined;
  const found = entries.findIndex(item => matchesFields(item, locator.fields!));
  return found < 0 ? undefined : found;
}

function sequenceOf(text: string, sequenceKey: string) {
  const document = documentOf(text);
  return { document, node: document.getIn([sequenceKey]) };
}

/** The indentation the sequence's entries use, taken from the first authored entry. */
function itemIndent(text: string, node: unknown): string {
  for (const item of items(node)) {
    const start = itemStart(text, item);
    if (start === undefined) continue;
    const match = /^[ \t]*/.exec(text.slice(start, start + 200));
    if (match !== null) return match[0];
  }
  return '  ';
}

/** One entry rendered as block lines, dash at the given indentation. */
function renderItem(indent: string, item: readonly string[]): string {
  return item.map((line, index) => (index === 0 ? indent + '- ' + line : indent + '  ' + line)).join(NEWLINE);
}

/**
 * Append one entry to an authored sequence. A sequence that is absent, empty, or
 * authored in flow style is replaced by a block collection, because a flow
 * collection cannot take an appended block entry.
 */
export function appendSequenceItem(input: {
  readonly text: string;
  readonly sequenceKey: string;
  readonly item: readonly string[];
  /** One-line form, used when the sequence is authored in flow style. */
  readonly flowItem?: string;
  readonly invalid?: (message: string) => never;
}): string {
  const reject = input.invalid ?? invalid;
  const { node } = sequenceOf(input.text, input.sequenceKey);
  if (node === null || node === undefined) {
    const prefix = input.text.endsWith(NEWLINE) || input.text.length === 0 ? input.text : input.text + NEWLINE;
    return prefix + input.sequenceKey + ':' + NEWLINE + renderItem('  ', input.item) + NEWLINE;
  }
  if (!isSeq(node)) reject('Workflow ' + input.sequenceKey + ' must be an array.');
  const entries = items(node);
  if ((node as { flow?: boolean }).flow === true) {
    const range = nodeRange(node)!;
    if (entries.length === 0) return input.text.slice(0, range[0]) + NEWLINE + renderItem('  ', input.item) + NEWLINE + input.text.slice(range[1]);
    // A flow list that already holds entries takes a flow entry, so the authored
    // style of every existing entry is kept instead of being re-serialized.
    if (input.flowItem === undefined) reject('Workflow ' + input.sequenceKey + ' is authored in flow style and cannot take this entry.');
    const close = range[1] - 1;
    if (close < 0 || input.text[close] !== ']') reject('Workflow ' + input.sequenceKey + ' cannot be extended.');
    const inner = input.text.slice(range[0] + 1, close).trim();
    return input.text.slice(0, close) + (inner.length === 0 ? '' : ', ') + input.flowItem + input.text.slice(close);
  }
  const indent = itemIndent(input.text, node);
  const rendered = renderItem(indent, input.item);
  if (entries.length === 0) {
    const range = nodeRange(node)!;
    return input.text.slice(0, range[1]) + NEWLINE + rendered + NEWLINE + input.text.slice(range[1]);
  }
  const boundary = sequenceBoundary(input.text, input.sequenceKey);
  const last = spanOf(input.text, entries[entries.length - 1], boundary);
  if (last === undefined) reject('Workflow ' + input.sequenceKey + ' cannot be extended.');
  const insertAt = last!.end;
  const needsNewline = insertAt > 0 && input.text[insertAt - 1] !== NEWLINE;
  return input.text.slice(0, insertAt) + (needsNewline ? NEWLINE : '') + rendered + NEWLINE + input.text.slice(insertAt);
}

/** The authored text of every entry of a flow sequence, so a rewrite keeps each one. */
function flowItemTexts(text: string, node: unknown): string[] | undefined {
  const spans = items(node).map(entry => nodeRange(entry));
  if (spans.some(span => span === undefined)) return undefined;
  return spans.map(span => text.slice(span![0], span![1]));
}

/**
 * Rewrite a flow sequence entry by entry, keeping the authored text of every entry
 * the caller does not replace. The separators and the line breaks between entries are
 * normalized, which is the loss a flow collection takes when one entry changes.
 */
function rebuildFlow(text: string, node: unknown, keep: (index: number, authored: string) => string | null): string | undefined {
  const range = nodeRange(node);
  if (range === undefined) return undefined;
  const close = range[1] - 1;
  if (close < 0 || text[close] !== ']') return undefined;
  const authored = flowItemTexts(text, node);
  if (authored === undefined) return undefined;
  const kept = authored.map((entry, index) => keep(index, entry)).filter((entry): entry is string => entry !== null);
  return text.slice(0, range[0]) + '[' + kept.join(', ') + ']' + text.slice(close + 1);
}

/** Remove one authored sequence entry, keeping every other entry's text. */
export function removeSequenceItem(input: {
  readonly text: string;
  readonly sequenceKey: string;
} & EntryLocator): string {
  const { node } = sequenceOf(input.text, input.sequenceKey);
  const index = locateIndex(node, input);
  if (index === undefined) return input.text;
  if ((node as { flow?: boolean }).flow === true) {
    const rebuilt = rebuildFlow(input.text, node, (position, authored) => (position === index ? null : authored));
    return rebuilt ?? input.text;
  }
  const entries = items(node);
  const boundary = sequenceBoundary(input.text, input.sequenceKey);
  const nextStart = index + 1 < entries.length ? itemStart(input.text, entries[index + 1]) : undefined;
  const span = spanOf(input.text, entries[index], boundary, nextStart);
  if (span === undefined) return input.text;
  return input.text.slice(0, span.start) + input.text.slice(span.end);
}

/** The authored text of one sequence entry, dash line included, without its trailing newline. */
export function sequenceItemText(input: {
  readonly text: string;
  readonly sequenceKey: string;
} & EntryLocator): string | undefined {
  const { node } = sequenceOf(input.text, input.sequenceKey);
  const index = locateIndex(node, input);
  if (index === undefined) return undefined;
  const entry = items(node)[index];
  if ((node as { flow?: boolean }).flow === true) {
    const range = nodeRange(entry);
    return range === undefined ? undefined : input.text.slice(range[0], range[1]);
  }
  const entries = items(node);
  const boundary = sequenceBoundary(input.text, input.sequenceKey);
  const nextStart = index + 1 < entries.length ? itemStart(input.text, entries[index + 1]) : undefined;
  const span = spanOf(input.text, entry, boundary, nextStart);
  if (span === undefined) return undefined;
  const authored = input.text.slice(span.start, span.end);
  return authored.endsWith(NEWLINE) ? authored.slice(0, -1) : authored;
}

/** The authored span of one sequence entry, so a caller can scope a text match to it. */
export function sequenceItemSpan(input: {
  readonly text: string;
  readonly sequenceKey: string;
} & EntryLocator): ItemSpan | undefined {
  const { node } = sequenceOf(input.text, input.sequenceKey);
  const index = locateIndex(node, input);
  if (index === undefined) return undefined;
  const entry = items(node)[index];
  if ((node as { flow?: boolean }).flow === true) {
    const range = nodeRange(entry);
    return range === undefined ? undefined : { start: range[0], end: range[1] };
  }
  const entries = items(node);
  const boundary = sequenceBoundary(input.text, input.sequenceKey);
  const nextStart = index + 1 < entries.length ? itemStart(input.text, entries[index + 1]) : undefined;
  return spanOf(input.text, entry, boundary, nextStart);
}

/**
 * Insert one entry after a located entry of an authored sequence, keeping every
 * other character. A flow-style sequence keeps its one-line form.
 */
export function insertSequenceItemAfter(input: {
  readonly text: string;
  readonly sequenceKey: string;
  readonly after: EntryLocator;
  readonly item: readonly string[];
  /** One-line form, required when the sequence is authored in flow style. */
  readonly flowItem?: string;
  readonly invalid?: (message: string) => never;
}): string {
  const reject = input.invalid ?? invalid;
  const { node } = sequenceOf(input.text, input.sequenceKey);
  if (!isSeq(node)) return reject('Workflow ' + input.sequenceKey + ' must be an array.');
  const index = locateIndex(node, input.after);
  if (index === undefined) return reject('Workflow ' + input.sequenceKey + ' does not contain the named entry.');
  const entries = items(node);
  if ((node as { flow?: boolean }).flow === true) {
    if (input.flowItem === undefined) return reject('Workflow ' + input.sequenceKey + ' is authored in flow style and cannot take this entry.');
    const range = nodeRange(entries[index]);
    if (range === undefined) return reject('Workflow ' + input.sequenceKey + ' cannot be extended.');
    return input.text.slice(0, range[1]) + ', ' + input.flowItem + input.text.slice(range[1]);
  }
  const boundary = sequenceBoundary(input.text, input.sequenceKey);
  const nextStart = index + 1 < entries.length ? itemStart(input.text, entries[index + 1]) : undefined;
  const span = spanOf(input.text, entries[index], boundary, nextStart);
  if (span === undefined) return reject('Workflow ' + input.sequenceKey + ' cannot be extended.');
  const insertAt = span.end;
  const needsNewline = insertAt > 0 && input.text[insertAt - 1] !== NEWLINE;
  return input.text.slice(0, insertAt) + (needsNewline ? NEWLINE : '') + renderItem(itemIndent(input.text, node), input.item) + NEWLINE + input.text.slice(insertAt);
}

/** Replace one authored sequence entry in place, keeping every other entry's text. */
export function replaceSequenceItem(input: {
  readonly text: string;
  readonly sequenceKey: string;
  readonly item: readonly string[];
  /** One-line form, used when the sequence is authored in flow style. */
  readonly flowItem?: string;
} & EntryLocator): string {
  const { node } = sequenceOf(input.text, input.sequenceKey);
  const index = locateIndex(node, input);
  if (index === undefined) return input.text;
  if ((node as { flow?: boolean }).flow === true) {
    if (input.flowItem === undefined) return input.text;
    const rebuilt = rebuildFlow(input.text, node, (position, authored) => (position === index ? input.flowItem! : authored));
    return rebuilt ?? input.text;
  }
  const entries = items(node);
  const boundary = sequenceBoundary(input.text, input.sequenceKey);
  const nextStart = index + 1 < entries.length ? itemStart(input.text, entries[index + 1]) : undefined;
  const span = spanOf(input.text, entries[index], boundary, nextStart);
  if (span === undefined) return input.text;
  const indent = /^[ \t]*/.exec(input.text.slice(span.start, span.start + 200))?.[0] ?? '  ';
  return input.text.slice(0, span.start) + renderItem(indent, input.item) + NEWLINE + input.text.slice(span.end);
}

/** Drop the key of a sequence that is left with no entries, so the document stays valid. */
export function pruneEmptySequence(text: string, sequenceKey: string): string {
  const document = documentOf(text);
  const contents = (document.contents as unknown as { items?: unknown[] } | null)?.items ?? [];
  for (const pair of contents) {
    const keyNode = (pair as { key?: unknown }).key;
    if (!isScalar(keyNode) || keyNode.value !== sequenceKey) continue;
    const value = (pair as { value?: unknown }).value;
    // A key with no value parses as a null scalar, not as an absent node.
    const empty = value === null || (isScalar(value) && value.value === null) || (isSeq(value) && value.items.length === 0);
    if (!empty) return text;
    const keyRange = nodeRange(keyNode);
    const valueRange = nodeRange(value);
    if (keyRange === undefined) return text;
    const start = lineStart(text, keyRange[0]);
    const end = valueRange === undefined ? lineEnd(text, keyRange[1]) : lineEnd(text, valueRange[1]);
    return text.slice(0, start) + text.slice(end === text.length ? end : end + 1);
  }
  return text;
}
