import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { KanbanApp } from '../app.js';
import type { WorkflowAgent } from '../../shared/types.js';
import { MAIN_AGENT_ID } from '../../shared/types.js';
import { agentFor, declaredAgents } from '../../domain/agents.js';
import { agentModel, writeBoardAgentsField, writeStageAgentField } from '../../domain/board-agents-field.js';
import { invariant } from '../../shared/errors.js';
import { parseWorkflow } from '../../domain/workflow.js';
import { isDomainId } from '../../domain/validation.js';
import { intent, preserveNote, reportNote, revisionParameter, workflowWriteControls, write, type WorkflowAuthoringPort, type WriteArgs } from './authoring.js';
import { normal, text } from './support.js';
import { assertBoardWriteAllowed } from './scope.js';

/** The agent tools' model parameters, shared by the two writes that accept a route. */
const modelParameters = {
  model_provider: text('Model provider identity for this agent. Supply it together with model_name.'),
  model_name: text('Model identity for this agent. Supply it together with model_provider.'),
  model_reasoning_effort: text('Reasoning effort for this agent model, when the provider offers efforts.'),
} as const;

function agentId(value: unknown, label: string): string {
  invariant(typeof value === 'string' && isDomainId(value), 'INVALID_INPUT', label + ' must be a safe identifier.');
  return value;
}

/**
 * The agent authoring tools: the board's agents and the agent a stage names. Every
 * write composes one document, keeps every authored character outside the fields it
 * names, and returns the existing workflow write report.
 */
export function agentTools(app: KanbanApp, port: WorkflowAuthoringPort): ToolDefinition[] {
  return [
    normal('set_agent',
      intent + 'Create or replace one agent of the board\'s workflow. An agent names the preset and model its conversations run on; the reserved identity ' + MAIN_AGENT_ID + ' describes the main conversation and can be authored but never removed. A preset or model this host does not report is observed in the report and never refused.' + preserveNote + reportNote,
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
        const id = agentId(args.agent_id, 'agent_id');
        return write(port, args as WriteArgs, exec, current => {
          const workflow = parseWorkflow(current);
          const model = agentModel(args.model_provider, args.model_name, args.model_reasoning_effort);
          const preset = typeof args.preset === 'string' && args.preset.trim() === '' ? undefined : args.preset?.trim();
          const next: WorkflowAgent = {
            id,
            name: args.name.trim(),
            ...(preset === undefined ? {} : { preset }),
            ...(model === undefined ? {} : { model }),
          };
          const agents = declaredAgents(workflow);
          const index = agents.findIndex(agent => agent.id === id);
          const written = index === -1 ? [...agents, next] : [...agents.slice(0, index), next, ...agents.slice(index + 1)];
          return writeBoardAgentsField(current, written);
        });
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
        const id = agentId(args.agent_id, 'agent_id');
        return write(port, args as WriteArgs, exec, current => {
          const workflow = parseWorkflow(current);
          invariant(id !== MAIN_AGENT_ID, 'INVALID_INPUT', 'The main agent cannot be removed.');
          invariant(declaredAgents(workflow).some(agent => agent.id === id), 'INVALID_INPUT', 'The workflow does not declare that agent.');
          invariant(!workflow.columns.some(column => column.agent === id), 'INVALID_INPUT', 'A stage still names that agent. Clear the stage before removing it.');
          return writeBoardAgentsField(current, declaredAgents(workflow).filter(agent => agent.id !== id));
        });
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
        const id = agentId(args.stage_id, 'stage_id');
        return write(port, args as WriteArgs, exec, current => {
          const workflow = parseWorkflow(current);
          invariant(workflow.columns.some(column => column.id === id), 'INVALID_TARGET', 'The workflow has no stage ' + id + '.');
          const agent = typeof args.agent_id === 'string' && args.agent_id.trim() === '' ? undefined : args.agent_id?.trim();
          if (agent !== undefined) invariant(agentFor(workflow, agent) !== undefined, 'INVALID_INPUT', 'The workflow does not declare that agent.');
          return writeStageAgentField(current, id, agent === MAIN_AGENT_ID ? undefined : agent);
        });
      }),
  ];
}
