import React, { useState } from 'react';
import type { Board, BoardState, HubSharingView, HubState, Problem } from '../../../shared/types.js';
import { ErrorNotice, type RunCommand } from '../../ui.js';

/** Deleting a board: empty boards only, and a bound board also needs a removal scope. */
export function BoardDeletionControl({ state, hub, board, sharing, run, onDeleted }: {
  state: BoardState;
  hub: HubState;
  board: Board;
  sharing?: HubSharingView;
  run: RunCommand;
  onDeleted?: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Problem | null>(null);
  const [confirm, setConfirm] = useState(false);
  const bound = sharing?.boards.find(value => value.boardId === board.id)?.bound === true;
  const inUse = state.tasks.length > 0;
  async function remove(scope?: 'local' | 'team'): Promise<void> {
    setPending(true); setError(null);
    try {
      await run({ type: 'board.delete', hubId: hub.id, boardId: board.id, confirmed: true, expectedRevision: state.revision, ...(scope === undefined ? {} : { sharing: scope }) });
      onDeleted?.();
    } catch (failure) { setError(failure as Problem); }
    finally { setPending(false); }
  }
  return <div className="kb-form">
    <div className="kb-actions">
      <button type="button" className="kb-button kb-danger" disabled={pending || inUse} title={inUse ? 'Delete every task before deleting the board.' : 'Delete this board'} onClick={() => { if (!bound && confirm) { void remove(); return; } setConfirm(true); }}>{!bound && confirm ? 'Confirm delete board' : 'Delete board'}</button>
      {confirm && (bound
        ? <><button type="button" className="kb-button" disabled={pending} onClick={() => void remove('local')}>Remove only here</button><button type="button" className="kb-button kb-danger" disabled={pending} onClick={() => void remove('team')}>Remove for the team</button><button type="button" className="kb-button" onClick={() => setConfirm(false)}>Cancel</button></>
        : <button type="button" className="kb-button" onClick={() => setConfirm(false)}>Cancel</button>)}
    </div>
    {bound && confirm && <p className="kb-hint">Remove only here keeps the team board published. Remove for the team sends the removal with the next synchronization or publish.</p>}
    <ErrorNotice problem={error} />
  </div>;
}
