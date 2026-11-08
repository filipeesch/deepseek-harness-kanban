import { KanbanError, invariant } from '../shared/errors.js';

/** One literal replacement inside a board's authored workflow YAML. */
export interface WorkflowTextEdit {
  /** Exact text that must occur exactly once at the time this edit is applied. */
  old: string;
  /** Replacement text; the empty string removes the matched text. */
  new: string;
}

function occurrences(value: string, search: string): number {
  let count = 0;
  let index = value.indexOf(search);
  while (index >= 0) {
    count += 1;
    index = value.indexOf(search, index + search.length);
  }
  return count;
}

/**
 * Apply literal edits to authored workflow YAML, preserving everything outside
 * the replaced spans. Edits run in order, so each `old` is matched against the
 * text produced by the previous edit. A missing or repeated match rejects the
 * whole collection; the caller decides whether to retry with more context.
 */
export function applyWorkflowEdits(text: string, edits: readonly WorkflowTextEdit[]): string {
  invariant(typeof text === 'string', 'INVALID_INPUT', 'Workflow YAML must be text.');
  invariant(Array.isArray(edits) && edits.length > 0, 'INVALID_INPUT', 'Provide at least one workflow edit.');
  let value = text;
  for (const edit of edits) {
    invariant(edit !== null && typeof edit === 'object' && !Array.isArray(edit), 'INVALID_INPUT', 'Each workflow edit must be a mapping.');
    invariant(typeof edit.old === 'string' && edit.old.length > 0, 'INVALID_INPUT', 'Each workflow edit requires nonempty old text.');
    invariant(typeof edit.new === 'string', 'INVALID_INPUT', 'Each workflow edit requires new text.');
    const at = value.indexOf(edit.old);
    if (at < 0) {
      throw new KanbanError('WORKFLOW_EDIT_NOT_FOUND', 'The old text was not found in the current workflow YAML. Read the workflow again and copy the exact text.', { occurrences: 0 });
    }
    const found = occurrences(value, edit.old);
    if (found !== 1) {
      throw new KanbanError('WORKFLOW_EDIT_AMBIGUOUS', 'The old text occurs ' + found + ' times in the current workflow YAML. Include more surrounding text.', { occurrences: found });
    }
    value = value.slice(0, at) + edit.new + value.slice(at + edit.old.length);
  }
  return value;
}
