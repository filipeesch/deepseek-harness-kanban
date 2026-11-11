import { isMap, isScalar, isSeq, parseDocument } from 'yaml';

/** One literal text replacement inside an authored workflow document. */
export interface TextEdit { readonly start: number; readonly end: number; readonly text: string }
type Range = [number, number, number?] | undefined;
interface NodePair { readonly key: unknown; readonly value: unknown }

const NEWLINE = String.fromCharCode(10);

/** One authored field value: the numeric members a map field keeps (x/y, width/height). */
export type MapFieldValues = Readonly<Record<string, number>>;

const PLAIN_SCALAR = /^[A-Za-z0-9][A-Za-z0-9 ._/@-]*$/;
const RESERVED_SCALAR = /^(true|false|null|yes|no|on|off|~)$/i;

/**
 * Render one authored scalar: plain when the value cannot be misread, JSON when
 * it carries characters a single quote cannot survive, single-quoted otherwise.
 */
export function authoredScalar(value: string): string {
  if (PLAIN_SCALAR.test(value) && !RESERVED_SCALAR.test(value) && !/^-?\d/.test(value)) return value;
  if (/["\\\u0000-\u001f]/.test(value)) return JSON.stringify(value);
  return "'" + value.replace(/'/g, "''") + "'";
}

/**
 * Render one authored field, or `null` to remove it. `existing` is the field's
 * current value node, which lets a renderer keep the authored collection style;
 * `indent` is the field's own indentation, for continuation lines.
 */
export type FieldRender = (existing: unknown, indent: string, key: string, flow: boolean) => string | null;

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

/** One authored field of one sequence entry, written by text range. */
export interface SequenceFieldEdit {
  /** The authored workflow text. */
  readonly text: string;
  /** The sequence that holds the maps, e.g. `columns` or `groups`. */
  readonly sequenceKey: string;
  /** The key that identifies one map inside the sequence, e.g. `id`. */
  readonly idKey: string;
  /** The id of the entry this edit writes. */
  readonly id: string;
  /** The accepted keys, in order; the first existing one is rewritten, else the first is added. */
  readonly fieldKeys: readonly string[];
  /** Render the field, or return null to remove it. */
  readonly render: FieldRender;
  readonly invalid: (message: string) => never;
}

/** One authored top-level field, written by text range. */
export interface RootFieldEdit {
  readonly text: string;
  /** The accepted keys, in order; the first existing one is rewritten, else the first is added. */
  readonly fieldKeys: readonly string[];
  readonly render: FieldRender;
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

/** The authored text of one field's value, without the newline a block value ends with. */
function valueText(text: string, pair: NodePair): string | undefined {
  const range = pairRange(pair);
  if (range === undefined) return undefined;
  const end = range[1] > 0 && text[range[1] - 1] === NEWLINE ? range[1] - 1 : range[1];
  return text.slice(range[0], end);
}

/**
 * Plan one field rewrite. The document is edited by text range, not re-serialized,
 * so every other character the author wrote is preserved: comments, quoting,
 * block scalars, key order, and the style of every other collection.
 */
function planFieldEdit(text: string, item: unknown, pairs: readonly NodePair[], fieldKeys: readonly string[], render: FieldRender, unchanged?: (existing: unknown) => boolean, target?: NodePair): TextEdit | null {
  const existingEntry = target === undefined
    ? pairs.map(pair => ({ pair, key: pairKey(pair) })).find(entry => entry.key !== undefined && fieldKeys.includes(entry.key))
    : { pair: target, key: pairKey(target) ?? fieldKeys[0] };
  const existing = existingEntry?.pair;
  const fieldKey = existingEntry?.key ?? fieldKeys[0];
  if (fieldKey === undefined) return null;
  const flow = (item as { flow?: boolean } | null)?.flow === true;
  const indent = fieldIndent(text, pairs) ?? '';
  const rendered = render(existing?.value, indent, fieldKey, flow);
  if (rendered === null) {
    if (existing === undefined) return null;
    const start = keyStart(existing);
    const range = pairRange(existing);
    if (start === undefined || range === undefined) return null;
    // A block collection's value end includes its trailing newline; deleting
    // through it removes the field lines and leaves the next key intact.
    const endsWithNewline = range[1] > 0 && text[range[1] - 1] === NEWLINE;
    const lineBegin = lineStart(text, start);
    // A field that starts the sequence item shares its line with the dash; it
    // must not take the dash with it, or the item stops being a sequence entry.
    const startsItem = /^[ \t]*-[ \t]+$/.test(text.slice(lineBegin, start));
    const deleteStart = startsItem ? start : lineBegin;
    const deleteEnd = startsItem
      ? (endsWithNewline ? range[1] - 1 : Math.min(text.length, lineEnd(text, range[1])))
      : (endsWithNewline ? range[1] : Math.min(text.length, lineEnd(text, range[1]) + 1));
    return flow ? flowRemoval(text, start, range[1]) : { start: deleteStart, end: deleteEnd, text: '' };
  }
  if (existing !== undefined) {
    const same = unchanged === undefined ? valueText(text, existing) === rendered : unchanged(existing.value);
    if (same) return null;
    const start = keyStart(existing);
    const range = pairRange(existing);
    if (start === undefined || range === undefined) return null;
    // Keep the newline that ends a block value; it belongs to the next line.
    const replaceEnd = range[1] > 0 && text[range[1] - 1] === NEWLINE ? range[1] - 1 : range[1];
    return { start, end: replaceEnd, text: rendered };
  }
  if (flow) {
    // A flow collection's value end is exactly one past its closing brace, even
    // when a comment follows the item, so YAML's own ranges delimit the map.
    const range = (item as unknown as { range?: [number, number, number] }).range;
    if (range === undefined) return null;
    const close = range[1] - 1;
    if (close < 0 || text[close] !== '}') return null;
    return { start: close, end: close, text: ', ' + rendered };
  }
  const indentForField = fieldIndent(text, pairs);
  if (indentForField === undefined) return null;
  // Append after the last field's line rather than at the item's node end: a
  // comment that follows the item must keep its own line instead of being cut.
  const last = pairs.at(-1);
  const lastEnd = last === undefined ? undefined : pairRange(last)?.[1];
  const at = lastEnd === undefined ? (item as unknown as { range?: [number, number, number] }).range?.[2] : (text[lastEnd - 1] === NEWLINE ? lastEnd : Math.min(text.length, lineEnd(text, lastEnd) + 1));
  if (at === undefined) return null;
  const newline = text.includes('\r\n') ? '\r\n' : NEWLINE;
  const prefix = at > 0 && text[at - 1] === NEWLINE ? '' : newline;
  return { start: at, end: at, text: prefix + indentForField + rendered + newline };
}

function applyEdits(text: string, edits: readonly TextEdit[]): string {
  if (edits.length === 0) return text;
  let output = text;
  for (const edit of [...edits].sort((left, right) => right.start - left.start)) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  return output;
}

function documentOf(text: string, invalid: (message: string) => never) {
  let document;
  try {
    document = parseDocument(text, { uniqueKeys: true, prettyErrors: false, version: '1.2' });
  } catch (error) {
    invalid('Invalid workflow YAML: ' + (error instanceof Error ? error.message : String(error)));
  }
  if (document.errors.length > 0) invalid(document.errors.map(error => error.message).join('; '));
  return document;
}

/**
 * Rewrite only one map field of an authored workflow document. A map with no
 * requested value loses its key; a value for a map the document does not define
 * is ignored, which keeps an undo harmless after a stage was removed.
 */
export function editMapFieldInSequence(edit: MapFieldEdit): string {
  const document = documentOf(edit.text, edit.invalid);
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
    const planned = planFieldEdit(
      edit.text, item, pairs, [edit.fieldKey],
      () => (wanted === undefined ? null : edit.render(wanted)),
      wanted === undefined ? undefined : existing => sameValues(existing, wanted),
    );
    if (planned !== null) edits.push(planned);
  }
  return applyEdits(edit.text, edits);
}

/**
 * Rewrite one authored field of one entry in an authored workflow sequence,
 * preserving every character outside it. Throws through `invalid` when the
 * sequence is missing or the entry is not defined, because the caller asked for
 * a specific entry rather than for a bulk update.
 */
export function writeSequenceItemField(edit: SequenceFieldEdit): string {
  const document = documentOf(edit.text, edit.invalid);
  const sequence = document.getIn([edit.sequenceKey]);
  if (!isSeq(sequence)) edit.invalid('Workflow ' + edit.sequenceKey + ' must be an array.');
  for (const item of sequence.items) {
    if (!isMap(item)) continue;
    const pairs = item.items as unknown as NodePair[];
    const idPair = pairs.find(pair => pairKey(pair) === edit.idKey);
    if (idPair === undefined) continue;
    if ((idPair.value as { value?: unknown } | null)?.value !== edit.id) continue;
    const authored = pairs.filter(pair => { const key = pairKey(pair); return key !== undefined && edit.fieldKeys.includes(key); });
    const edits: TextEdit[] = [];
    if (authored.length === 0) {
      const appended = planFieldEdit(edit.text, item, pairs, edit.fieldKeys, edit.render);
      if (appended !== null) edits.push(appended);
    } else for (const pair of authored) {
      const rewritten = planFieldEdit(edit.text, item, pairs, [pairKey(pair) ?? edit.fieldKeys[0]!], edit.render, undefined, pair);
      if (rewritten !== null) edits.push(rewritten);
    }
    return applyEdits(edit.text, edits);
  }
  return edit.invalid('Workflow ' + edit.sequenceKey + ' has no entry ' + edit.id + '.');
}

/** Rewrite one authored top-level field, preserving every character outside it. */
export function writeRootField(edit: RootFieldEdit): string {
  const document = documentOf(edit.text, edit.invalid);
  const contents = document.contents as unknown as { items?: unknown[]; flow?: boolean } | null;
  const pairs = (contents?.items ?? []) as NodePair[];
  const planned = planFieldEdit(edit.text, contents, pairs, edit.fieldKeys, edit.render);
  return planned === null ? edit.text : applyEdits(edit.text, [planned]);
}

/** One authored list whose scalars may name a stage. */
export interface ListScalarEdit {
  readonly text: string;
  /** The sequence that holds the entries. */
  readonly sequenceKey: string;
  /** Present to address one entry by id; absent to scan the whole sequence. */
  readonly entry?: { readonly idKey: string; readonly id: string };
  /** Selects the entry by position, for a sequence whose entries may omit their id. */
  readonly entryIndex?: number;
  /** The map key whose value is the list; absent when the sequence is the field itself. */
  readonly fieldKey?: string;
  /** For a list of maps, the keys whose scalar may match; empty for a list of scalars. */
  readonly innerKeys: readonly string[];
  /** The authored scalar to replace. */
  readonly from: string;
  /** The replacement text, already rendered as a YAML scalar. */
  readonly to: string;
  readonly invalid: (message: string) => never;
}

/**
 * Replace the scalars that equal `from` inside one authored list, keeping every
 * other character: comments between entries, quoting, and the list's style.
 * Returns the edited text and how many scalars changed.
 */
export function replaceListScalars(edit: ListScalarEdit): { text: string; replaced: number } {
  const document = documentOf(edit.text, edit.invalid);
  let node: unknown;
  if (edit.entryIndex !== undefined) {
    const sequence = document.getIn([edit.sequenceKey]);
    if (!isSeq(sequence)) return { text: edit.text, replaced: 0 };
    const item = sequence.items[edit.entryIndex];
    if (isMap(item)) node = edit.fieldKey === undefined ? item : (item as unknown as { get(key: string, keepScalar: true): unknown }).get(edit.fieldKey, true);
  } else if (edit.entry === undefined) node = document.getIn([edit.sequenceKey]);
  else {
    const sequence = document.getIn([edit.sequenceKey]);
    if (!isSeq(sequence)) return { text: edit.text, replaced: 0 };
    for (const item of sequence.items) {
      if (!isMap(item)) continue;
      const idPair = (item.items as unknown as NodePair[]).find(pair => pairKey(pair) === edit.entry!.idKey);
      if ((idPair?.value as { value?: unknown } | null)?.value !== edit.entry!.id) continue;
      node = edit.fieldKey === undefined ? item : (item as unknown as { get(key: string, keepScalar: true): unknown }).get(edit.fieldKey, true);
      break;
    }
  }
  if (!isSeq(node)) return { text: edit.text, replaced: 0 };
  const edits: TextEdit[] = [];
  const consider = (candidate: unknown) => {
    if (!isScalar(candidate) || candidate.value !== edit.from) return;
    const range = (candidate as { range?: Range }).range;
    if (range === undefined) return;
    edits.push({ start: range[0], end: range[1], text: edit.to });
  };
  for (const element of node.items as unknown[]) {
    if (edit.innerKeys.length === 0) { consider(element); continue; }
    if (!isMap(element)) continue;
    for (const key of edit.innerKeys) consider((element as unknown as { get(key: string, keepScalar: true): unknown }).get(key, true));
  }
  return { text: applyEdits(edit.text, edits), replaced: edits.length };
}
