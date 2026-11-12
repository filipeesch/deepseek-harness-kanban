import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { KanbanApp } from '../app.js';
import type { BoardAdministration } from '../board-administration.js';
import { applyWorkflowEdits } from '../../domain/workflow-edit.js';
import { KanbanError } from '../../shared/errors.js';
import { actorOf, boardResult, normal, refusal, text, written } from './support.js';
import { assertBoardWriteAllowed } from './scope.js';

const intent = 'Use ONLY when the user explicitly requests this board change. ';

const reportNote = ' The result carries the write report: the per-stage difference, the graph warnings, the reviewed authorization of every deterministic stage in each allowed project, and the affected cards. A refused write saves nothing and returns the same report instead of changing the board.';

export function boardTools(app: KanbanApp, boards: BoardAdministration): ToolDefinition[] {
  return [
    normal('create_board', intent + 'Create a board in a Hub with the default workflow or a supplied complete workflow YAML. Use list_hubs to discover the Hub. A bound Hub publishes the change automatically.' + reportNote, {
      hub_id: text('Hub ID. Optional when exactly one Hub exists.'),
      name: text('Board name.', true),
      workflow_yaml: text('Complete workflow YAML. Omit for the default workflow. A root model mapping with provider, model, and optional reasoning_effort names the board default model every new conversation of this board starts on; omit it to keep the DSH default.'),
    }, async (args, exec) => {
      await assertBoardWriteAllowed(app, exec);
      try {
        const value = await boards.createReviewed({ ...(args.hub_id === undefined ? {} : { hubId: args.hub_id }), name: args.name, ...(args.workflow_yaml === undefined ? {} : { workflowYaml: args.workflow_yaml }), actor: actorOf(exec), origin: 'tool' }, 'when-bound');
        return written(value);
      } catch (error) {
        const refused = refusal(error);
        if (refused !== undefined) return refused;
        throw error;
      }
    }),
    normal('update_board', intent + 'Rename a board and/or replace its complete workflow YAML. Read the exact YAML with get_board_yaml first. Prefer edit_board_yaml or the stage tools for targeted changes. An omitted name keeps the board name; a supplied workflow replaces the whole document.' + reportNote, {
      board_id: text('Board ID.', true),
      hub_id: text('Hub ID. Optional when the board identifier is enough.'),
      name: text('Replacement board name.'),
      workflow_yaml: text('Complete replacement workflow YAML. Keep, add, or drop the root model mapping (provider, model, and optional reasoning_effort) to set or clear the board default model; read the current one from get_board_summary include_workflow as defaultModel, or as the root mapping in get_board_yaml.'),
      expected_revision: { type: 'integer', description: 'Hub revision from a prior read; stale values are rejected.' },
    }, async (args, exec) => {
      await assertBoardWriteAllowed(app, exec);
      const common = { board_id: args.board_id, ...(args.hub_id === undefined ? {} : { hub_id: args.hub_id }), ...(args.expected_revision === undefined ? {} : { expectedRevision: args.expected_revision }) };
      try {
        if (args.workflow_yaml === undefined) {
          if (args.name === undefined) throw new KanbanError('INVALID_EDIT', 'Provide a board name or a workflow YAML.');
          return boardResult(await boards.update({ boardId: common.board_id, ...(common.hub_id === undefined ? {} : { hubId: common.hub_id }), name: args.name, ...(common.expectedRevision === undefined ? {} : { expectedRevision: common.expectedRevision }) }, 'when-bound'));
        }
        const value = await boards.saveWorkflowReviewed({ boardId: common.board_id, ...(common.hub_id === undefined ? {} : { hubId: common.hub_id }), ...(args.name === undefined ? {} : { name: args.name }), compose: () => args.workflow_yaml!, actor: actorOf(exec), origin: 'tool', ...(common.expectedRevision === undefined ? {} : { expectedRevision: common.expectedRevision }) }, 'when-bound');
        return written(value);
      } catch (error) {
        const refused = refusal(error);
        if (refused !== undefined) return refused;
        throw error;
      }
    }),
    normal('edit_board_yaml', intent + 'Apply literal old/new text edits to a board workflow YAML. Each old text must occur exactly once at apply time; all edits are applied together and the result is validated before saving. Read the exact YAML with get_board_yaml first and copy the text, including indentation and comments. A bound Hub publishes the change automatically.' + reportNote, {
      board_id: text('Board ID.', true),
      hub_id: text('Hub ID. Optional when the board identifier is enough.'),
      edits: { type: 'array', required: true, description: 'Literal replacements applied in order. Each old text must occur exactly once.', items: { type: 'object', additionalProperties: false, properties: { old: { type: 'string', required: true }, new: { type: 'string', required: true } } } },
      expected_revision: { type: 'integer', description: 'Hub revision from a prior read; stale values are rejected.' },
    }, async (args, exec) => {
      await assertBoardWriteAllowed(app, exec);
      try {
        const value = await boards.saveWorkflowReviewed({ boardId: args.board_id, ...(args.hub_id === undefined ? {} : { hubId: args.hub_id }), compose: current => applyWorkflowEdits(current, args.edits), actor: actorOf(exec), origin: 'tool', ...(args.expected_revision === undefined ? {} : { expectedRevision: args.expected_revision }) }, 'when-bound');
        return written(value);
      } catch (error) {
        const refused = refusal(error);
        if (refused !== undefined) return refused;
        throw error;
      }
    }),
    normal('delete_board', intent + 'Delete an empty board. Pass confirmed:true only after the user explicitly confirmed the deletion. A team-bound board also requires sharing local or team. Projects, worktrees, conversations, and native workspaces are kept.', {
      board_id: text('Board ID.', true),
      hub_id: text('Hub ID. Optional when the board identifier is enough.'),
      confirmed: { type: 'boolean', required: true, description: 'Explicit confirmation for this deletion.' },
      sharing: { type: 'string', enum: ['local', 'team'], description: 'Removal scope for a team-bound board.' },
      expected_revision: { type: 'integer', description: 'Hub revision from a prior read; stale values are rejected.' },
    }, async (args, exec) => {
      await assertBoardWriteAllowed(app, exec);
      const value = await boards.remove({ boardId: args.board_id, confirmed: args.confirmed, ...(args.hub_id === undefined ? {} : { hubId: args.hub_id }), ...(args.sharing === undefined ? {} : { sharing: args.sharing as 'local' | 'team' }), ...(args.expected_revision === undefined ? {} : { expectedRevision: args.expected_revision }) }, 'when-bound');
      return boardResult(value);
    }),
  ];
}