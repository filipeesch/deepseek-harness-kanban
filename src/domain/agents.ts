import type { Column, Workflow, WorkflowAgent } from '../shared/types.js';
import { MAIN_AGENT_ID } from '../shared/types.js';

/** The display name of a main agent the document does not declare. */
export const MAIN_AGENT_NAME = 'Main';

/** Every agent the document declares, in authored order. */
export function declaredAgents(workflow: Pick<Workflow, 'agents'>): WorkflowAgent[] {
  return workflow.agents ?? [];
}

/** The declared main agent, when the document authors one. */
export function authoredMainAgent(workflow: Pick<Workflow, 'agents'>): WorkflowAgent | undefined {
  return declaredAgents(workflow).find(agent => agent.id === MAIN_AGENT_ID);
}

/**
 * Resolve one agent identity in a document. `main` is always answerable: a document
 * that authors no main entry keeps the legacy description, whose preset and model the
 * board resolves. Every other identity exists only when the document declares it.
 */
export function agentFor(workflow: Pick<Workflow, 'agents'>, id: string): WorkflowAgent | undefined {
  if (id === MAIN_AGENT_ID) return authoredMainAgent(workflow) ?? { id: MAIN_AGENT_ID, name: MAIN_AGENT_NAME };
  return declaredAgents(workflow).find(agent => agent.id === id);
}

/**
 * The agent a stage runs with, or undefined for the main conversation. A stage that
 * names `main` explicitly is the main conversation too: the identity is the same.
 */
export function stageAgentId(column: Pick<Column, 'agent'> | undefined): string | undefined {
  const id = column?.agent;
  return id === undefined || id === MAIN_AGENT_ID ? undefined : id;
}

/** The agent entry a stage's instruction runs with; undefined means the main conversation. */
export function stageAgent(workflow: Pick<Workflow, 'agents' | 'columns'>, columnId: string): WorkflowAgent | undefined {
  const id = stageAgentId(workflow.columns.find(column => column.id === columnId));
  return id === undefined ? undefined : agentFor(workflow, id);
}

/** Whether one agent identity names a stage's own conversation. */
export function isStageAgent(agent: string | undefined): agent is string {
  return agent !== undefined && agent !== MAIN_AGENT_ID;
}
