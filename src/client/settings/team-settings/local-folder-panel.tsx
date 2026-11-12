import React, { useEffect, useState } from 'react';
import type { HubSharingView, HubState, Problem } from '../../../shared/types.js';
import { useDirectoryPicker } from '../../services.js';
import { asProblem, ErrorNotice } from '../../ui.js';
import type { Act } from './shared.js';
import { ConnectionPreview } from './shared.js';

/** The folder the plugin proposes for this Hub; only this one may be created on connect. */
export function suggestedFolder(hubId: string): string {
  return '~/.dsh-kanban/' + hubId;
}

/** The local folder connection surface: a path and a check interval. */
export function LocalFolderStoragePanel({ hub, sharing, act, pending }: { hub: HubState; sharing?: HubSharingView; act: Act; pending: string | null }) {
  const suggested = suggestedFolder(hub.id);
  const [folder, setFolder] = useState(sharing?.address ?? suggested);
  const [interval, setIntervalMinutes] = useState('1');
  const [browseError, setBrowseError] = useState<Problem | null>(null);
  const picker = useDirectoryPicker();
  useEffect(() => { setFolder(sharing?.address ?? suggested); }, [sharing?.address, suggested]);
  if (sharing?.status === 'preview') {
    return <ConnectionPreview
      hub={hub} sharing={sharing} act={act} pending={pending} noun="folder"
      footnote={<p className="kb-hint">Getting the team boards adopts the team version for boards that exist on both sides and keeps local-only boards as drafts.</p>}
    />;
  }
  if (sharing !== undefined) return null;
  async function browse() {
    if (!picker) return;
    setBrowseError(null);
    try { const picked = await picker.pick(); if (picked) setFolder(picked); }
    catch (error) { setBrowseError(asProblem(error)); }
  }
  return <>
    <p className="kb-hint">Share through a folder a desktop client already synchronizes, such as Google Drive, OneDrive, or Dropbox.</p>
    <label className="kb-field">Folder<div className="kb-input-row">
      <input className="kb-input" aria-label="Team folder path" placeholder={suggested} value={folder} disabled={pending !== null} onChange={event => setFolder(event.target.value)} />
      <button type="button" className="kb-button" aria-label="Browse for the team folder" disabled={pending !== null || !picker} onClick={() => void browse()}>Browse…</button>
    </div></label>
    <label className="kb-field kb-share-interval">Check every (minutes)<input className="kb-input" aria-label="Check interval in minutes" type="number" min={0} max={1440} value={interval} disabled={pending !== null} onChange={event => setIntervalMinutes(event.target.value)} /></label>
    <div className="kb-share-actions">
      <button type="button" className="kb-button kb-primary" disabled={pending !== null || !folder.trim()} onClick={() => void act('connect', { type: 'sharing.connect', hubId: hub.id, provider: 'local-folder', settings: { path: folder.trim() }, intervalMinutes: Number(interval) })}>{pending === 'connect' ? 'Connecting…' : 'Connect'}</button>
    </div>
    <p className="kb-hint">Suggested: <code>{suggested}</code>. The plugin creates only that folder, and only when you connect to it.</p>
    <ErrorNotice problem={browseError} />
  </>;
}
