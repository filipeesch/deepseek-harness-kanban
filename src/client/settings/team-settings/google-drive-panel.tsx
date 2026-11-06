import React, { useEffect, useState } from 'react';
import type { HubSharingView, HubState, SharingAuthView } from '../../../shared/types.js';
import { ErrorNotice } from '../../ui.js';
import type { Act } from './shared.js';
import { Blockers, BoardReview, RemovedBoards, StatusLine, VersionDiff } from './shared.js';

export function GoogleDriveStoragePanel({ hub, sharing, auth, act, pending }: { hub: HubState; sharing?: HubSharingView; auth?: SharingAuthView; act: Act; pending: string | null }) {
  const [folderAddress, setFolderAddress] = useState('');
  const [driveId, setDriveId] = useState('');
  const [folderId, setFolderId] = useState('');
  const [folderName, setFolderName] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [interval, setIntervalMinutes] = useState(String(sharing?.intervalMinutes ?? 1));
  useEffect(() => { setConfirmDisconnect(false); setConfirmReplace(false); }, [sharing?.status, sharing?.address, auth?.status]);
  useEffect(() => { if (sharing) setIntervalMinutes(String(sharing.intervalMinutes)); }, [sharing?.intervalMinutes]);
  const status = auth?.status ?? 'not-connected';
  const account = auth?.email;
  const selectedDrive = auth?.drives?.find(value => value.id === driveId);

  if (!sharing) {
    if (status === 'authorizing') {
      const url = auth?.authorizationUrl;
      return <>
        <p className="kb-hint">Finish signing in to Google in the browser. This page updates when Google returns to the app.</p>
        <div className="kb-share-actions">
          {url && <a className="kb-button kb-primary" href={url} target="_blank" rel="noreferrer">Open Google sign-in</a>}
          <button type="button" className="kb-button" disabled={pending !== null} onClick={() => void act('auth-cancel', { type: 'sharing.auth.cancel' })}>{pending === 'auth-cancel' ? 'Canceling…' : 'Cancel'}</button>
        </div>
        {auth?.error && <ErrorNotice problem={auth.error} />}
      </>;
    }
    if (status === 'not-connected' || status === 'error' || status === 'reconnect-required') {
      return <>
        <p className="kb-hint">Connect a Google account to share this Hub's boards and workflows through My Drive or a Shared Drive. The plugin stores the authorization in the host credential store; projects, tasks, notes, and Hub names stay on this machine.</p>
        <div className="kb-share-actions">
          <button type="button" className="kb-button kb-primary" disabled={pending !== null} onClick={() => void act('auth-start', { type: 'sharing.auth.start' })}>{pending === 'auth-start' ? 'Starting…' : 'Connect Google Drive'}</button>
        </div>
        {auth?.error && <ErrorNotice problem={auth.error} />}
      </>;
    }
    return <>
      <p className="kb-share-meta"><span className="kb-share-status">Google account</span><span>{account ?? 'Connected'}</span></p>
      <div className="kb-share-actions">
        <button type="button" className="kb-button" disabled={pending !== null} onClick={() => void act('auth-drives', { type: 'sharing.drives' })}>{pending === 'auth-drives' ? 'Loading…' : 'Load Shared Drives'}</button>
        <button type="button" className="kb-button" disabled={pending !== null} onClick={() => void act('auth-switch', { type: 'sharing.auth.switch' })}>Switch account</button>
        <button type="button" className="kb-button kb-danger" disabled={pending !== null} onClick={() => void act('auth-disconnect', { type: 'sharing.auth.disconnect' })}>Disconnect account</button>
      </div>
      {auth?.drives && auth.drives.length > 0 && <label className="kb-field">Shared Drive<select className="kb-input" aria-label="Shared Drive" value={driveId} disabled={pending !== null} onChange={event => { setDriveId(event.target.value); setFolderId(''); setFolderName(''); }}>
        <option value="">My Drive</option>
        {auth.drives.map(drive => <option key={drive.id} value={drive.id}>{drive.name}</option>)}
      </select></label>}
      <div className="kb-share-actions">
        <button type="button" className="kb-button" disabled={pending !== null} onClick={() => void act('auth-folders', { type: 'sharing.folders', ...(driveId ? { driveId } : {}) })}>{pending === 'auth-folders' ? 'Loading…' : 'Load folders'}</button>
      </div>
      {auth?.folders && auth.folders.length > 0 && <label className="kb-field">Folder<select className="kb-input" aria-label="Google Drive folder" value={folderId} disabled={pending !== null} onChange={event => { const value = event.target.value; setFolderId(value); setFolderName(auth.folders?.find(folder => folder.id === value)?.name ?? ''); }}>
        <option value="">Choose a folder</option>
        {auth.folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
      </select></label>}
      <label className="kb-field">Folder link or ID<input className="kb-input" aria-label="Google Drive folder link or ID" placeholder="Paste a Drive folder link or id" value={folderAddress} disabled={pending !== null} onChange={event => setFolderAddress(event.target.value)} /></label>
      <p className="kb-hint">A Shared Drive is optional; leave it empty for My Drive. The plugin creates or adopts <code>kanban-hub.yaml</code> in the selected folder and never touches other files.</p>
      <div className="kb-share-actions">
        <button type="button" className="kb-button kb-primary" disabled={pending !== null || (!folderAddress.trim() && !folderId)} onClick={() => {
          const chosen = folderAddress.trim() || folderId;
          void act('connect', {
            type: 'sharing.connect', hubId: hub.id, provider: 'google-drive',
            settings: { folderId: chosen, ...(driveId ? { driveId } : {}), ...(folderName ? { folderName } : {}), ...(selectedDrive ? { driveName: selectedDrive.name } : {}) },
          });
        }}>{pending === 'connect' ? 'Connecting…' : 'Use this folder'}</button>
      </div>
      {auth?.error && <ErrorNotice problem={auth.error} />}
    </>;
  }

  const authReminder = status === 'connected' ? null : <div className="kb-share-actions">
    {status === 'authorizing' && auth?.authorizationUrl
      ? <a className="kb-button kb-primary" href={auth.authorizationUrl} target="_blank" rel="noreferrer">Open Google sign-in</a>
      : <button type="button" className="kb-button kb-primary" disabled={pending !== null} onClick={() => void act('auth-start', { type: 'sharing.auth.start' })}>{pending === 'auth-start' ? 'Starting…' : 'Reconnect Google Drive'}</button>}
    {status === 'authorizing' && <button type="button" className="kb-button" disabled={pending !== null} onClick={() => void act('auth-cancel', { type: 'sharing.auth.cancel' })}>Cancel</button>}
  </div>;
  const authHint = status === 'connected' ? null : <p className="kb-hint" role="status">{status === 'authorizing' ? 'Finish signing in to Google in the browser. This page updates when Google returns.' : 'Google Drive needs authorization before this Hub can synchronize. Local boards, workflows, and pending changes are kept.'}</p>;

  if (sharing.status === 'preview') {
    return <>
      <p className="kb-hint">This folder already contains a published configuration with {sharing.preview?.publishedBoards ?? 0} board{sharing.preview?.publishedBoards === 1 ? '' : 's'}. This Hub has {sharing.preview?.localBoards ?? hub.boards.length}. Choose which configuration becomes the shared one.</p>
      <p className="kb-share-meta"><span>{sharing.address}</span>{account && <span>{account}</span>}</p>
      <ul className="kb-share-boards" aria-label="Differences from the team configuration">
        {sharing.boards.filter(board => board.state === 'updates-available').map(board => <li key={board.boardId} className="kb-share-board"><div className="kb-share-board-main"><span className="kb-share-board-name">{board.name}</span><span className="kb-share-board-state">In both; the team version replaces the local one</span><VersionDiff detail={board.detail} /></div></li>)}
        {sharing.incoming.map(board => <li key={board.key} className="kb-share-board"><div className="kb-share-board-main"><span className="kb-share-board-name">{board.name}</span><span className="kb-share-board-state">Only in the team</span></div></li>)}
        {sharing.boards.filter(board => board.state === 'draft').map(board => <li key={board.boardId} className="kb-share-board"><div className="kb-share-board-main"><span className="kb-share-board-name">{board.name}</span><span className="kb-share-board-state">Only in this Hub</span></div></li>)}
      </ul>
      {authReminder}{authHint}
      {auth?.error && <ErrorNotice problem={auth.error} />}
      <div className="kb-share-actions">
        <button type="button" className="kb-button kb-primary" disabled={pending !== null || status !== 'connected'} onClick={() => void act('receive', { type: 'sharing.receive', hubId: hub.id })}>{pending === 'receive' ? 'Getting…' : 'Get the team configuration'}</button>
        {!confirmReplace ? <button type="button" className="kb-button" disabled={pending !== null || status !== 'connected'} onClick={() => setConfirmReplace(true)}>Publish this Hub instead</button>
          : <><button type="button" className="kb-button kb-danger" disabled={pending !== null || status !== 'connected'} onClick={() => void act('initial', { type: 'sharing.publishInitial', hubId: hub.id, confirmed: true })}>{pending === 'initial' ? 'Publishing…' : 'Replace the team configuration'}</button><button type="button" className="kb-button" onClick={() => setConfirmReplace(false)}>Cancel</button></>}
        <button type="button" className="kb-button" disabled={pending !== null} onClick={() => void act('disconnect', { type: 'sharing.disconnect', hubId: hub.id })}>Cancel connection</button>
      </div>
      {confirmReplace && <p className="kb-hint" role="status">Replacing the team configuration overwrites the published boards with this Hub's boards.</p>}
      <Blockers blockers={sharing.blockers} />
      {sharing.error && <ErrorNotice problem={sharing.error} />}
    </>;
  }

  return <>
    <StatusLine sharing={sharing} />
    <p className="kb-share-meta">{account && <span>{account}</span>}{sharing.pending > 0 && <span>{sharing.pending} pending</span>}{sharing.conflicts > 0 && <span>{sharing.conflicts} to review</span>}{sharing.lastSyncedAt && <span>Last sync {new Date(sharing.lastSyncedAt).toLocaleString()}</span>}</p>
    {authReminder}{authHint}
    {auth?.error && <ErrorNotice problem={auth.error} />}
    {sharing.error && <ErrorNotice problem={sharing.error} />}
    <Blockers blockers={sharing.blockers} />
    <div className="kb-share-actions">
      <button type="button" className={'kb-button ' + (sharing.pending > 0 || sharing.updates > 0 ? 'kb-primary' : '')} disabled={pending !== null || status !== 'connected'} onClick={() => void act('sync', { type: 'sharing.check', hubId: hub.id })}>{pending === 'sync' ? 'Syncing…' : 'Sync now'}</button>
      {sharing.conflicts > 0 && <span className="kb-share-board-state">Review the boards below.</span>}
      <button type="button" className="kb-button" disabled={pending !== null} onClick={() => void act('auth-switch', { type: 'sharing.auth.switch' })}>Switch account</button>
      {!confirmDisconnect ? <button type="button" className="kb-button kb-danger" disabled={pending !== null} onClick={() => setConfirmDisconnect(true)}>Disconnect</button>
        : <><button type="button" className="kb-button kb-danger" disabled={pending !== null} onClick={() => void act('disconnect', { type: 'sharing.disconnect', hubId: hub.id })}>{pending === 'disconnect' ? 'Disconnecting…' : 'Confirm disconnect'}</button><button type="button" className="kb-button" onClick={() => setConfirmDisconnect(false)}>Cancel</button></>}
    </div>
    {confirmDisconnect && <p className="kb-hint" role="status">Disconnecting stops automatic synchronization and removes this Hub's binding. The team document and every other file in the folder remain, and local boards, workflows, tasks, notes, and projects stay on this machine.</p>}
    <form className="kb-share-form" onSubmit={event => { event.preventDefault(); void act('interval', { type: 'sharing.setInterval', hubId: hub.id, intervalMinutes: Number(interval) }); }}>
      <label className="kb-field kb-share-interval">Check every (minutes)<input className="kb-input" aria-label="Check interval in minutes" type="number" min={0} max={1440} value={interval} disabled={pending !== null} onChange={event => setIntervalMinutes(event.target.value)} /></label>
      <button type="submit" className="kb-button" disabled={pending !== null}>{pending === 'interval' ? 'Saving…' : 'Save interval'}</button>
    </form>
    <BoardReview hubId={hub.id} sharing={sharing} act={act} pending={pending} />
    <RemovedBoards hubId={hub.id} sharing={sharing} act={act} pending={pending} />
  </>;
}
