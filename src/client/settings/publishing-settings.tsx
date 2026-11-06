import React, { useEffect, useState } from 'react';
import type { ClientApi, HubSharingView, HubState, Problem, SharingCommand } from '../../shared/types.js';
import { asProblem, ErrorNotice } from '../ui.js';
import { BOARD_STATE_LABEL, HUB_STATUS_LABEL } from '../sharing/status.js';

/** One publishing surface: connection, status, per-board review, and the publishing actions. */
export function PublishingSettings({ hub, sharing, api }: { hub: HubState; sharing?: HubSharingView; api?: ClientApi }) {
  const [repository, setRepository] = useState(sharing?.repository ?? '');
  const [interval, setIntervalMinutes] = useState(String(sharing?.intervalMinutes ?? 5));
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<Problem | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  // Connection lifecycles reset the destructive confirmations; an armed Replace
  // must never survive a reconnect into a different repository.
  useEffect(() => { setConfirmReplace(false); setConfirmDisconnect(false); }, [sharing?.status, sharing?.repository]);

  async function act(label: string, command: SharingCommand): Promise<boolean> {
    if (!api) { setError({ code: 'SHARING_UNAVAILABLE', message: 'Publishing is unavailable in this view.' }); return false; }
    setPending(label); setError(null);
    try { await api.sharing(command); return true; }
    catch (failure) { setError(asProblem(failure)); return false; }
    finally { setPending(null); }
  }

  const status = sharing?.status ?? 'not-published';
  const errorBlockers = error !== null && Array.isArray(error.details?.blockers)
    ? (error.details.blockers as Array<{ code: string; message: string }>)
    : [];
  const published = sharing !== undefined && status !== 'not-published' && status !== 'preview';
  const attention = (sharing?.updates ?? 0) + (sharing?.conflicts ?? 0) + (sharing?.blockers.length ?? 0) > 0;

  return <div className="kb-form" aria-label="Publishing settings">
    <h3>Publishing</h3>
    {status === 'not-published' && !sharing && <>
      <p className="kb-hint">Keep this Hub's boards and workflows aligned with your team through a shared configuration. Projects, tasks, notes, and Hub names stay on this machine.</p>
      <form className="kb-share-form" onSubmit={event => { event.preventDefault(); if (repository.trim()) void act('connect', { type: 'sharing.connect', hubId: hub.id, repository: repository.trim(), intervalMinutes: Number(interval) }); }}>
        <label className="kb-field">Provider<select className="kb-input" aria-label="Publishing provider" disabled value="git"><option value="git">Git repository</option></select></label>
        <label className="kb-field">Repository address<input className="kb-input" aria-label="Repository address" placeholder="https:// or an absolute path" value={repository} disabled={pending !== null} onChange={event => setRepository(event.target.value)} /></label>
        <label className="kb-field kb-share-interval">Check every (minutes)<input className="kb-input" aria-label="Check interval in minutes" type="number" min={0} max={1440} value={interval} disabled={pending !== null} onChange={event => setIntervalMinutes(event.target.value)} /></label>
        <button type="submit" className="kb-button kb-primary" disabled={pending !== null || !repository.trim()}>{pending === 'connect' ? 'Connecting…' : 'Connect'}</button>
      </form>
      <p className="kb-hint">The plugin creates a managed local copy of the repository. Credentials come from Git on this machine; no secret is stored. Set the interval to 0 to check only when you ask.</p>
      <ErrorNotice problem={error} />
    </>}

    {status === 'preview' && sharing && <>
      <p className="kb-hint">This repository already contains a published configuration with {sharing.preview?.publishedBoards ?? 0} board{sharing.preview?.publishedBoards === 1 ? '' : 's'}. This Hub has {sharing.preview?.localBoards ?? hub.boards.length}. Choose which configuration becomes the shared one.</p>
      <ul className="kb-share-boards" aria-label="Differences from the team configuration">
        {sharing.boards.filter(board => board.state === 'updates-available').map(board => <li key={board.boardId} className="kb-share-board"><div className="kb-share-board-main"><span className="kb-share-board-name">{board.name}</span><span className="kb-share-board-state">In both; the team version replaces the local one</span><VersionDiff detail={board.detail} /></div></li>)}
        {sharing.incoming.map(board => <li key={board.key} className="kb-share-board"><div className="kb-share-board-main"><span className="kb-share-board-name">{board.name}</span><span className="kb-share-board-state">Only in the team</span></div></li>)}
        {sharing.boards.filter(board => board.state === 'draft').map(board => <li key={board.boardId} className="kb-share-board"><div className="kb-share-board-main"><span className="kb-share-board-name">{board.name}</span><span className="kb-share-board-state">Only in this Hub</span></div></li>)}
      </ul>
      <p className="kb-share-meta"><span>{sharing.repository}</span></p>
      <div className="kb-share-actions">
        <button type="button" className="kb-button kb-primary" disabled={pending !== null} onClick={() => void act('receive', { type: 'sharing.receive', hubId: hub.id })}>{pending === 'receive' ? 'Getting…' : 'Get the team configuration'}</button>
        {!confirmReplace ? <button type="button" className="kb-button" disabled={pending !== null} onClick={() => setConfirmReplace(true)}>Publish this Hub instead</button>
          : <><button type="button" className="kb-button kb-danger" disabled={pending !== null} onClick={() => void act('initial', { type: 'sharing.publishInitial', hubId: hub.id, confirmed: true })}>{pending === 'initial' ? 'Publishing…' : 'Replace the team configuration'}</button><button type="button" className="kb-button" onClick={() => setConfirmReplace(false)}>Cancel</button></>}
        <button type="button" className="kb-button" disabled={pending !== null} onClick={() => { setConfirmReplace(false); void act('disconnect', { type: 'sharing.disconnect', hubId: hub.id }); }}>Cancel connection</button>
      </div>
      <p className="kb-hint">Getting the team configuration adopts the team version for boards that exist on both sides and keeps local-only boards as drafts. Replacing the team configuration overwrites the published boards with this Hub's boards.</p>
      {confirmReplace && <p className="kb-hint">Replacing the team configuration overwrites the published boards with this Hub's boards.</p>}
      <Blockers blockers={sharing.blockers.length > 0 ? sharing.blockers : errorBlockers} />
      <ErrorNotice problem={error} />
    </>}

    {published && sharing && <>
      <p className="kb-share-meta"><span className={'kb-share-status' + (attention || sharing.drafts > 0 ? ' is-attention' : '')}>{HUB_STATUS_LABEL[status]}</span><span>Provider: {sharing.provider === 'git' ? 'Git' : sharing.provider}</span><span>{sharing.repository}</span>{sharing.lastCheckedAt && <span>Checked {new Date(sharing.lastCheckedAt).toLocaleString()}</span>}<span>Every {sharing.intervalMinutes === 0 ? 'manual check only' : sharing.intervalMinutes + ' min'}</span></p>
      {sharing.error && <ErrorNotice problem={sharing.error} />}
      <Blockers blockers={sharing.blockers.length > 0 ? sharing.blockers : errorBlockers} />
      <div className="kb-share-actions">
        <button type="button" className="kb-button" disabled={pending !== null} onClick={() => void act('refresh', { type: 'sharing.check', hubId: hub.id })}>{pending === 'refresh' ? 'Checking…' : 'Refresh'}</button>
        <button type="button" className={'kb-button ' + (sharing.updates > 0 ? 'kb-primary' : '')} disabled={pending !== null || sharing.updates === 0} onClick={() => void act('updates', { type: 'sharing.getUpdates', hubId: hub.id })}>{pending === 'updates' ? 'Getting…' : 'Get updates' + (sharing.updates > 0 ? ' (' + sharing.updates + ')' : '')}</button>
        <button type="button" className={'kb-button ' + (sharing.drafts > 0 && sharing.updates === 0 && sharing.conflicts === 0 ? 'kb-primary' : '')} disabled={pending !== null || sharing.drafts === 0 || sharing.updates > 0 || sharing.conflicts > 0} onClick={() => void act('publish', { type: 'sharing.publish', hubId: hub.id })}>{pending === 'publish' ? 'Publishing…' : 'Publish' + (sharing.drafts > 0 ? ' (' + sharing.drafts + ')' : '')}</button>
        {!confirmDisconnect ? <button type="button" className="kb-button kb-danger" disabled={pending !== null} onClick={() => setConfirmDisconnect(true)}>Disconnect</button>
          : <><button type="button" className="kb-button kb-danger" disabled={pending !== null} onClick={() => void act('disconnect', { type: 'sharing.disconnect', hubId: hub.id })}>{pending === 'disconnect' ? 'Disconnecting…' : 'Confirm disconnect'}</button><button type="button" className="kb-button" onClick={() => setConfirmDisconnect(false)}>Cancel</button></>}
      </div>
      {confirmDisconnect && <p className="kb-hint" role="status">Disconnecting stops automatic checks and removes the local copy of the repository. Boards, workflows, tasks, notes, and projects stay on this machine. The team's published configuration is unchanged.</p>}
      {sharing.updates > 0 && <p className="kb-hint">Get the team updates before publishing. Publishing is unavailable while the team has changes you have not reviewed.</p>}
      <form className="kb-share-form" onSubmit={event => { event.preventDefault(); void act('interval', { type: 'sharing.setInterval', hubId: hub.id, intervalMinutes: Number(interval) }); }}>
        <label className="kb-field kb-share-interval">Check every (minutes)<input className="kb-input" aria-label="Check interval in minutes" type="number" min={0} max={1440} value={interval} disabled={pending !== null} onChange={event => setIntervalMinutes(event.target.value)} /></label>
        <button type="submit" className="kb-button" disabled={pending !== null}>{pending === 'interval' ? 'Saving…' : 'Save interval'}</button>
      </form>

      <h4>Boards</h4>
      <ul className="kb-share-boards" aria-label="Published boards">
        {sharing.boards.map(board => <li key={board.boardId} className="kb-share-board">
          <div className="kb-share-board-main"><span className="kb-share-board-name">{board.name}</span><span className="kb-share-board-state">{BOARD_STATE_LABEL[board.state] ?? board.state}</span>
            <VersionDiff detail={board.detail} />
          </div>
          <div className="kb-share-actions">
            {board.state === 'needs-review' && board.key !== undefined && <>
              <button type="button" className="kb-button" disabled={pending !== null} onClick={() => void act('resolve-team', { type: 'sharing.resolve', hubId: hub.id, boardId: board.boardId, choice: 'team' })}>Use the team version</button>
              <button type="button" className="kb-button" disabled={pending !== null} onClick={() => void act('resolve-local', { type: 'sharing.resolve', hubId: hub.id, boardId: board.boardId, choice: 'local' })}>Keep the local version</button>
            </>}
            {board.state === 'needs-review' && board.key === undefined && <span className="kb-share-board-state">A local board already uses this name. Rename or publish it first.</span>}
            {board.state === 'needs-review' && board.key !== undefined && <span className="kb-share-board-state">The team version replaces this board's local draft; the local version stays a draft to publish.</span>}
            {board.state === 'orphan' && !board.pending && <button type="button" className="kb-button" disabled={pending !== null} onClick={() => void act('orphan', { type: 'sharing.publishOrphan', hubId: hub.id, boardId: board.boardId })}>Publish as a new board</button>}
          </div>
        </li>)}
      </ul>
      {sharing.incoming.length > 0 && <p className="kb-hint" role="status">New from the team: {sharing.incoming.map(board => board.name).join(', ')}. Get updates to add {sharing.incoming.length === 1 ? 'it' : 'them'}.</p>}
      {sharing.orderChanged && <p className="kb-hint" role="status">The team changed the board order. Get updates to apply it.</p>}
      {sharing.removing.length > 0 && <p className="kb-hint" role="status">Removed by the team with no local work: {sharing.removing.map(board => board.name).join(', ')}. Get updates to remove {sharing.removing.length === 1 ? 'it' : 'them'} here.</p>}
      {sharing.boards.some(board => board.state === 'orphan' && board.pending) && <p className="kb-hint" role="status">The team removed a board that still has local work. Get updates to keep it as an orphan.</p>}
      {sharing.removed.length > 0 && <>
        <h4>Removed only here</h4>
        <ul className="kb-share-boards" aria-label="Boards removed only from this installation">
          {sharing.removed.map(board => <li key={board.key} className="kb-share-board">
            <div className="kb-share-board-main"><span className="kb-share-board-name">{board.name}</span><span className="kb-share-board-state">Removed here</span></div>
            <div className="kb-share-actions"><button type="button" className="kb-button" disabled={pending !== null} onClick={() => void act('restore', { type: 'sharing.restore', hubId: hub.id, boardId: board.boardId })}>Restore</button></div>
          </li>)}
        </ul>
      </>}
      <ErrorNotice problem={error} />
    </>}
  </div>;
}

function VersionDiff({ detail }: { detail?: { local: string; team: string; localName: string; teamName: string } }) {
  if (!detail) return null;
  return <details className="kb-share-diff"><summary>Compare the workflow versions</summary><div className="kb-share-diff-body">
    <div><h5>This machine: {detail.localName}</h5><pre>{detail.local}</pre></div>
    <div><h5>Team: {detail.teamName}</h5><pre>{detail.team}</pre></div>
  </div></details>;
}

function Blockers({ blockers }: { blockers: Array<{ code: string; message: string }> }) {
  if (blockers.length === 0) return null;
  return <ul className="kb-share-blockers" aria-label="Publishing blockers">
    {blockers.map((blocker, index) => <li key={blocker.code + ':' + index}><code>{blocker.code}</code> {blocker.message}</li>)}
  </ul>;
}
