import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { KanbanApp } from '../app.js';
import { MAIN_AGENT_ID } from '../../shared/types.js';
import { modelOf, removeAgent, setAgent, setStageAgent, stageIdOf } from '../../domain/workflow-operations.js';
import { intent, preserveNote, reportNote, revisionParameter, workflowWriteControls, write, type WorkflowAuthoringPort, type WriteArgs } from './authoring.js';
import { normal, text } from './support.js';
import { assertBoardWriteAllowed } from './scope.js';

/** The agent tools' model parameters, shared by the two writes that accept a route. */
const modelParameters = {
  model_provider: text('Model provider identity for this agent. Supply it together with model_name.'),
  model_name: text('Model identity for this agent. Supply it together with model_provider.'),
  model_reasoning_effort: text('Reasoning effort for this agent model, when the provider offers efforts.'),
} as const;

/**
 * The agent authoring tools: the board's agents and the agent a stage names. Every
 * write composes one document, keeps every authored character outside the fields it
 * names, and returns the existing workflow write report.
 */
export function agentTools(app: KanbanApp, port: WorkflowAuthoringPort): ToolDefinition[] {
  return [
    normal('set_agent',
      intent + 'Create or replace one agent of the board\'s workflow. An agent names the preset and model its conversations run on; the reserved identity ' + MAIN_AGENT_ID + ' describes the main conversation and can be authored but never removed. A preset or model this host does not report is observed in the report and never refused. Only the named entry is rewritten, so comments and formatting on every other agent survive.' + preserveNote + reportNote,
      {
        board_id: text('Board ID.', true),
        agent_id: text('Agent identity; ' + MAIN_AGENT_ID + ' is the main conversation.', true),
        name: text('Agent display name. It is the conversation tab title.', true),
        preset: text('Agent preset identity. An empty string keeps the host default preset for this agent.'),
        ...modelParameters,
        hub_id: text('Hub ID. Optional when the board identifier is enough.'),
        expected_revision: revisionParameter,
        ...workflowWriteControls,
      },
      async (args, exec) => {
        await assertBoardWriteAllowed(app, exec);
        stageIdOf(args.agent_id, 'agent_id');
        return write(port, args as WriteArgs, exec, current => setAgent(current, {
          agentId: args.agent_id,
          name: args.name,
          ...(args.preset === undefined ? {} : { preset: args.preset }),
          ...(() => {
            const model = modelOf(args.model_provider, args.model_name, args.model_reasoning_effort);
            return model === undefined ? {} : { model };
          })(),
        }));
      }),

    normal('remove_agent',
      intent + 'Remove one agent from the board\'s workflow. The reserved main agent and an agent a stage still names cannot be removed.' + preserveNote + reportNote,
      {
        board_id: text('Board ID.', true),
        agent_id: text('Agent identity to remove.', true),
        hub_id: text('Hub ID. Optional when the board identifier is enough.'),
        expected_revision: revisionParameter,
        ...workflowWriteControls,
      },
      async (args, exec) => {
        await assertBoardWriteAllowed(app, exec);
        return write(port, args as WriteArgs, exec, current => removeAgent(current, args.agent_id));
      }),

    normal('set_stage_agent',
      intent + 'Bind one stage to an agent, or return it to the main conversation. The agent must be declared by the workflow, or be the reserved main identity. The stage keeps its own entry instruction.' + preserveNote + reportNote,
      {
        board_id: text('Board ID.', true),
        stage_id: text('Stage ID.', true),
        agent_id: text('Agent identity the stage runs with. An empty string returns the stage to the main conversation.'),
        hub_id: text('Hub ID. Optional when the board identifier is enough.'),
        expected_revision: revisionParameter,
        ...workflowWriteControls,
      },
      async (args, exec) => {
        await assertBoardWriteAllowed(app, exec);
        stageIdOf(args.stage_id, 'stage_id');
        return write(port, args as WriteArgs, exec, current => setStageAgent(current, args.stage_id, args.agent_id));
      }),
  ];
}
