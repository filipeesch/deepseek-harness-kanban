import React from 'react';
import type { WorkflowAgent } from '../../shared/types.js';
import type { StageProblem } from './stage-problem.js';
import { ProblemNotice } from './problem-notice.js';

/** The agents a stage can run with: the main conversation, and every declared agent. */
export function AgentSection({ agents, value, disabled, problem, onChange }: {
  readonly agents: readonly WorkflowAgent[];
  /** The chosen agent; undefined means the main conversation. */
  readonly value: string | undefined;
  readonly disabled: boolean;
  readonly problem: (field: StageProblem['field']) => string | undefined;
  readonly onChange: (value: string | undefined) => void;
}) {
  const declared = agents.filter(agent => agent.id !== 'main');
  const storedMissing = value !== undefined && !declared.some(agent => agent.id === value);
  return <fieldset className="kb-fieldset">
    <legend>Agent</legend>
    <label className="kb-field">Conversation
      <select
        className="kb-input"
        aria-label="Stage agent"
        disabled={disabled}
        value={value ?? ''}
        onChange={event => onChange(event.target.value === '' ? undefined : event.target.value)}
      >
        <option value="">Main conversation</option>
        {declared.map(agent => <option key={agent.id} value={agent.id}>{agent.name} ({agent.id})</option>)}
        {storedMissing && <option value={value}>{value} (not available on this board)</option>}
      </select>
    </label>
    <ProblemNotice message={problem('agent')} />
    {declared.length === 0 && <p className="kb-hint">This board declares no other agent. Add one in the board's Defaults section; a stage with an agent runs its instruction in that agent's own conversation.</p>}
    {declared.length > 0 && <p className="kb-hint">A stage with an agent runs its instruction in that agent's conversation, with the agent's preset and model. The main conversation runs every stage that names none.</p>}
  </fieldset>;
}
