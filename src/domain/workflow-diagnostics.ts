import { parseDocument } from 'yaml';
import { parseWorkflow, WORKFLOW_TEXT_LIMIT } from './workflow.js';
import { KanbanError } from '../shared/errors.js';

/** One problem with a workflow document, positioned when the parser located it. */
export interface WorkflowProblem {
  readonly message: string;
  /** One-based line of the problem, present only when the document does not parse. */
  readonly line?: number;
  /** One-based column of the problem, present only when the document does not parse. */
  readonly column?: number;
}

/**
 * Every problem a composed workflow document has, without throwing.
 *
 * Syntax problems come from the parser with their position; the semantic pass
 * runs only once the document parses, so a positioned problem is never buried
 * under a semantic one. The accepting parse path stays the authority on what a
 * saved document must satisfy; this function exists so a refused write can say
 * where the problem is instead of failing at the first one silently.
 */
export function workflowProblems(text: string): WorkflowProblem[] {
  if (typeof text !== 'string' || text.trim().length === 0) return [{ message: 'Workflow YAML must be nonempty text.' }];
  if (text.length > WORKFLOW_TEXT_LIMIT) return [{ message: 'Workflow YAML exceeds the one-megabyte limit.' }];
  let errors: readonly { message: string; linePos?: readonly { line: number; col: number }[] }[];
  try {
    // Pretty errors are what attach a line position; the accepting path does not need them.
    errors = parseDocument(text, { uniqueKeys: true, prettyErrors: true, version: '1.2' }).errors;
  } catch (error) {
    return [{ message: 'Invalid workflow YAML: ' + (error instanceof Error ? error.message : String(error)) }];
  }
  if (errors.length > 0) {
    return errors.map(error => {
      const position = error.linePos?.[0];
      const summary = error.message.split('\n')[0] ?? error.message;
      return { message: summary, ...(position === undefined ? {} : { line: position.line, column: position.col }) };
    });
  }
  try {
    parseWorkflow(text);
  } catch (error) {
    return [{ message: error instanceof KanbanError ? error.message : String(error) }];
  }
  return [];
}
