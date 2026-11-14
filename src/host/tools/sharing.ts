import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { KanbanApp } from '../app.js';
import { parseWorkflow } from '../../domain/workflow.js';
import { diffWorkflow, isWorkflowDifferenceEmpty } from '../../domain/workflow-difference.js';
import { normal, text } from './support.js';
import { resolveBoard, type ToolArgs } from './scope.js';

/**
 * The read-only comparison between a board and the version of it this installation
 * last applied from the team.
 *
 * It answers the question publishing asks: what would the team see that this
 * installation does not, and the other way round. It never publishes, applies, or
 * changes anything.
 */
export function sharingTools(app: KanbanApp): ToolDefinition[] {
  return [
    normal('diff_published_board', 'Compare one board local workflow with the version of that board this installation last applied from team storage, and report the per-stage difference between them. Reading changes nothing: it publishes nothing, applies no team update, and does not change the board.', {
      board_id: text('Board ID.', true),
      hub_id: text('Hub ID. Optional when the board identifier is enough.'),
    }, async (args, exec) => {
      const { board, hubId } = resolveBoard(app, args as ToolArgs, exec);
      const published = app.publishedWorkflow(hubId, board.id);
      if (published === undefined) return { boardId: board.id, comparable: false as const, reason: 'no-published-version' as const };
      try {
        const difference = diffWorkflow(parseWorkflow(published), board.workflow);
        return { boardId: board.id, comparable: true as const, matches: isWorkflowDifferenceEmpty(difference), difference };
      } catch {
        return { boardId: board.id, comparable: false as const, reason: 'unreadable-published-document' as const };
      }
    }, true),
  ];
}
