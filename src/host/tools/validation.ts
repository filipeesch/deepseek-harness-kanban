import { createHash } from 'node:crypto';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import { reviewWorkflowText } from '../../domain/workflow-report.js';
import { workflowStageSizes } from '../../domain/workflow-size.js';
import { normal, text } from './support.js';

/**
 * Review one supplied workflow document without a board and without saving it.
 *
 * It runs the same review a write runs, so a proposal cannot pass here and fail
 * there. Nothing is stored, no board is read, and no task is touched.
 */
export function validationTools(): ToolDefinition[] {
  return [
    normal('validate_workflow', 'Review a workflow document exactly as a board write would, without saving anything and without a board: the parse problems with their line and column, the graph warnings the document would produce, and each stage instruction and script size. Reading changes nothing.', {
      yaml: text('The complete workflow document to review.', true),
    }, async (args) => {
      const sha256 = createHash('sha256').update(args.yaml, 'utf8').digest('hex');
      const review = reviewWorkflowText({ text: args.yaml, previousText: null, cards: [] });
      if (!review.valid) return { valid: false, sha256, problems: review.problems, warnings: [], warningsOmitted: 0, sizes: [] };
      return {
        valid: true, sha256, problems: [],
        warnings: review.warnings,
        warningsOmitted: 0,
        sizes: review.workflow === null ? [] : workflowStageSizes(review.workflow),
      };
    }, true),
  ];
}
