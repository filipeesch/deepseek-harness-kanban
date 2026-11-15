import React, { useState } from 'react';
import { boardView } from '../../board-projection.js';
import { CreateBoardDialog } from '../../create-dialogs.js';
import type { ClientApi, HubSharingView, HubState, KanbanSettings, Problem } from '../../../shared/types.js';
import type { NativeSeat } from '../../native-slot-host.js';
import { ErrorNotice, type RunCommand } from '../../ui.js';
import { BoardConfigurationOverlay } from './board-overlay.js';

/**
 * The Hub's boards as a management list: each row edits or deletes its board, and the
 * section creates new ones through the same dialog the board header uses. Renaming lives
 * in the board's own configuration, so a row states identity, edit, and delete only.
 */
export function BoardsSection({ hub, settings, run, api, sharing, nativeSeat, onCreated }: {
  hub: HubState;
  settings?: KanbanSettings;
  run: RunCommand;
  api?: ClientApi;
  sharing?: HubSharingView;
  nativeSeat?: NativeSeat;
  onCreated?: (id: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Problem | null>(null);
  async function remove(boardId: string, scope?: 'local' | 'team'): Promise<void> {
    setPending(true); setError(null);
    try {
      await run({ type: 'board.delete', hubId: hub.id, boardId, confirmed: true, expectedRevision: hub.revision, ...(scope === undefined ? {} : { sharing: scope }) });
      setDeleting(null);
    } catch (failure) { setError(failure as Problem); }
    finally { setPending(false); }
  }
  return <div className="kb-form" aria-label="Boards">
    <div className="kb-row"><h3>Boards</h3><button type="button" className="kb-button" onClick={() => setCreating(true)}>New board</button></div>
    <p className="kb-hint">Each row edits or deletes its board. A board's name, workflow, defaults, project scope, and deletion are configured in the board itself.</p>
    <ul className="kb-project-list kb-board-list">{hub.boards.map(board => {
      // A bound board can be removed only here or for the team; an unbound one needs no scope.
      const bound = sharing?.boards.find(value => value.boardId === board.id)?.bound === true;
      const inUse = boardView(hub, board, settings ?? { revision: 0 }).tasks.length > 0;
      return <li key={board.id}>
        <strong>{board.name}</strong>
        <div className="kb-board-row-actions">
          <button type="button" className="kb-button" aria-label={'Edit board ' + board.name} onClick={() => setEditing(board.id)}>Edit</button>
          <button type="button" className="kb-button kb-danger" aria-label={'Delete board ' + board.name} disabled={pending || inUse} title={inUse ? 'Delete every task before deleting the board.' : 'Delete this board'} onClick={() => { setError(null); setDeleting(board.id); }}>Delete board</button>
        </div>
        {deleting === board.id && <div className="kb-inline-confirm" role="alertdialog" aria-label={'Confirm deleting board ' + board.name}>
          {bound
            ? <><p>Remove <strong>{board.name}</strong> only from this installation, or for the team as well? Removing it here keeps the team board published; removing it for the team sends the removal with the next synchronization or publish.</p>
              <div className="kb-actions"><button type="button" className="kb-button" disabled={pending} onClick={() => setDeleting(null)}>Cancel</button><button type="button" className="kb-button" disabled={pending} onClick={() => void remove(board.id, 'local')}>Remove only here</button><button type="button" className="kb-button kb-danger" disabled={pending} onClick={() => void remove(board.id, 'team')}>{pending ? 'Removing…' : 'Remove for the team'}</button></div></>
            : <><p>Delete <strong>{board.name}</strong>? The board has no tasks; its workflow is removed with it.</p>
              <div className="kb-actions"><button type="button" className="kb-button" disabled={pending} onClick={() => setDeleting(null)}>Cancel</button><button type="button" className="kb-button kb-danger" disabled={pending} onClick={() => void remove(board.id)}>{pending ? 'Deleting…' : 'Confirm delete board'}</button></div></>}
        </div>}
      </li>;
    })}</ul>
    {hub.boards.length === 0 && <p className="kb-hint" role="status">This Hub has no boards yet. Create one to start a workflow.</p>}
    <ErrorNotice problem={error} />
    {creating && <CreateBoardDialog hubId={hub.id} run={run} onClose={() => setCreating(false)} onCreated={id => { setCreating(false); onCreated?.(id); }} />}
    {editing !== null && <BoardConfigurationOverlay
      boardId={editing}
      hub={hub}
      {...(settings === undefined ? {} : { settings })}
      {...(sharing === undefined ? {} : { sharing })}
      run={run}
      {...(api === undefined ? {} : { api })}
      {...(nativeSeat === undefined ? {} : { nativeSeat })}
      onClose={() => setEditing(null)}
    />}
  </div>;
}
