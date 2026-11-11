import React from 'react';
import type { Board, BoardState, ClientApi, HubSharingView, HubState } from '../../shared/types.js';
import { canShareFromEditor } from '../sharing/status.js';
import type { RunCommand } from '../ui.js';
import { WorkflowEditor } from '../workflow-editor.js';
import { BoardDeletionControl } from './board/board-deletion-control.js';
import { BoardIdentityForm } from './board/board-identity-form.js';
import { BoardModelForm } from './board/board-model-form.js';
import { BoardProjectScopeForm } from './board/board-project-scope-form.js';

/**
 * The board section of Configuration: identity, project scope, default model,
 * deletion, and the workflow editor. Each concern owns its own form and its own
 * command, and saving one never touches another's draft.
 *
 * The default model and the workflow editor both write the same document, so they
 * cannot both hold it. The editor owns the unsaved draft; the model form writes
 * only the saved document and stands down — with an explanation — while a draft is
 * open. That is what keeps a click on **Save model** from committing prompt edits
 * nobody meant to save, and from releasing the editor's draft underneath it.
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
    <BoardModelForm
      hub={hub}
      board={board}
      run={run}
      {...(api === undefined ? {} : { api })}
      yaml={state.workflowYaml}
      baseRevision={state.revision}
      workflowEditing={workflowDraft !== null && workflowDraft.yaml !== state.workflowYaml}
    />
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
