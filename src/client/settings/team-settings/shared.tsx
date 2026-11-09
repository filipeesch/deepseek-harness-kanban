import React, { useEffect, useState } from 'react';
import type { HubSharingView, HubState, Problem, SharingCommand } from '../../../shared/types.js';
import { ErrorNotice } from '../../ui.js';
import { BOARD_STATE_LABEL, HUB_STATUS_LABEL } from '../../sharing/status.js';

export type Act = (label: string, command: SharingCommand) => Promise<boolean>;

function scopeLabel(keys: readonly string[] | undefined): string {
  if (keys === undefined) return 'every project';
  if (keys.length === 0) return 'no project (closed to creation)';
  return keys.join(', ');
}

export function VersionDiff({ detail }: { detail?: { local: string; team: string; localName: string; teamName: string; localProjectKeys?: string[]; teamProjectKeys?: string[] } }) {
  if (!detail) return null;
  const scopeDiffers = detail.localProjectKeys !== undefined || detail.teamProjectKeys !== undefined;
  const summary = scopeDiffers ? 'Compare the versions and project scopes' : 'Compare the workflow versions';
  return <details className="kb-share-diff"><summary>{summary}</summary><div className="kb-share-diff-body">
    {scopeDiffers && <p className="kb-hint">Project scope — this machine: {scopeLabel(detail.localProjectKeys)}; team: {scopeLabel(detail.teamProjectKeys)}.</p>}
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

/** The differences between the local Hub and the published configuration. */
export function ComparisonList({ sharing }: { sharing: HubSharingView }) {
  return <ul className="kb-share-boards" aria-label="Differences from the team configuration">
    {sharing.boards.filter(board => board.state === 'updates-available').map(board => <li key={board.boardId} className="kb-share-board"><div className="kb-share-board-main"><span className="kb-share-board-name">{board.name}</span><span className="kb-share-board-state">In both; the team version replaces the local one</span><VersionDiff detail={board.detail} /></div></li>)}
    {sharing.incoming.map(board => <li key={board.key} className="kb-share-board"><div className="kb-share-board-main"><span className="kb-share-board-name">{board.name}</span><span className="kb-share-board-state">Only in the team</span></div></li>)}
    {sharing.boards.filter(board => board.state === 'draft').map(board => <li key={board.boardId} className="kb-share-board"><div className="kb-share-board-main"><span className="kb-share-board-name">{board.name}</span><span className="kb-share-board-state">Only in this Hub</span></div></li>)}
  </ul>;
}

/**
 * The two first-connection choices over a storage that already has a published
 * document. The storage supplies its own noun, notice, and footnote.
 */
export function ConnectionPreview({ hub, sharing, act, pending, noun, notice, footnote, disabled = false }: {
  hub: HubState; sharing: HubSharingView; act: Act; pending: string | null;
  noun: string; notice?: React.ReactNode; footnote?: React.ReactNode; disabled?: boolean;
}) {
  const [confirmReplace, setConfirmReplace] = useState(false);
  useEffect(() => { setConfirmReplace(false); }, [sharing.status, sharing.address]);
  const blocked = pending !== null || disabled;
  return <>
    <p className="kb-hint">This {noun} already contains a published configuration with {sharing.preview?.publishedBoards ?? 0} board{sharing.preview?.publishedBoards === 1 ? '' : 's'}. This Hub has {sharing.preview?.localBoards ?? hub.boards.length}. Choose which configuration becomes the shared one.</p>
    <p className="kb-share-meta"><span>{sharing.address}</span></p>
    <ComparisonList sharing={sharing} />
    {notice}
    <div className="kb-share-actions">
      <button type="button" className="kb-button kb-primary" disabled={blocked} onClick={() => void act('receive', { type: 'sharing.receive', hubId: hub.id })}>{pending === 'receive' ? 'Getting…' : 'Get the team configuration'}</button>
      {!confirmReplace
        ? <button type="button" className="kb-button" disabled={blocked} onClick={() => setConfirmReplace(true)}>Publish this Hub instead</button>
        : <><button type="button" className="kb-button kb-danger" disabled={blocked} onClick={() => void act('initial', { type: 'sharing.publishInitial', hubId: hub.id, confirmed: true })}>{pending === 'initial' ? 'Publishing…' : 'Replace the team configuration'}</button><button type="button" className="kb-button" onClick={() => setConfirmReplace(false)}>Cancel</button></>}
      <button type="button" className="kb-button" disabled={pending !== null} onClick={() => { setConfirmReplace(false); void act('disconnect', { type: 'sharing.disconnect', hubId: hub.id }); }}>Cancel connection</button>
    </div>
    {footnote}
    {confirmReplace && <p className="kb-hint" role="status">Replacing the team configuration overwrites the published boards with this Hub's boards.</p>}
    <Blockers blockers={sharing.blockers} />
    {sharing.error && <ErrorNotice problem={sharing.error} />}
  </>;
}

/** The check interval, shared by every connected storage. */
export function IntervalSettings({ hubId, sharing, act, pending }: { hubId: string; sharing: HubSharingView; act: Act; pending: string | null }) {
  const [interval, setIntervalMinutes] = useState(String(sharing.intervalMinutes));
  useEffect(() => { setIntervalMinutes(String(sharing.intervalMinutes)); }, [sharing.intervalMinutes]);
  return <form className="kb-share-form" onSubmit={event => { event.preventDefault(); void act('interval', { type: 'sharing.setInterval', hubId, intervalMinutes: Number(interval) }); }}>
    <label className="kb-field kb-share-interval">Check every (minutes)<input className="kb-input" aria-label="Check interval in minutes" type="number" min={0} max={1440} value={interval} disabled={pending !== null} onChange={event => setIntervalMinutes(event.target.value)} /></label>
    <button type="submit" className="kb-button" disabled={pending !== null}>{pending === 'interval' ? 'Saving…' : 'Save interval'}</button>
  </form>;
}

/** Disconnect with its confirmation and the storage's own explanation. */
export function DisconnectAction({ hubId, act, pending, note }: { hubId: string; act: Act; pending: string | null; note: string }) {
  const [confirm, setConfirm] = useState(false);
  return <>
    {!confirm
      ? <button type="button" className="kb-button kb-danger" disabled={pending !== null} onClick={() => setConfirm(true)}>Disconnect</button>
      : <><button type="button" className="kb-button kb-danger" disabled={pending !== null} onClick={() => void act('disconnect', { type: 'sharing.disconnect', hubId })}>{pending === 'disconnect' ? 'Disconnecting…' : 'Confirm disconnect'}</button><button type="button" className="kb-button" onClick={() => setConfirm(false)}>Cancel</button></>}
    {confirm && <p className="kb-hint" role="status">{note}</p>}
  </>;
}

/**
 * The surface every connected storage shares: status, blockers, the storage's
 * own actions, the check interval, and the per-board review.
 */
export function ConnectedStorageSurface({ hub, sharing, act, pending, summary, notice, actions, guidance, disconnectNote }: {
  hub: HubState; sharing: HubSharingView; act: Act; pending: string | null;
  summary?: React.ReactNode; notice?: React.ReactNode; actions: React.ReactNode;
  guidance?: React.ReactNode; disconnectNote: string;
}) {
  return <>
    <StatusLine sharing={sharing} />
    {summary && <p className="kb-share-meta">{summary}</p>}
    {notice}
    {sharing.error && <ErrorNotice problem={sharing.error} />}
    <Blockers blockers={sharing.blockers} />
    <div className="kb-share-actions">{actions}<DisconnectAction hubId={hub.id} act={act} pending={pending} note={disconnectNote} /></div>
    {guidance}
    <IntervalSettings hubId={hub.id} sharing={sharing} act={act} pending={pending} />
    <BoardReview hubId={hub.id} sharing={sharing} act={act} pending={pending} />
    <RemovedBoards hubId={hub.id} sharing={sharing} act={act} pending={pending} />
  </>;
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
