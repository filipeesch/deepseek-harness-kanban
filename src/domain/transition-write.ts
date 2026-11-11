import { isMap, isScalar, isSeq, parseDocument, type Document, type Pair, type YAMLMap, type YAMLSeq } from 'yaml';
import type { TransitionRule } from '../shared/types.js';
import { KanbanError } from '../shared/errors.js';
import { authoredScalar } from './yaml-map-fields.js';
import { transitionRule } from './transition-rule.js';

const NEWLINE = String.fromCharCode(10);

/** One destination as a flow mapping, the form a flow list holds. */
function flowItem(rule: TransitionRule): string {
  return rule.when === undefined
    ? '{to: ' + authoredScalar(rule.to) + '}'
    : '{to: ' + authoredScalar(rule.to) + ', when: ' + authoredScalar(rule.when) + '}';
}

/** One destination as a block sequence entry whose dash sits at the given indentation. */
function blockEntry(rule: TransitionRule, dashIndent: string): string {
  return dashIndent + '- to: ' + authoredScalar(rule.to) + (rule.when === undefined ? '' : NEWLINE + dashIndent + '  when: ' + authoredScalar(rule.when));
}

/** One destination as a block sequence entry under a field at the given indentation. */
function blockItem(rule: TransitionRule, indent: string): string {
  return blockEntry(rule, indent + '  ');
}

/** The indentation the authored list's dashes already use, so an appended entry aligns. */
function dashIndentOf(text: string, item: unknown): string | undefined {
  const range = rangeOf(item);
  if (range === undefined) return undefined;
  const prefix = text.slice(lineStart(text, range[0]), range[0]);
  const match = /^([ \t]*)-[ \t]+$/.exec(prefix);
  return match === null ? undefined : match[1];
}

/** The whole authored field for a destination list; an empty list is authored state. */
export function renderTransitionList(rules: readonly TransitionRule[], indent: string, flow: boolean): string {
  if (rules.length === 0) return 'allowed_transitions: []';
  return flow
    ? 'allowed_transitions: [' + rules.map(flowItem).join(', ') + ']'
    : 'allowed_transitions:' + NEWLINE + rules.map(rule => blockItem(rule, indent)).join(NEWLINE);
}

/** The value part of the field, for a field that already exists. */
function renderValue(rules: readonly TransitionRule[], indent: string, flow: boolean): string {
  if (rules.length === 0) return '[]';
  return flow ? '[' + rules.map(flowItem).join(', ') + ']' : NEWLINE + rules.map(rule => blockItem(rule, indent)).join(NEWLINE);
}

/** One destination's condition, edited without rewriting the stage's other entries. */
export interface TransitionConditionInput {
  readonly text: string;
  /** The stage that owns the destination. */
  readonly stageId: string;
  /** The destination whose condition changes. */
  readonly to: string;
  /** The new condition; null or blank removes it. */
  readonly when: string | null;
}

function invalid(message: string): never {
  throw new KanbanError('INVALID_WORKFLOW', message);
}

function lineStart(text: string, offset: number): number {
  return text.lastIndexOf(NEWLINE, offset - 1) + 1;
}

function lineEnd(text: string, offset: number): number {
  const index = text.indexOf(NEWLINE, offset);
  return index < 0 ? text.length : index;
}

/**
 * Where a line ends, as an insertion point. A block node's range can already
 * include its trailing newline, so the offset is walked back to the last content
 * character before the newline it may carry.
 */
function lineInsertAt(text: string, end: number): number {
  let index = end;
  while (index > 0 && (text[index - 1] === NEWLINE || text[index - 1] === '\r')) index -= 1;
  return index;
}

function indentAt(text: string, offset: number): string {
  const match = /^[ \t]*/.exec(text.slice(lineStart(text, offset), offset));
  return match === null ? '' : match[0];
}

type Range = [number, number, number?];

function rangeOf(node: unknown): Range | undefined {
  return (node as { range?: Range } | null)?.range;
}

function pairStart(pair: Pair): number {
  const range = rangeOf(pair.key);
  if (range === undefined) invalid('The authored workflow has an entry without a position.');
  return range[0];
}

function pairNamed(node: unknown, key: string): Pair | undefined {
  if (!isMap(node)) return undefined;
  return (node as YAMLMap).items.find(item => isScalar(item.key) && item.key.value === key && item.value !== null) as Pair | undefined;
}

function scalarOf(pair: Pair | undefined): string | undefined {
  return pair !== undefined && isScalar(pair.value) && typeof pair.value.value === 'string' ? pair.value.value : undefined;
}

/** Remove a pair from a flow mapping, taking the comma that joined it. */
function flowPairRemoval(text: string, start: number, end: number): { start: number; end: number } {
  let from = start;
  while (from > 0 && (text[from - 1] === ' ' || text[from - 1] === String.fromCharCode(9))) from -= 1;
  if (text[from - 1] === ',') return { start: from - 1, end };
  let to = end;
  while (to < text.length && text[to] === ' ') to += 1;
  if (text[to] === ',') to += 1;
  return { start, end: to };
}

function splice(text: string, start: number, end: number, replacement: string): string {
  return text.slice(0, start) + replacement + text.slice(end);
}

/**
 * The separator a collection needs before an inserted member. An authored collection
 * may already end with a comma, and inserting another one produces invalid YAML.
 */
function separatorBefore(text: string, at: number): string {
  let index = at - 1;
  while (index >= 0 && (text[index] === ' ' || text[index] === String.fromCharCode(9) || text[index] === NEWLINE || text[index] === '\r')) index -= 1;
  return text[index] === ',' ? '' : ', ';
}

function parse(text: string): Document {
  try {
    const document = parseDocument(text, { uniqueKeys: true, prettyErrors: false, version: '1.2' });
    if (document.errors.length > 0) invalid(document.errors.map(error => error.message).join('; '));
    return document;
  } catch (error) {
    if (error instanceof KanbanError) throw error;
    return invalid('Invalid workflow YAML: ' + (error instanceof Error ? error.message : String(error)));
  }
}

/** The authored node of one stage, or a rejection when the workflow does not hold it. */
function stageNode(document: Document, stageId: string): YAMLMap {
  const columns = pairNamed(document.contents, 'columns');
  if (columns === undefined || !isSeq(columns.value)) invalid('Workflow requires a columns sequence.');
  const entry = (columns.value as YAMLSeq).items.find(item => scalarOf(pairNamed(item, 'id')) === stageId);
  if (entry === undefined) invalid('Stage ' + stageId + ' does not exist in this workflow.');
  if (!isMap(entry)) invalid('Column ' + stageId + ' must be a mapping.');
  return entry as YAMLMap;
}

/** The indentation of a stage's own fields, for a field that must be added. */
function stageFieldIndent(text: string, stage: YAMLMap): string {
  const source = stage.items.filter(item => item.value !== null)[1] ?? stage.items.find(item => item.value !== null);
  if (source === undefined) return '  ';
  const start = pairStart(source as Pair);
  const before = text.slice(lineStart(text, start), start);
  const inline = /^([ \t]*)-[ \t]+$/.exec(before);
  return inline === null ? indentAt(text, start) : inline[1] + '  ';
}

/**
 * Author one destination's condition in authored workflow text.
 *
 * Only that destination's entry is touched, so the other entries keep their
 * comments, quoting, and order: a condition edit must never rewrite an authored
 * collection it does not change. A destination the stage does not author yet is
 * added, which is how the diagram's default path becomes an authored transition
 * when its condition is written.
 */
export function writeTransitionCondition({ text, stageId, to, when }: TransitionConditionInput): string {
  if (stageId === to) invalid('A stage cannot be its own transition target.');
  const rule = transitionRule(to, when);
  const document = parse(text);
  const stage = stageNode(document, stageId);
  const field = pairNamed(stage, 'allowed_transitions');
  const stageFlow = stage.flow === true;
  let next: string;

  if (field === undefined) {
    // The stage authored no destination: naming one authors exactly that one.
    const indent = stageFieldIndent(text, stage);
    const fieldText = renderTransitionList([rule], indent, stageFlow);
    if (stageFlow) {
      // The closing brace is located by text, because a flow node's end range may or may
      // not include it.
      const at = text.lastIndexOf('}', rangeOf(stage)![1]);
      next = splice(text, at, at, separatorBefore(text, at) + fieldText);
    } else {
      // The stage's own last value ends the line the field is added after; a map
      // node's end range can reach into the next entry, so it is not used here.
      const last = stage.items.filter(item => item.value !== null).at(-1) as Pair | undefined;
      const at = lineInsertAt(text, rangeOf(last?.value)![1]);
      next = splice(text, at, at, NEWLINE + indent + fieldText);
    }
  } else {
    if (!isSeq(field.value)) invalid('allowed_transitions must be a list of destinations.');
    const value = field.value as YAMLSeq;
    const indent = indentAt(text, pairStart(field));
    const flow = value.flow === true;
    // A destination is authored either as a bare identifier or as a mapping; both forms
    // describe the same transition, so both are found here.
    const bare = (item: unknown): string | undefined => isScalar(item) && typeof item.value === 'string' ? item.value : undefined;
    const index = value.items.findIndex(item => scalarOf(pairNamed(item, 'to')) === to || bare(item) === to);
    if (value.items.length === 0) {
      const range = rangeOf(value)!;
      next = splice(text, range[0], range[1], renderValue([rule], indent, flow));
    } else if (index < 0) {
      // A destination the stage does not author yet is appended in authored order.
      if (flow) {
        const at = text.lastIndexOf(']', rangeOf(value)![1]);
        next = splice(text, at, at, separatorBefore(text, at) + flowItem(rule));
      } else {
        const last = value.items[value.items.length - 1];
        const at = lineInsertAt(text, rangeOf(last)![1]);
        const dashIndent = dashIndentOf(text, last) ?? indent + '  ';
        next = splice(text, at, at, NEWLINE + blockEntry(rule, dashIndent));
      }
    } else {
      const item = value.items[index];
      if (isScalar(item)) {
        // A bare destination is promoted to a mapping that carries its condition, in place:
        // the surrounding comments, quoting, and the entry's position are untouched.
        if (rule.when !== undefined) {
          const range = rangeOf(item)!;
          next = splice(text, range[0], range[1], flowItem(rule));
        } else {
          next = text;
        }
      } else if (!isMap(item)) {
        invalid('A transition entry must be a mapping or a bare destination.');
      } else {
      const existing = pairNamed(item, 'when');
      const itemFlow = (item as YAMLMap).flow === true;
      if (rule.when === undefined) {
        if (existing !== undefined) {
          const start = pairStart(existing);
          const end = rangeOf(existing.value)![1];
          if (itemFlow) {
            const span = flowPairRemoval(text, start, end);
            next = splice(text, span.start, span.end, '');
          } else {
            const from = lineStart(text, start);
            const to = lineInsertAt(text, end) + 1;
            // A condition that opens its sequence entry is removed with its line, but the
            // dash stays: it belongs to the entry, not to the key that is leaving.
            const dash = /^([ \t]*)-[ \t]*$/.exec(text.slice(from, start));
            next = splice(text, from, to, dash === null ? '' : dash[1] + '-' + NEWLINE);
          }
        } else {
          next = text;
        }
      } else if (existing !== undefined) {
        // A block scalar's body lies past its value range, so the whole node is replaced;
        // a plain scalar is replaced up to its own end.
        // The value range ends after a block scalar's body but before a comment that
        // follows a plain value, so only the value itself is replaced.
        const range = rangeOf(existing.value)!;
        const end = range[1];
        // A block scalar's node owns the newline that ends its last line, so the
        // replacement keeps one instead of joining the next entry onto this line.
        const kept = text.slice(range[0], end).endsWith(NEWLINE) ? NEWLINE : '';
        next = splice(text, range[0], end, authoredScalar(rule.when) + kept);
      } else {
        const target = pairNamed(item, 'to');
        if (target === undefined) invalid('A transition entry must name its destination.');
        if (itemFlow) {
          const at = rangeOf(target.value)![1];
          next = splice(text, at, at, ', when: ' + authoredScalar(rule.when));
        } else {
          // After the whole line, so a comment written beside the destination stays
          // attached to it instead of moving onto the condition line.
          const at = lineEnd(text, rangeOf(target.value)![1]);
          // The condition aligns with the destination key, which may sit after an
          // inline dash rather than at the line's own indentation.
          const conditionIndent = ' '.repeat(pairStart(target) - lineStart(text, pairStart(target)));
          next = splice(text, at, at, NEWLINE + conditionIndent + 'when: ' + authoredScalar(rule.when));
        }
        }
      }
    }
  }

  // The result is re-parsed before it is handed back, so a bad splice fails the
  // write instead of storing a document the parser would refuse.
  parse(next);
  return next;
}
