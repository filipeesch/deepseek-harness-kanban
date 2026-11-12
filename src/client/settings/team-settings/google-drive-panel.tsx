import React, { useEffect, useState } from 'react';
import type { HubSharingView, HubState, SharingAuthView } from '../../../shared/types.js';
import { ErrorNotice } from '../../ui.js';
import type { Act } from './shared.js';
import { ConnectionPreview } from './shared.js';

/** The Google Drive Cloud connection surface: account authorization, then a folder. */
export function GoogleDriveStoragePanel({ hub, sharing, auth, act, pending }: { hub: HubState; sharing?: HubSharingView; auth?: SharingAuthView; act: Act; pending: string | null }) {
  const [folderAddress, setFolderAddress] = useState('');
  const [driveId, setDriveId] = useState('');
  const [folderId, setFolderId] = useState('');
  const [folderName, setFolderName] = useState('');
  useEffect(() => { setFolderId(''); setFolderName(''); }, [driveId, auth?.status]);
  const status = auth?.status ?? 'not-connected';
  const account = auth?.email;
  const selectedDrive = auth?.drives?.find(value => value.id === driveId);
  if (sharing?.status === 'preview') {
    return <ConnectionPreview
      hub={hub} sharing={sharing} act={act} pending={pending} noun="folder" disabled={status !== 'connected'}
      notice={<>{account && <p className="kb-share-meta"><span>{account}</span></p>}{status !== 'connected' && <p className="kb-hint" role="status">Google Drive needs authorization before this Hub can synchronize.</p>}{auth?.error && <ErrorNotice problem={auth.error} />}</>}
    />;
  }
  if (sharing !== undefined) {
    // Bound: the account and any authorization problem belong to the connection area.
    if (status === 'connected' && auth?.error === undefined) return null;
    return <>
      {account && <p className="kb-share-meta"><span>{account}</span></p>}
      {status === 'authorizing' && auth?.authorizationUrl && <a className="kb-button kb-primary" href={auth.authorizationUrl} target="_blank" rel="noreferrer">Open Google sign-in</a>}
      {status !== 'authorizing' && <button type="button" className="kb-button kb-primary" disabled={pending !== null} onClick={() => void act('auth-start', { type: 'sharing.auth.start' })}>{pending === 'auth-start' ? 'Starting…' : 'Reconnect Google Drive'}</button>}
      {status !== 'connected' && <p className="kb-hint" role="status">Google Drive needs authorization before this Hub can synchronize. Local changes are kept.</p>}
      {auth?.error && <ErrorNotice problem={auth.error} />}
    </>;
  }
  if (status === 'authorizing') {
    return <>
      <p className="kb-hint">Finish signing in to Google in the browser. This page updates when Google returns to the app.</p>
      <div className="kb-share-actions">
        {auth?.authorizationUrl && <a className="kb-button kb-primary" href={auth.authorizationUrl} target="_blank" rel="noreferrer">Open Google sign-in</a>}
        <button type="button" className="kb-button" disabled={pending !== null} onClick={() => void act('auth-cancel', { type: 'sharing.auth.cancel' })}>{pending === 'auth-cancel' ? 'Canceling…' : 'Cancel'}</button>
      </div>
      {auth?.error && <ErrorNotice problem={auth.error} />}
    </>;
  }
  if (status === 'not-connected' || status === 'error' || status === 'reconnect-required') {
    return <>
      <p className="kb-hint">Connect a Google account to share this Hub through My Drive or a Shared Drive.</p>
      <div className="kb-share-actions">
        <button type="button" className="kb-button kb-primary" disabled={pending !== null} onClick={() => void act('auth-start', { type: 'sharing.auth.start' })}>{pending === 'auth-start' ? 'Starting…' : 'Connect Google Drive'}</button>
      </div>
      {auth?.error && <ErrorNotice problem={auth.error} />}
    </>;
  }
  return <>
    <p className="kb-share-meta"><span>{account ?? 'Connected'}</span></p>
    <div className="kb-share-actions">
      <button type="button" className="kb-button" disabled={pending !== null} onClick={() => void act('auth-drives', { type: 'sharing.drives' })}>{pending === 'auth-drives' ? 'Loading…' : 'Load Shared Drives'}</button>
      <button type="button" className="kb-button" disabled={pending !== null} onClick={() => void act('auth-disconnect', { type: 'sharing.auth.disconnect' })}>Disconnect account</button>
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
    <div className="kb-share-actions">
      <button type="button" className="kb-button kb-primary" disabled={pending !== null || (!folderAddress.trim() && !folderId)} onClick={() => {
        const chosen = folderAddress.trim() || folderId;
        void act('connect', {
          type: 'sharing.connect', hubId: hub.id, provider: 'google-drive',
          settings: { folderId: chosen, ...(driveId ? { driveId } : {}), ...(folderName ? { folderName } : {}), ...(selectedDrive ? { driveName: selectedDrive.name } : {}) },
        });
      }}>{pending === 'connect' ? 'Connecting…' : 'Use this folder'}</button>
    </div>
    <p className="kb-hint">The plugin creates or adopts the layout in the selected folder and touches nothing else.</p>
    {auth?.error && <ErrorNotice problem={auth.error} />}
  </>;
}
