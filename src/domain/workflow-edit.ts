import { sequenceItemSpan } from './journal/authored-text.js';
import { KanbanError, invariant } from '../shared/errors.js';

/** The authored fields of a stage an edit may scope its match to. */
export const WORKFLOW_EDIT_FIELDS = ['on_enter_prompt', 'description', 'allowed_transitions', 'deterministic', 'block'] as const;
export type WorkflowEditField = (typeof WORKFLOW_EDIT_FIELDS)[number];

/** One literal replacement inside a board's authored workflow YAML. */
export interface WorkflowTextEdit {
  /** Exact text that must occur exactly once at the time this edit is applied. */
  old: string;
  /** Replacement text; the empty string removes the matched text. */
  new: string;
  /** Restrict the match to this stage's authored block. */
  stage?: string;
  /** Restrict the match further to this authored field of the stage. */
  field?: WorkflowEditField;
}

/** What one failed edit can tell its caller. */
export interface WorkflowEditFailure {
  /** Zero-based position of the edit in the call. */
  readonly index: number;
  readonly occurrences: number;
  /** One-based line numbers of every occurrence, or of the closest line when none matched. */
  readonly lineNumbers: readonly number[];
  /** The stage each occurrence falls inside, when the text is block-style authored. */
  readonly stages?: readonly (string | undefined)[];
  /** The authored line nearest a missing match, trimmed and bounded, with the first column that differs. */
  readonly closest?: { readonly line: number; readonly text: string; readonly column?: number };
  readonly scope?: { readonly stage?: string; readonly field?: WorkflowEditField };
}

/** How many characters of a near match are quoted back. */
const CLOSEST_LIMIT = 200;

interface Span { readonly start: number; readonly end: number }

/** Every offset of one search string inside a value, without overlapping matches. */
function offsetsOf(value: string, search: string): number[] {
  const found: number[] = [];
  let index = value.indexOf(search);
  while (index >= 0) {
    found.push(index);
    index = value.indexOf(search, index + search.length);
  }
  return found;
}

/** One-based line number of an absolute offset. */
function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < text.length; index += 1) if (text[index] === '\n') line += 1;
  return line;
}

/** The stage a line belongs to, read from the last authored stage dash before it. */
function stageAt(text: string, offset: number): string | undefined {
  const before = text.slice(0, offset);
  let found: string | undefined;
  const pattern = /^[ \t]*-[ \t]+id:[ \t]*([^\s#]+)/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(before)) !== null) found = match[1];
  return found;
}

/** The authored field span inside one stage block, from its key line to the next same-level key. */
function fieldSpan(block: string, field: string): Span | undefined {
  const lines = block.split('\n');
  // The stage's keys share the column where its id starts; a line indented further is
  // inside a block scalar or a nested mapping, never a key of the stage itself.
  const dash = /^([ \t]*-[ \t]+)id:/.exec(lines[0] ?? '');
  const keyIndent = dash === null ? undefined : dash[1]!.length;
  let offset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const match = /^([ \t]*)([A-Za-z_][A-Za-z0-9_]*):/.exec(line);
    if (match !== null && match[2] === field && (keyIndent === undefined || match[1]!.length === keyIndent)) {
      const indent = match[1]!.length;
      let end = offset + line.length;
      let cursor = offset + line.length + 1;
      for (let next = index + 1; next < lines.length; next += 1) {
        const candidate = lines[next]!;
        const indentation = /^[ \t]*/.exec(candidate)![0].length;
        if (candidate.trim().length === 0) { cursor += candidate.length + 1; continue; }
        if (indentation <= indent) break;
        end = cursor + candidate.length;
        cursor += candidate.length + 1;
      }
      return { start: offset, end };
    }
    offset += line.length + 1;
  }
  return undefined;
}

/** The longest run of characters two strings share, without a quadratic blowup on long lines. */
function sharedRun(left: string, right: string): number {
  const limit = Math.min(64, left.length, right.length);
  let best = 0;
  for (let start = 0; start < right.length && best < limit; start += 1) {
    let length = 0;
    while (length < limit && start + length < right.length && left[length] === right[start + length]) length += 1;
    if (length > best) best = length;
  }
  return best;
}

/** The first column where a line differs from the wanted text, one-based. */
function firstDifference(line: string, wanted: string): number {
  let index = 0;
  while (index < line.length && index < wanted.length && line[index] === wanted[index]) index += 1;
  return index + 1;
}

/** The authored line closest to a search string, chosen by the longest shared run. */
function closestLine(text: string, from: number, to: number, search: string): { line: number; text: string; column?: number } | undefined {
  // Whitespace is not the difference a caller is looking for: compare trimmed text and
  // report the column of the first differing character of the trimmed line.
  const wanted = search.split('\n')[0]!.trim();
  const lines = text.slice(from, to).split('\n');
  let best: { line: number; text: string; column?: number } | undefined;
  let bestScore = -1;
  let offset = from;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      const score = sharedRun(trimmed, wanted);
      if (score > bestScore) {
        bestScore = score;
        best = {
          line: lineAt(text, offset),
          text: trimmed.length > CLOSEST_LIMIT ? trimmed.slice(0, CLOSEST_LIMIT) + '…' : trimmed,
          column: firstDifference(trimmed, wanted),
        };
      }
    }
    offset += line.length + 1;
  }
  return best;
}

function scopeOf(text: string, edit: WorkflowTextEdit): Span & { stage?: string } {
  if (edit.stage === undefined) return { start: 0, end: text.length };
  const stage = sequenceItemSpan({ text, sequenceKey: 'columns', fields: { id: edit.stage } });
  invariant(stage !== undefined, 'STAGE_NOT_FOUND', 'The workflow has no stage ' + edit.stage + '.');
  const block = text.slice(stage.start, stage.end);
  if (edit.field === undefined || edit.field === 'block') return { start: stage.start, end: stage.end, stage: edit.stage };
  const field = fieldSpan(block, edit.field);
  if (field === undefined) {
    throw new KanbanError('WORKFLOW_EDIT_NOT_FOUND', 'Stage ' + edit.stage + ' authors no ' + edit.field + ' field.', {
      index: -1, occurrences: 0, lineNumbers: [], scope: { stage: edit.stage, field: edit.field },
    });
  }
  return { start: stage.start + field.start, end: stage.start + field.end, stage: edit.stage };
}

/**
 * Apply literal edits to authored workflow YAML, preserving everything outside
 * the replaced spans. Edits run in order, so each `old` is matched against the
 * text produced by the previous edit. An edit may name the stage and the authored
 * field it targets, so the same text in two stages is unambiguous.
 *
 * A missing or repeated match rejects the whole collection and reports which edit
 * failed, where its occurrences are, and what the closest authored line says, so a
 * caller can correct the call without guessing.
 */
export function applyWorkflowEdits(text: string, edits: readonly WorkflowTextEdit[]): string {
  invariant(typeof text === 'string', 'INVALID_INPUT', 'Workflow YAML must be text.');
  invariant(Array.isArray(edits) && edits.length > 0, 'INVALID_INPUT', 'Provide at least one workflow edit.');
  let value = text;
  for (const [index, edit] of edits.entries()) {
    invariant(edit !== null && typeof edit === 'object' && !Array.isArray(edit), 'INVALID_INPUT', 'Each workflow edit must be a mapping.');
    invariant(typeof edit.old === 'string' && edit.old.length > 0, 'INVALID_INPUT', 'Each workflow edit requires nonempty old text.');
    invariant(typeof edit.new === 'string', 'INVALID_INPUT', 'Each workflow edit requires new text.');
    invariant(edit.field === undefined || (WORKFLOW_EDIT_FIELDS as readonly string[]).includes(edit.field), 'INVALID_INPUT', 'Each workflow edit field must be one of ' + WORKFLOW_EDIT_FIELDS.join(', ') + '.');
    let scope: Span & { stage?: string };
    try { scope = scopeOf(value, edit); }
    catch (error) {
      if (!(error instanceof KanbanError)) throw error;
      // Every scoped failure names the edit it belongs to, including an unknown stage.
      throw new KanbanError(error.code, error.message, { occurrences: 0, lineNumbers: [], ...error.details, index });
    }
    const segment = value.slice(scope.start, scope.end);
    const found = offsetsOf(segment, edit.old);
    const scopeDetail = edit.stage === undefined && edit.field === undefined
      ? {}
      : { scope: { ...(edit.stage === undefined ? {} : { stage: edit.stage }), ...(edit.field === undefined ? {} : { field: edit.field }) } };
    if (found.length === 0) {
      const closest = closestLine(value, scope.start, scope.end, edit.old);
      throw new KanbanError('WORKFLOW_EDIT_NOT_FOUND', 'Edit ' + (index + 1) + ' of ' + edits.length + ' was not found in the current workflow YAML. Read the workflow again and copy the exact text.', {
        index, occurrences: 0, lineNumbers: [], ...(closest === undefined ? {} : { closest }), ...scopeDetail,
      });
    }
    if (found.length !== 1) {
      const absolute = found.map(offset => offset + scope.start);
      throw new KanbanError('WORKFLOW_EDIT_AMBIGUOUS', 'Edit ' + (index + 1) + ' of ' + edits.length + ' occurs ' + found.length + ' times in the current workflow YAML. Include more surrounding text or name the stage.', {
        index, occurrences: found.length,
        lineNumbers: absolute.map(offset => lineAt(value, offset)),
        stages: absolute.map(offset => stageAt(value, offset)),
        ...scopeDetail,
      });
    }
    const at = found[0]! + scope.start;
    value = value.slice(0, at) + edit.new + value.slice(at + edit.old.length);
  }
  return value;
}
