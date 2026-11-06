import React, { useEffect, useState } from 'react';
import type { HubSharingView, HubState, Problem } from '../../../shared/types.js';
import { ErrorNotice } from '../../ui.js';
import type { Act } from './shared.js';
import { Blockers, BoardReview, RemovedBoards, StatusLine, VersionDiff } from './shared.js';

export function GitStoragePanel({ hub, sharing, act, pending }: { hub: HubState; sharing?: HubSharingView; act: Act; pending: string | null }) {
  const [repository, setRepository] = useState(sharing?.address ?? sharing?.repository ?? '');
  const [interval, setIntervalMinutes] = useState(String(sharing?.intervalMinutes ?? 5));
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  useEffect(() => { setConfirmReplace(false); setConfirmDisconnect(false); }, [sharing?.status, sharing?.address]);

  if (!sharing) {
    return <>
      <p className="kb-hint">Keep this Hub's boards and workflows aligned with your team through a Git repository. Projects, tasks, notes, and Hub names stay on this machine.</p>
      <form className="kb-share-form" onSubmit={event => { event.preventDefault(); if (repository.trim()) void act('connect', { type: 'sharing.connect', hubId: hub.id, provider: 'git', settings: { repository: repository.trim() }, intervalMinutes: Number(interval) }); }}>
        <label className="kb-field">Repository address<input className="kb-input" aria-label="Repository address" placeholder="https:// or an absolute path" value={repository} disabled={pending !== null} onChange={event => setRepository(event.target.value)} /></label>
        <label className="kb-field kb-share-interval">Check every (minutes)<input className="kb-input" aria-label="Check interval in minutes" type="number" min={0} max={1440} value={interval} disabled={pending !== null} onChange={event => setIntervalMinutes(event.target.value)} /></label>
        <button type="submit" className="kb-button kb-primary" disabled={pending !== null || !repository.trim()}>{pending === 'connect' ? 'Connecting…' : 'Connect'}</button>
      </form>
      <p className="kb-hint">The plugin creates a managed local copy of the repository. Credentials come from Git on this machine; no secret is stored. Set the interval to 0 to check only when you ask.</p>
    </>;
  }

  if (sharing.status === 'preview') {
    return <>
      <p className="kb-hint">This repository already contains a published configuration with {sharing.preview?.publishedBoards ?? 0} board{sharing.preview?.publishedBoards === 1 ? '' : 's'}. This Hub has {sharing.preview?.localBoards ?? hub.boards.length}. Choose which configuration becomes the shared one.</p>
      <ul className="kb-share-boards" aria-label="Differences from the team configuration">
        {sharing.boards.filter(board => board.state === 'updates-available').map(board => <li key={board.boardId} className="kb-share-board"><div className="kb-share-board-main"><span className="kb-share-board-name">{board.name}</span><span className="kb-share-board-state">In both; the team version replaces the local one</span><VersionDiff detail={board.detail} /></div></li>)}
        {sharing.incoming.map(board => <li key={board.key} className="kb-share-board"><div className="kb-share-board-main"><span className="kb-share-board-name">{board.name}</span><span className="kb-share-board-state">Only in the team</span></div></li>)}
        {sharing.boards.filter(board => board.state === 'draft').map(board => <li key={board.boardId} className="kb-share-board"><div className="kb-share-board-main"><span className="kb-share-board-name">{board.name}</span><span className="kb-share-board-state">Only in this Hub</span></div></li>)}
      </ul>
      <p className="kb-share-meta"><span>{sharing.address}</span></p>
      <div className="kb-share-actions">
        <button type="button" className="kb-button kb-primary" disabled={pending !== null} onClick={() => void act('receive', { type: 'sharing.receive', hubId: hub.id })}>{pending === 'receive' ? 'Getting…' : 'Get the team configuration'}</button>
        {!confirmReplace ? <button type="button" className="kb-button" disabled={pending !== null} onClick={() => setConfirmReplace(true)}>Publish this Hub instead</button>
          : <><button type="button" className="kb-button kb-danger" disabled={pending !== null} onClick={() => void act('initial', { type: 'sharing.publishInitial', hubId: hub.id, confirmed: true })}>{pending === 'initial' ? 'Publishing…' : 'Replace the team configuration'}</button><button type="button" className="kb-button" onClick={() => setConfirmReplace(false)}>Cancel</button></>}
        <button type="button" className="kb-button" disabled={pending !== null} onClick={() => { setConfirmReplace(false); void act('disconnect', { type: 'sharing.disconnect', hubId: hub.id }); }}>Cancel connection</button>
      </div>
      <p className="kb-hint">Getting the team configuration adopts the team version for boards that exist on both sides and keeps local-only boards as drafts. Replacing the team configuration overwrites the published boards with this Hub's boards.</p>
      <Blockers blockers={sharing.blockers} />
      {sharing.error && <ErrorNotice problem={sharing.error} />}
    </>;
  }

  return <>
    <StatusLine sharing={sharing} />
    {sharing.error && <ErrorNotice problem={sharing.error} />}
    <Blockers blockers={sharing.blockers} />
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
    <BoardReview hubId={hub.id} sharing={sharing} act={act} pending={pending} />
    <RemovedBoards hubId={hub.id} sharing={sharing} act={act} pending={pending} />
    {confirmReplace && <p className="kb-hint">Replacing the team configuration overwrites the published boards with this Hub's boards.</p>}
  </>;
}

export function GitProblem({ error }: { error: Problem | null }) { return <ErrorNotice problem={error} />; }
