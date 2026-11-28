import { isMap, isSeq, parseDocument } from 'yaml';
import type { ModelSelection, WorkflowAgent } from '../shared/types.js';
import { KanbanError } from '../shared/errors.js';
import { authoredScalar, writeRootField, writeSequenceItemField } from './yaml-map-fields.js';
import { declaredAgents } from './agents.js';
import { parseWorkflow } from './workflow.js';

/** The authored root key that carries the board's agents. */
const AGENTS_KEY = 'agents';
const EFFORT_KEY = 'reasoning_effort';
const NEWLINE = String.fromCharCode(10);
const CARRIAGE_RETURN = String.fromCharCode(13);

type NodeRange = [number, number, number];

function invalid(message: string): never {
  throw new KanbanError('INVALID_WORKFLOW', message);
}

function lineStart(text: string, offset: number): number {
  return text.lastIndexOf(NEWLINE, offset - 1) + 1;
}

function afterLine(text: string, offset: number): number {
  const index = text.indexOf(NEWLINE, offset);
  return index < 0 ? text.length : index + 1;
}

/** The offset just past a node's value, whether or not its range already includes the newline. */
function valueEnd(text: string, offset: number): number {
  return offset > 0 && text[offset - 1] === NEWLINE ? offset : afterLine(text, offset);
}

/** The newline the document itself uses, so an inserted entry never mixes line endings. */
function documentNewline(text: string): string {
  return text.includes(CARRIAGE_RETURN + NEWLINE) ? CARRIAGE_RETURN + NEWLINE : NEWLINE;
}

/** The item's whole lines, from the line that holds its dash through its trailing newline. */
function itemRange(text: string, item: unknown): { start: number; end: number } {
  const range = (item as { range?: NodeRange }).range;
  if (range === undefined) return { start: 0, end: 0 };
  return { start: lineStart(text, range[0]), end: valueEnd(text, range[1]) };
}

/** The root `agents` key with its raw node ranges, when the document authors one. */
function agentsPair(document: { contents?: unknown } | null): { key: NodeRange; value: NodeRange } | null {
  const contents = document?.contents as { items?: unknown[] } | null | undefined;
  if (contents?.items === undefined) return null;
  for (const pair of contents.items) {
    const key = (pair as { key?: { value?: unknown; range?: NodeRange } }).key;
    if (key?.value !== AGENTS_KEY) continue;
    const value = (pair as { value?: { range?: NodeRange } }).value;
    if (key.range === undefined || value?.range === undefined) return null;
    return { key: key.range, value: value.range };
  }
  return null;
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

/** The column of the dash that starts one authored block sequence entry. */
function dashColumnOf(text: string, sequence: unknown): number {
  const first = (sequence as { items?: unknown[] }).items?.[0];
  const range = (first as { range?: NodeRange } | undefined)?.range;
  if (range === undefined) return 2;
  const prefix = text.slice(lineStart(text, range[0]), range[0]);
  const dash = prefix.lastIndexOf('-');
  return dash < 0 ? prefix.length : dash;
}

/** One agent entry as authored block lines, its dash at the given column. */
function agentLines(agent: WorkflowAgent, dashColumn: number, newline: string): string {
  const dashIndent = ' '.repeat(dashColumn);
  const field = dashIndent + '  ';
  const lines = [dashIndent + '- id: ' + authoredScalar(agent.id), field + 'name: ' + authoredScalar(agent.name)];
  if (agent.preset !== undefined) lines.push(field + 'preset: ' + authoredScalar(agent.preset));
  if (agent.model !== undefined) {
    lines.push(field + 'model:');
    lines.push(field + '  provider: ' + authoredScalar(agent.model.provider));
    lines.push(field + '  model: ' + authoredScalar(agent.model.model));
    if (agent.model.reasoningEffort !== undefined) lines.push(field + '  ' + EFFORT_KEY + ': ' + authoredScalar(agent.model.reasoningEffort));
  }
  return lines.join(newline);
}

/** One agent entry in flow style, for a flow sequence or a flow root. */
function flowEntry(agent: WorkflowAgent): string {
  const pairs = ['id: ' + authoredScalar(agent.id), 'name: ' + authoredScalar(agent.name)];
  if (agent.preset !== undefined) pairs.push('preset: ' + authoredScalar(agent.preset));
  if (agent.model !== undefined) {
    const model = ['provider: ' + authoredScalar(agent.model.provider), 'model: ' + authoredScalar(agent.model.model)];
    if (agent.model.reasoningEffort !== undefined) model.push(EFFORT_KEY + ': ' + authoredScalar(agent.model.reasoningEffort));
    pairs.push('model: {' + model.join(', ') + '}');
  }
  return '{' + pairs.join(', ') + '}';
}

/** The whole section, for a document that authors it in one flow mapping or not at all. */
function flowAgents(agents: readonly WorkflowAgent[]): string {
  return AGENTS_KEY + ': [' + agents.map(flowEntry).join(', ') + ']';
}

/** Render the authored agents section, or null to remove it. */
function agentsField(agents: readonly WorkflowAgent[] | undefined, indent: string, flow: boolean): string | null {
  if (agents === undefined || agents.length === 0) return null;
  if (flow) return flowAgents(agents);
  return [AGENTS_KEY + ':', ...agents.flatMap(agent => agentLines(agent, indent.length + 2, NEWLINE).split(NEWLINE))].join(NEWLINE);
}

/**
 * Write or clear the board's agents in an authored workflow document. The section is
 * rewritten as a block of text, so comments, key order, quoting, and every other
 * authored character outside it survive. Passing an empty list removes the section.
 * The result is parsed before it is returned, so a caller can never persist a document
 * the board would refuse.
 */
export function writeBoardAgentsField(text: string, agents: readonly WorkflowAgent[] | undefined): string {
  const next = writeRootField({
    text,
    fieldKeys: [AGENTS_KEY],
    render: (_existing, indent, _key, flow) => agentsField(agents, indent, flow),
    invalid,
  });
  parseWorkflow(next);
  return next;
}

/**
 * The end of a root key's own lines. A comment that follows the value on the same
 * line survives, because the author wrote it for the document; everything else on
 * the key's lines belongs to the field and goes with it.
 */
function keyEnd(text: string, valueEndOffset: number): number {
  const lineStop = Math.min(text.length, afterLine(text, valueEndOffset));
  const tailStop = lineStop > 0 && text[lineStop - 1] === NEWLINE ? lineStop - 1 : lineStop;
  return text.slice(valueEndOffset, tailStop).trim().length === 0 ? lineStop : valueEndOffset;
}

/** One entry of a block sequence, replaced in place. */
function replaceBlockEntry(text: string, sequence: unknown, agent: WorkflowAgent): string | undefined {
  const items = (sequence as { items: unknown[] }).items;
  const newline = documentNewline(text);
  const dashColumn = dashColumnOf(text, sequence);
  for (const item of items) {
    if (!isMap(item) || item.get('id') !== agent.id) continue;
    const range = itemRange(text, item);
    return text.slice(0, range.start) + agentLines(agent, dashColumn, newline) + newline + text.slice(range.end);
  }
  return undefined;
}

/** One entry of a flow sequence, replaced in place. */
function replaceFlowEntry(text: string, sequence: unknown, agent: WorkflowAgent): string | undefined {
  for (const item of (sequence as { items: unknown[] }).items) {
    if (!isMap(item) || item.get('id') !== agent.id) continue;
    const range = (item as { range?: NodeRange }).range;
    if (range === undefined) return undefined;
    return text.slice(0, range[0]) + flowEntry(agent) + text.slice(range[1]);
  }
  return undefined;
}

/** Remove the whole agents key, taking one adjacent separator with it. */
function removeAgentsKey(text: string, document: { contents?: unknown }, pair: { key: NodeRange; value: NodeRange }): string {
  const contents = document.contents as { items?: unknown[]; flow?: boolean } | null;
  if (contents?.flow !== true) {
    const start = lineStart(text, pair.key[0]);
    const end = keyEnd(text, pair.value[1]);
    return text.slice(0, start) + text.slice(end);
  }
  const items = contents.items ?? [];
  const index = items.findIndex(item => (item as { key?: { range?: NodeRange } }).key?.range?.[0] === pair.key[0]);
  const following = index >= 0 ? items[index + 1] as { key?: { range?: NodeRange } } | undefined : undefined;
  const preceding = index > 0 ? items[index - 1] as { value?: { range?: NodeRange } } | undefined : undefined;
  if (following?.key?.range !== undefined) return text.slice(0, pair.key[0]) + text.slice(following.key.range[0]);
  if (preceding?.value?.range !== undefined) return text.slice(0, preceding.value.range[1]) + text.slice(pair.value[1]);
  return text.slice(0, pair.key[0]) + text.slice(pair.value[1]);
}

/** Remove one entry of a flow sequence, keeping the separators the others need. */
function removeFlowEntry(text: string, document: { contents?: unknown }, sequence: unknown, pair: { key: NodeRange; value: NodeRange }, agentId: string): string | undefined {
  const items = (sequence as { items: unknown[] }).items;
  const index = items.findIndex(item => isMap(item) && item.get('id') === agentId);
  if (index === -1) return undefined;
  if (items.length === 1) return removeAgentsKey(text, document, pair);
  const range = (items[index] as { range?: NodeRange }).range;
  if (range === undefined) return undefined;
  // Prefer the separator before the entry, so the entry after it keeps its layout.
  let before = range[0];
  while (before > 0 && /[ \t\r\n]/.test(text[before - 1]!)) before -= 1;
  if (text[before - 1] === ',') return text.slice(0, before - 1) + text.slice(range[1]);
  // The entry is first: it goes with the separator that follows it. Whitespace the
  // next token needs is kept, and a comment between the entries survives.
  let after = range[1];
  while (after < text.length && (text[after] === ' ' || text[after] === '\t')) after += 1;
  if (text[after] !== ',') return text.slice(0, range[0]) + text.slice(range[1]);
  after += 1;
  let probe = after;
  while (probe < text.length && (text[probe] === ' ' || text[probe] === '\t')) probe += 1;
  // A comment keeps the space that separates it from the list opener.
  if (text[probe] === '#') return text.slice(0, range[0]) + text.slice(after);
  const newline = text.startsWith(CARRIAGE_RETURN + NEWLINE, probe) ? CARRIAGE_RETURN + NEWLINE : (text[probe] === NEWLINE ? NEWLINE : undefined);
  if (newline !== undefined) {
    after = probe + newline.length;
    // A comment on the next line keeps its own indentation; an entry does not.
    let indent = after;
    while (indent < text.length && (text[indent] === ' ' || text[indent] === '\t')) indent += 1;
    after = text[indent] === '#' ? after : indent;
  } else {
    after = probe;
  }
  return text.slice(0, range[0]) + text.slice(after);
}

/** Remove one entry of a block sequence, or the whole key with its last entry. */
function removeBlockEntry(text: string, document: { contents?: unknown }, sequence: unknown, pair: { key: NodeRange; value: NodeRange }, agentId: string): string | undefined {
  const items = (sequence as { items: unknown[] }).items;
  const found = items.find(item => isMap(item) && item.get('id') === agentId);
  if (found === undefined) return undefined;
  if (items.length === 1) return removeAgentsKey(text, document, pair);
  const range = itemRange(text, found);
  return text.slice(0, range.start) + text.slice(range.end);
}

/**
 * Write or replace one agent entry without re-emitting any other entry of the
 * authored list, so comments and formatting on the agents it does not name survive
 * even when another entry changes. The block and flow forms are both patched entry
 * by entry; only a document with no section at all is written whole, which touches
 * no other agent.
 */
export function writeAgentEntry(text: string, agent: WorkflowAgent): string {
  const document = documentOf(text);
  const pair = agentsPair(document);
  const appended = (): string => writeBoardAgentsField(text, [...declaredAgents(parseWorkflow(text)).filter(entry => entry.id !== agent.id), agent]);
  if (pair === null) return appended();
  const sequence = document.getIn([AGENTS_KEY]);
  if (!isSeq(sequence)) return appended();
  const newline = documentNewline(text);
  let next: string | undefined;
  if (sequence.flow === true) {
    next = replaceFlowEntry(text, sequence, agent);
    if (next === undefined) {
      const items = sequence.items;
      if (items.length === 0) {
        const range = (sequence as { range?: NodeRange }).range;
        if (range === undefined) invalid('The authored agents list has no position.');
        const close = range[1] - 1;
        if (text[close] !== ']') invalid('The authored agents list is not a flow sequence.');
        next = text.slice(0, close) + flowEntry(agent) + text.slice(close);
      } else {
        const end = (items.at(-1) as { range?: NodeRange }).range?.[1];
        if (end === undefined) invalid('The authored agents list has no position.');
        next = text.slice(0, end) + ', ' + flowEntry(agent) + text.slice(end);
      }
    }
  } else {
    next = replaceBlockEntry(text, sequence, agent);
    if (next === undefined) {
      const items = (sequence as { items: unknown[] }).items;
      const last = items.at(-1);
      const end = last === undefined ? undefined : itemRange(text, last).end;
      if (end === undefined) return appended();
      next = text.slice(0, end) + agentLines(agent, dashColumnOf(text, sequence), newline) + newline + text.slice(end);
    }
  }
  parseWorkflow(next);
  return next;
}

/**
 * Remove one agent entry from the authored document, keeping every other entry
 * exactly as written. The whole section goes with the last entry it carried.
 */
export function removeAgentEntry(text: string, agentId: string): string {
  const document = documentOf(text);
  const pair = agentsPair(document);
  const remaining = (): WorkflowAgent[] => declaredAgents(parseWorkflow(text)).filter(entry => entry.id !== agentId);
  if (pair === null) return writeBoardAgentsField(text, remaining());
  const sequence = document.getIn([AGENTS_KEY]);
  if (!isSeq(sequence)) return writeBoardAgentsField(text, remaining());
  const next = sequence.flow === true
    ? removeFlowEntry(text, document, sequence, pair, agentId)
    : removeBlockEntry(text, document, sequence, pair, agentId);
  if (next === undefined) return writeBoardAgentsField(text, remaining());
  parseWorkflow(next);
  return next;
}

/**
 * Write or clear the agent one stage names, preserving every other authored
 * character of the document and of the stage.
 */
export function writeStageAgentField(text: string, stageId: string, agent: string | undefined): string {
  const next = writeSequenceItemField({
    text,
    sequenceKey: 'columns',
    idKey: 'id',
    id: stageId,
    fieldKeys: ['agent'],
    render: () => (agent === undefined ? null : 'agent: ' + authoredScalar(agent)),
    invalid,
  });
  parseWorkflow(next);
  return next;
}

/** The model a tool call describes, when it names one. */
export function agentModel(provider: unknown, model: unknown, reasoningEffort: unknown): ModelSelection | undefined {
  const hasProvider = typeof provider === 'string' && provider.trim() !== '';
  const hasModel = typeof model === 'string' && model.trim() !== '';
  if (!hasProvider && !hasModel) return undefined;
  if (!hasProvider || !hasModel) throw new KanbanError('INVALID_INPUT', 'A model route requires both a provider and a model.');
  return {
    provider: (provider as string).trim(),
    model: (model as string).trim(),
    ...(typeof reasoningEffort === 'string' && reasoningEffort.trim() !== '' ? { reasoningEffort: reasoningEffort.trim() } : {}),
  };
}
