import React from 'react';
import type { Board, BoardState, ClientApi, HubSharingView, HubState } from '../../shared/types.js';
import { canShareFromEditor } from '../sharing/status.js';
import type { RunCommand } from '../ui.js';
import { WorkflowEditor } from '../workflow-editor.js';
import { BoardDeletionControl } from './board/board-deletion-control.js';
import { BoardIdentityForm } from './board/board-identity-form.js';
import { BoardProjectScopeForm } from './board/board-project-scope-form.js';

/**
 * The board section of Configuration: identity, project scope, deletion, and the
 * workflow editor. Each concern owns its own form and its own command.
 */
export function BoardSettings({ state, hub, board, run, api, sharing, onDeleted, workflowDraft, setWorkflowDraft }: {
  state: BoardState;
  hub: HubState | null;
  board: Board;
  run: RunCommand;
  api?: ClientApi;
  sharing?: HubSharingView;
  onDeleted?: () => void;
  workflowDraft: { yaml: string; revision: number } | null;
  setWorkflowDraft: React.Dispatch<React.SetStateAction<{ yaml: string; revision: number } | null>>;
}) {
  if (!hub) return null;
  const onShare = api !== undefined && canShareFromEditor(sharing, board.id) ? async () => { await api.sharing({ type: 'sharing.publish', hubId: hub.id }); } : undefined;
  return <div className="kb-form">
    <BoardIdentityForm hub={hub} board={board} run={run} />
    <BoardProjectScopeForm state={state} hub={hub} board={board} run={run} />
    <BoardDeletionControl state={state} hub={hub} board={board} sharing={sharing} run={run} onDeleted={onDeleted} />
    <WorkflowEditor
      state={state}
      run={run}
      hubId={hub.id}
      boardId={board.id}
      yaml={workflowDraft?.yaml ?? state.workflowYaml}
      baseRevision={workflowDraft?.revision ?? state.revision}
      onYamlChange={yaml => setWorkflowDraft(current => current ? { ...current, yaml } : { yaml, revision: state.revision })}
      onSaved={() => setWorkflowDraft(null)}
      onReload={() => setWorkflowDraft(null)}
      {...(onShare === undefined ? {} : { onShare })}
    />
  </div>;
}
