import { workflowContent } from './schema-parts.js';
import { parseWorkflow } from './workflow.js';

/**
 * Whether two authored texts carry the same workflow content. The comparison keeps the
 * meaning and the diagram layout and excludes the authored stage-identity lines, because
 * a publish matches identities instead of publishing them, so a text that differs only in
 * those lines changes nothing. An unreadable text cannot establish sameness.
 */
export function sameWorkflowContent(left: string, right: string): boolean {
  if (left === right) return true;
  try {
    return workflowContent(parseWorkflow(left)) === workflowContent(parseWorkflow(right));
  } catch {
    return false;
  }
}
