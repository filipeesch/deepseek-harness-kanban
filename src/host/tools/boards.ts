import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { KanbanApp } from '../app.js';
import type { BoardAdministration } from '../board-administration.js';
import { applyWorkflowEdits, type WorkflowTextEdit } from '../../domain/workflow-edit.js';
import { KanbanError, invariant } from '../../shared/errors.js';
import { actorOf, boardResult, digestRefusal, flag, normal, refusal, text, written } from './support.js';
import { assertBoardWriteAllowed, resolveBoard, type ToolArgs } from './scope.js';
import { revisionParameter, workflowWriteControls } from './authoring.js';

const intent = 'Use ONLY when the user explicitly requests this board change. ';

const reportNote = ' The result carries the digest of the exact document stored and a write report: the changed stages and their changed field names, the graph warnings, the board-level reviewed authorization of every deterministic stage, and the affected cards. The report is a summary by default and the per-field values only when detail is full. A refused write saves nothing and returns the same report instead of changing the board.';

/** One write result, with a digest refusal reported like any other refusal. */
function outcome(error: unknown): unknown {
  const refused = refusal(error);
  if (refused !== undefined) return refused;
  const digest = digestRefusal(error);
  if (digest !== undefined) return digest;
  throw error;
}

export function boardTools(app: KanbanApp, boards: BoardAdministration): ToolDefinition[] {
  return [
    normal('create_board', intent + 'Create a board in a Hub with the default workflow or a supplied complete workflow YAML. Use list_hubs to discover the Hub. The board is created in this installation only; publishing it to a team stays a manual action in the interface.' + reportNote, {
      hub_id: text('Hub ID. Optional when exactly one Hub exists.'),
      name: text('Board name.', true),
      workflow_yaml: text('Complete workflow YAML. Omit for the default workflow. A root model mapping with provider, model, and optional reasoning_effort names the board default model every new conversation of this board starts on, and a root agent_preset scalar names the agent preset they start on; omit either to keep the host default.'),
      ...workflowWriteControls,
    }, async (args, exec) => {
      await assertBoardWriteAllowed(app, exec);
      try {
        const value = await boards.createReviewed({
          ...(args.hub_id === undefined ? {} : { hubId: args.hub_id }),
          name: args.name,
          ...(args.workflow_yaml === undefined ? {} : { workflowYaml: args.workflow_yaml }),
          ...(args.expect_sha256 === undefined ? {} : { expectSha256: args.expect_sha256 }),
          ...(args.dry_run === true ? { dryRun: true } : {}),
          ...(args.detail === undefined ? {} : { detail: args.detail }),
          actor: actorOf(exec), origin: 'tool',
        }, 'never');
        return written(value);
      } catch (error) { return outcome(error); }
    }),
    normal('update_board', intent + 'Rename a board and/or replace its complete workflow YAML. Read the exact YAML with get_board_yaml first. Prefer edit_board_yaml or the stage tools for targeted changes. An omitted name keeps the board name; a supplied workflow replaces the whole document.' + reportNote, {
      board_id: text('Board ID.', true),
      hub_id: text('Hub ID. Optional when the board identifier is enough.'),
      name: text('Replacement board name.'),
      workflow_yaml: text('Complete replacement workflow YAML. Keep, add, or drop the root model mapping (provider, model, and optional reasoning_effort) and the root agent_preset scalar to set or clear the board default model and default agent preset; read the current ones from get_board_summary include_workflow as defaultModel and defaultAgentPreset, or as the root fields in get_board_yaml.'),
      expected_revision: revisionParameter,
      ...workflowWriteControls,
    }, async (args, exec) => {
      await assertBoardWriteAllowed(app, exec);
      const common = { board_id: args.board_id, ...(args.hub_id === undefined ? {} : { hub_id: args.hub_id }), ...(args.expected_revision === undefined ? {} : { expectedRevision: args.expected_revision }) };
      try {
        if (args.workflow_yaml === undefined) {
          if (args.name === undefined) throw new KanbanError('INVALID_EDIT', 'Provide a board name or a workflow YAML.');
          if (args.expect_sha256 !== undefined || args.dry_run === true || args.detail !== undefined) throw new KanbanError('INVALID_INPUT', 'The digest, dry review, and detail controls apply to a workflow document; provide workflow_yaml.');
          return boardResult(await boards.update({ boardId: common.board_id, ...(common.hub_id === undefined ? {} : { hubId: common.hub_id }), name: args.name, ...(common.expectedRevision === undefined ? {} : { expectedRevision: common.expectedRevision }) }, 'never'));
        }
        const value = await boards.saveWorkflowReviewed({
          boardId: common.board_id,
          ...(common.hub_id === undefined ? {} : { hubId: common.hub_id }),
          ...(args.name === undefined ? {} : { name: args.name }),
          compose: () => args.workflow_yaml!,
          replace: true,
          ...(args.expect_sha256 === undefined ? {} : { expectSha256: args.expect_sha256 }),
          ...(args.dry_run === true ? { dryRun: true } : {}),
          ...(args.detail === undefined ? {} : { detail: args.detail }),
          actor: actorOf(exec), origin: 'tool',
          ...(common.expectedRevision === undefined ? {} : { expectedRevision: common.expectedRevision }),
        }, 'never');
        return written(value);
      } catch (error) { return outcome(error); }
    }),
    normal('edit_board_yaml', intent + 'Apply literal old/new text edits to a board workflow YAML. Each old text must occur exactly once at apply time; all edits are applied together and the result is validated before saving. Read the exact YAML with get_board_yaml first and copy the text, including indentation and comments. An edit may name the stage and the authored field it targets, so the same text in two stages is unambiguous. A failure reports the failing edit index, the occurrence lines, and the closest authored line. The change is local; publishing it to a team stays a manual action in the interface.' + reportNote, {
      board_id: text('Board ID.', true),
      hub_id: text('Hub ID. Optional when the board identifier is enough.'),
      edits: {
        type: 'array', required: true,
        description: 'Literal replacements applied in order. Each old text must occur exactly once, inside the stage and field the edit names when it names one.',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            old: { type: 'string', required: true },
            new: { type: 'string', required: true },
            stage: { type: 'string', description: 'Stage ID the match must fall inside.' },
            field: { type: 'string', enum: ['on_enter_prompt', 'description', 'allowed_transitions', 'deterministic', 'block'], description: 'Authored field of the named stage the match must fall inside; block means the whole stage block.' },
          },
        },
      },
      expected_revision: revisionParameter,
      ...workflowWriteControls,
    }, async (args, exec) => {
      await assertBoardWriteAllowed(app, exec);
      try {
        const value = await boards.saveWorkflowReviewed({
          boardId: args.board_id,
          ...(args.hub_id === undefined ? {} : { hubId: args.hub_id }),
          compose: current => applyWorkflowEdits(current, args.edits as unknown as WorkflowTextEdit[]),
          ...(args.expect_sha256 === undefined ? {} : { expectSha256: args.expect_sha256 }),
          ...(args.dry_run === true ? { dryRun: true } : {}),
          ...(args.detail === undefined ? {} : { detail: args.detail }),
          actor: actorOf(exec), origin: 'tool',
          ...(args.expected_revision === undefined ? {} : { expectedRevision: args.expected_revision }),
        }, 'never');
        return written(value);
      } catch (error) { return outcome(error); }
    }),
    normal('delete_board', intent + 'Delete an empty board that is not shared with a team. Pass confirmed:true only after the user explicitly confirmed the deletion. A board bound to the team configuration is refused: removing it is a publishing decision the operator makes in the interface. Projects, worktrees, conversations, and native workspaces are kept.', {
      board_id: text('Board ID.', true),
      hub_id: text('Hub ID. Optional when the board identifier is enough.'),
      confirmed: { type: 'boolean', required: true, description: 'Explicit confirmation for this deletion.' },
      expected_revision: revisionParameter,
    }, async (args, exec) => {
      await assertBoardWriteAllowed(app, exec);
      const { board, hubId } = resolveBoard(app, args as ToolArgs, exec);
      invariant(!app.boardShared(hubId, board.id), 'BOARD_REMOVAL_REQUIRES_INTERFACE', 'This board is shared with the team. Remove it in the interface, where the local or team scope is a publishing decision.');
      const value = await boards.remove({ boardId: board.id, confirmed: args.confirmed, ...(args.hub_id === undefined ? {} : { hubId: args.hub_id }), ...(args.expected_revision === undefined ? {} : { expectedRevision: args.expected_revision }) }, 'never');
      return boardResult(value);
    }),
  ];
}
