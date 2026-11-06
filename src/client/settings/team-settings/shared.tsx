import React from 'react';
import type { HubSharingView, Problem, SharingCommand } from '../../../shared/types.js';
import { ErrorNotice } from '../../ui.js';
import { BOARD_STATE_LABEL, HUB_STATUS_LABEL } from '../../sharing/status.js';

export type Act = (label: string, command: SharingCommand) => Promise<boolean>;

export function VersionDiff({ detail }: { detail?: { local: string; team: string; localName: string; teamName: string } }) {
  if (!detail) return null;
  return <details className="kb-share-diff"><summary>Compare the workflow versions</summary><div className="kb-share-diff-body">
    <div><h5>This machine: {detail.localName}</h5><pre>{detail.local}</pre></div>
    <div><h5>Team: {detail.teamName}</h5><pre>{detail.team}</pre></div>
  </div></details>;
}

export function Blockers({ blockers }: { blockers: Array<{ code: string; message: string }> }) {
  if (blockers.length === 0) return null;
  return <ul className="kb-share-blockers" aria-label="Sync blockers">
    {blockers.map((blocker, index) => <li key={blocker.code + ':' + index}><code>{blocker.code}</code> {blocker.message}</li>)}
  </ul>;
}

export function StatusLine({ sharing }: { sharing: HubSharingView }) {
  const attention = sharing.updates + sharing.conflicts + sharing.blockers.length + sharing.pending;
  return <p className="kb-share-meta">
    <span className={'kb-share-status' + (attention > 0 ? ' is-attention' : '')}>{HUB_STATUS_LABEL[sharing.status]}</span>
    <span>{sharing.providerLabel}</span>
    <span>{sharing.address}</span>
    {sharing.lastCheckedAt && <span>Checked {new Date(sharing.lastCheckedAt).toLocaleString()}</span>}
    <span>{sharing.intervalMinutes === 0 ? 'Manual checks only' : 'Every ' + sharing.intervalMinutes + ' min'}</span>
    {sharing.syncMode === 'continuous' && <span>{sharing.syncing ? 'Syncing…' : sharing.pending > 0 ? sharing.pending + ' pending' : 'Up to date'}</span>}
  </p>;
}

export function BoardReview({ hubId, sharing, act, pending }: { hubId: string; sharing: HubSharingView; act: Act; pending: string | null }) {
  return <>
    <h4>Boards</h4>
    <ul className="kb-share-boards" aria-label="Shared boards">
      {sharing.boards.map(board => <li key={board.boardId} className="kb-share-board">
        <div className="kb-share-board-main"><span className="kb-share-board-name">{board.name}</span><span className="kb-share-board-state">{BOARD_STATE_LABEL[board.state] ?? board.state}</span>
          <VersionDiff detail={board.detail} />
        </div>
        <div className="kb-share-actions">
          {board.state === 'needs-review' && board.key !== undefined && <>
            <button type="button" className="kb-button" disabled={pending !== null} onClick={() => void act('resolve-team', { type: 'sharing.resolve', hubId, boardId: board.boardId, choice: 'team' })}>Use the team version</button>
            <button type="button" className="kb-button" disabled={pending !== null} onClick={() => void act('resolve-local', { type: 'sharing.resolve', hubId, boardId: board.boardId, choice: 'local' })}>Keep the local version</button>
          </>}
          {board.state === 'needs-review' && board.key === undefined && <span className="kb-share-board-state">A local board already uses this name. Rename or publish it first.</span>}
          {board.state === 'orphan' && !board.pending && <button type="button" className="kb-button" disabled={pending !== null} onClick={() => void act('orphan', { type: 'sharing.publishOrphan', hubId, boardId: board.boardId })}>Publish as a new board</button>}
        </div>
      </li>)}
    </ul>
    {sharing.incoming.length > 0 && <p className="kb-hint" role="status">New from the team: {sharing.incoming.map(board => board.name).join(', ')}.</p>}
    {sharing.orderChanged && <p className="kb-hint" role="status">The team changed the board order.</p>}
    {sharing.removing.length > 0 && <p className="kb-hint" role="status">Removed by the team with no local work: {sharing.removing.map(board => board.name).join(', ')}.</p>}
    {sharing.boards.some(board => board.state === 'orphan' && board.pending) && <p className="kb-hint" role="status">The team removed a board that still has local work. {sharing.syncMode === 'continuous' ? 'Sync now to keep it as an orphan.' : 'Get updates to keep it as an orphan.'}</p>}
  </>;
}

export function RemovedBoards({ hubId, sharing, act, pending }: { hubId: string; sharing: HubSharingView; act: Act; pending: string | null }) {
  if (sharing.removed.length === 0) return null;
  return <>
    <h4>Removed only here</h4>
    <ul className="kb-share-boards" aria-label="Boards removed only from this installation">
      {sharing.removed.map(board => <li key={board.key} className="kb-share-board">
        <div className="kb-share-board-main"><span className="kb-share-board-name">{board.name}</span><span className="kb-share-board-state">Removed here</span></div>
        <div className="kb-share-actions"><button type="button" className="kb-button" disabled={pending !== null} onClick={() => void act('restore', { type: 'sharing.restore', hubId, boardId: board.boardId })}>Restore</button></div>
      </li>)}
    </ul>
  </>;
}

export function ErrorBlock({ error }: { error: Problem | null }) { return <ErrorNotice problem={error} />; }
