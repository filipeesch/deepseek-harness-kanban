import React from 'react';
import type { Board, ClientApi, HubState } from '../../../shared/types.js';
import { useAgentPresetPort } from '../../agent-preset-context.js';
import type { NativeSeat } from '../../native-slot-host.js';
import { ErrorNotice, type RunCommand } from '../../ui.js';
import { useBoardAgents } from './use-board-agents.js';
import { BoardAgentsList } from './board-agents-list.js';
import { usePanelDirty } from './use-panel-dirty.js';

export interface BoardAgentsPanelProps {
  hub: HubState;
  board: Board;
  run: RunCommand;
  api?: ClientApi;
  /** The saved workflow document, never the editor's draft. */
  yaml: string;
  baseRevision: number;
  /** Whether the Workflow sub-section holds unsaved edits. */
  workflowEditing: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  seat?: NativeSeat;
}

/**
 * The board's Agents tab: who runs each stage, and on which preset and model. One
 * draft, one dirty state, one guarded write of the authored agents section.
 */
export function BoardAgentsPanel({ hub, board, run, api, yaml, baseRevision, workflowEditing, onDirtyChange, seat }: BoardAgentsPanelProps) {
  const { port, translate } = useAgentPresetPort();
  const controller = useBoardAgents({
    hub, board, run, ...(api === undefined ? {} : { api }), yaml, baseRevision, workflowEditing, presetPort: port, ...(translate === undefined ? {} : { translate }),
  });
  usePanelDirty(controller.dirty, onDirtyChange);
  const problems = controller.problems.map(problem => problem.message);
  return <form className="kb-form" aria-label="Board agents" onSubmit={event => { event.preventDefault(); void controller.save(); }}>
    <h3>Agents</h3>
    <p className="kb-hint">Every conversation starts on the preset and model of the agent that runs its stage. The main agent is the board default, and it runs every stage that names no agent.</p>

    <BoardAgentsList controller={controller} {...(seat === undefined ? {} : { seat })} />

    {problems.length > 0 && <p className="kb-hint" role="alert">{problems.join(' ')}</p>}
    {workflowEditing && <p className="kb-hint" role="status">Save or discard the Workflow changes before saving the agents.</p>}
    {controller.error !== null && <ErrorNotice problem={controller.error} />}
    <div className="kb-actions">
      <button className="kb-button kb-primary" type="submit" disabled={!controller.canSave}>{controller.pending ? 'Saving…' : 'Save agents'}</button>
      {controller.saved && <p className="kb-hint" role="status">Agents saved.</p>}
    </div>
  </form>;
}
