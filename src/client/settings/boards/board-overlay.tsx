import React, { useEffect, useMemo, useState } from 'react';
import { boardView } from '../../board-projection.js';
import type { Board, BoardState, ClientApi, HubSharingView, HubState, KanbanSettings } from '../../../shared/types.js';
import type { NativeSeat } from '../../native-slot-host.js';
import { Modal, type RunCommand } from '../../ui.js';
import { BoardSettings } from '../board-settings.js';

/**
 * One board's configuration, stacked above the Boards section that opened it. The
 * overlay projects the board it was opened for out of the Hub, so it edits that board
 * even when another one is the active board of the page. Its own drafts are guarded
 * here: closing asks before discarding either the workflow draft or a panel draft.
 */
export function BoardConfigurationOverlay({ boardId, hub, settings, sharing, run, api, nativeSeat, onClose }: {
  boardId: string;
  hub: HubState;
  settings?: KanbanSettings;
  sharing?: HubSharingView;
  run: RunCommand;
  api?: ClientApi;
  nativeSeat?: NativeSeat;
  onClose: () => void;
}) {
  const board: Board | undefined = hub.boards.find(value => value.id === boardId);
  const state: BoardState | null = useMemo(() => board === undefined ? null : boardView(hub, board, settings ?? { revision: 0 }), [hub, board, settings]);
  const [workflowDraft, setWorkflowDraft] = useState<{ yaml: string; revision: number } | null>(null);
  const [boardDirty, setBoardDirty] = useState(false);
  const [closePending, setClosePending] = useState(false);
  const workflowDirty = state !== null && workflowDraft !== null && workflowDraft.yaml !== state.workflowYaml;
  const dirty = workflowDirty || boardDirty;
  useEffect(() => { if (!dirty) setClosePending(false); }, [dirty]);
  // The board can disappear from another surface while this overlay is open.
  useEffect(() => { if (board === undefined) onClose(); }, [board, onClose]);
  function requestClose(): void {
    if (closePending) { setClosePending(false); return; }
    if (dirty) { setClosePending(true); return; }
    onClose();
  }
  if (board === undefined || state === null) return null;
  const kind = workflowDirty && boardDirty ? 'board and workflow' : workflowDirty ? 'workflow' : 'board';
  return <Modal title={'Board configuration · ' + board.name} onClose={requestClose} size="settings-wide">
    {closePending && <div className="kb-inline-confirm" role="alertdialog" aria-label="Discard board configuration changes">
      <p>You have unsaved {kind} changes. Discard them and close the board configuration?</p>
      <div className="kb-actions"><button type="button" className="kb-button" onClick={() => setClosePending(false)}>Keep editing</button><button type="button" className="kb-button kb-danger" onClick={onClose}>Discard and close</button></div>
    </div>}
    <BoardSettings
      state={state}
      hub={hub}
      board={board}
      run={run}
      {...(api === undefined ? {} : { api })}
      {...(sharing === undefined ? {} : { sharing })}
      workflowDraft={workflowDraft}
      setWorkflowDraft={setWorkflowDraft}
      {...(nativeSeat === undefined ? {} : { nativeSeat })}
      onDirtyChange={setBoardDirty}
      onDeleted={onClose}
    />
  </Modal>;
}
