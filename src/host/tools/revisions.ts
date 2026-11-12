import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { KanbanApp } from '../app.js';
import type { BoardRevisions } from '../revisions.js';
import type { WorkflowAuthoringPort } from './authoring.js';
import { parseWorkflow } from '../../domain/workflow.js';
import { diffWorkflow } from '../../domain/workflow-difference.js';
import { KanbanError, invariant } from '../../shared/errors.js';
import { actorOf, flag, normal, refusal, text, written } from './support.js';
import { assertBoardWriteAllowed, resolveBoard, type ToolArgs } from './scope.js';

const reportNote = ' The result carries the write report: the per-stage difference, the graph warnings, the reviewed authorization of every deterministic stage in each allowed project, and the affected cards. A refused write saves nothing and returns the same report.';

function requireRevisions(revisions: BoardRevisions | undefined): BoardRevisions {
  invariant(revisions !== undefined, 'REVISIONS_UNAVAILABLE', 'This host does not keep a local board revision log.');
  return revisions;
}

/** The revision history tools: listing, comparing, and restoring an earlier document. */
export function revisionTools(app: KanbanApp, revisions: BoardRevisions | undefined, authoring: WorkflowAuthoringPort): ToolDefinition[] {
  return [
    normal('list_board_revisions', 'List the local revisions of one board workflow, newest first, with the moment, author, origin, and summary of each. A revision is one accepted write. The result never carries the workflow document; read a revision\'s document with diff_board_revisions or restore it with revert_board.', {
      board_id: text('Board ID.', true),
      limit: { type: 'integer', description: 'How many revisions to return. Defaults to 20.' },
      before: { type: 'integer', description: 'Continue with revisions older than this one, as a previous page reported.' },
      hub_id: text('Hub ID. Optional when the board identifier is enough.'),
    }, async (args, exec) => {
      const port = requireRevisions(revisions);
      const { board } = resolveBoard(app, args as ToolArgs, exec);
      return { boardId: board.id, ...(await port.list(board.id, { ...(args.limit === undefined ? {} : { limit: args.limit }), ...(args.before === undefined ? {} : { before: args.before }) })) };
    }, true),

    normal('diff_board_revisions', 'Compare two retained revisions of one board workflow and report the semantic difference by stage, group, and connection. Reading changes nothing.', {
      board_id: text('Board ID.', true),
      from: { type: 'integer', required: true, description: 'The revision the comparison starts from, as list_board_revisions reported it.' },
      to: { type: 'integer', required: true, description: 'The revision the comparison ends at.' },
      hub_id: text('Hub ID. Optional when the board identifier is enough.'),
    }, async (args, exec) => {
      const port = requireRevisions(revisions);
      const { board } = resolveBoard(app, args as ToolArgs, exec);
      const fromText = await port.textAt(board.id, args.from);
      const toText = await port.textAt(board.id, args.to);
      invariant(fromText !== undefined && toText !== undefined, 'REVISION_NOT_RETAINED', 'The board no longer retains one of those revisions.');
      return { boardId: board.id, from: args.from, to: args.to, difference: diffWorkflow(parseWorkflow(fromText), parseWorkflow(toText)) };
    }, true),

    normal('revert_board', 'Restore one board workflow to the document a retained revision holds, saving it as a new revision through the same validated write path.' + reportNote + ' Pass confirmed true only after the user explicitly confirmed the restore.', {
      board_id: text('Board ID.', true),
      to_revision: { type: 'integer', required: true, description: 'The revision to restore, as list_board_revisions reported it.' },
      confirmed: flag('Explicit confirmation of the restore; it is refused without it.'),
      expected_revision: { type: 'integer', required: true, description: 'Hub revision the caller observed; a stale value is rejected.' },
      hub_id: text('Hub ID. Optional when the board identifier is enough.'),
    }, async (args, exec) => {
      await assertBoardWriteAllowed(app, exec);
      const port = requireRevisions(revisions);
      invariant(args.confirmed === true, 'CONFIRMATION_REQUIRED', 'Confirm restoring the board to that revision.');
      const { board } = resolveBoard(app, args as ToolArgs, exec);
      const target = await port.textAt(board.id, args.to_revision);
      invariant(target !== undefined, 'REVISION_NOT_RETAINED', 'The board no longer retains revision ' + args.to_revision + '.');
      try {
        const value = await authoring.saveWorkflowReviewed({ boardId: board.id, ...(args.hub_id === undefined ? {} : { hubId: args.hub_id }), expectedRevision: args.expected_revision, actor: actorOf(exec), origin: 'tool', compose: () => target });
        return written(value);
      } catch (error) {
        const refused = refusal(error);
        if (refused !== undefined) return refused;
        throw error;
      }
    }),
  ];
}

/** The error a caller sees when a revision cannot be read because nothing keeps history. */
export function revisionsUnavailable(): KanbanError {
  return new KanbanError('REVISIONS_UNAVAILABLE', 'This host does not keep a local board revision log.');
}
