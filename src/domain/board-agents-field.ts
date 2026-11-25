import type { ModelSelection, WorkflowAgent } from '../shared/types.js';
import { KanbanError } from '../shared/errors.js';
import { authoredScalar, writeRootField, writeSequenceItemField } from './yaml-map-fields.js';
import { parseWorkflow } from './workflow.js';

/** The authored root key that carries the board's agents. */
const AGENTS_KEY = 'agents';
const EFFORT_KEY = 'reasoning_effort';

function invalid(message: string): never {
  throw new KanbanError('INVALID_WORKFLOW', message);
}

/** The authored lines of one agent entry, without its leading sequence dash. */
function agentLines(agent: WorkflowAgent, indent: string): string[] {
  const lines = [indent + '  - id: ' + authoredScalar(agent.id), indent + '    name: ' + authoredScalar(agent.name)];
  if (agent.preset !== undefined) lines.push(indent + '    preset: ' + authoredScalar(agent.preset));
  if (agent.model !== undefined) {
    lines.push(indent + '    model:');
    lines.push(indent + '      provider: ' + authoredScalar(agent.model.provider));
    lines.push(indent + '      model: ' + authoredScalar(agent.model.model));
    if (agent.model.reasoningEffort !== undefined) lines.push(indent + '      ' + EFFORT_KEY + ': ' + authoredScalar(agent.model.reasoningEffort));
  }
  return lines;
}

/** The whole section in one flow mapping, for a document authored in flow style. */
function flowAgents(agents: readonly WorkflowAgent[]): string {
  const entries = agents.map(agent => {
    const pairs = ['id: ' + authoredScalar(agent.id), 'name: ' + authoredScalar(agent.name)];
    if (agent.preset !== undefined) pairs.push('preset: ' + authoredScalar(agent.preset));
    if (agent.model !== undefined) {
      const model = ['provider: ' + authoredScalar(agent.model.provider), 'model: ' + authoredScalar(agent.model.model)];
      if (agent.model.reasoningEffort !== undefined) model.push(EFFORT_KEY + ': ' + authoredScalar(agent.model.reasoningEffort));
      pairs.push('model: {' + model.join(', ') + '}');
    }
    return '{' + pairs.join(', ') + '}';
  });
  return AGENTS_KEY + ': [' + entries.join(', ') + ']';
}

/** Render the authored agents section, or null to remove it. */
function agentsField(agents: readonly WorkflowAgent[] | undefined, indent: string, flow: boolean): string | null {
  if (agents === undefined || agents.length === 0) return null;
  if (flow) return flowAgents(agents);
  return [AGENTS_KEY + ':', ...agents.flatMap(agent => agentLines(agent, indent))].join('\n');
}

/**
 * Write or clear the board's agents in an authored workflow document. The section is
 * rewritten as a block of text, so comments, key order, quoting, and every other
 * authored character outside it survive. Passing an empty list removes the section.
 * The result is parsed before it is returned, so a caller can never persist a document
 * the board would refuse.
 */
export function writeBoardAgentsField(text: string, agents: readonly WorkflowAgent[] | undefined): string {
  const next = writeRootField({
    text,
    fieldKeys: [AGENTS_KEY],
    render: (_existing, indent, _key, flow) => agentsField(agents, indent, flow),
    invalid,
  });
  parseWorkflow(next);
  return next;
}

/**
 * Write or clear the agent one stage names, preserving every other authored
 * character of the document and of the stage.
 */
export function writeStageAgentField(text: string, stageId: string, agent: string | undefined): string {
  const next = writeSequenceItemField({
    text,
    sequenceKey: 'columns',
    idKey: 'id',
    id: stageId,
    fieldKeys: ['agent'],
    render: () => (agent === undefined ? null : 'agent: ' + authoredScalar(agent)),
    invalid,
  });
  parseWorkflow(next);
  return next;
}

/** The model a tool call describes, when it names one. */
export function agentModel(provider: unknown, model: unknown, reasoningEffort: unknown): ModelSelection | undefined {
  const hasProvider = typeof provider === 'string' && provider.trim() !== '';
  const hasModel = typeof model === 'string' && model.trim() !== '';
  if (!hasProvider && !hasModel) return undefined;
  if (!hasProvider || !hasModel) throw new KanbanError('INVALID_INPUT', 'A model route requires both a provider and a model.');
  return {
    provider: (provider as string).trim(),
    model: (model as string).trim(),
    ...(typeof reasoningEffort === 'string' && reasoningEffort.trim() !== '' ? { reasoningEffort: reasoningEffort.trim() } : {}),
  };
}
