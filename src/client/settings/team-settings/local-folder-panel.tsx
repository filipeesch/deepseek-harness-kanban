import React, { useEffect, useState } from 'react';
import type { HubSharingView, HubState, Problem } from '../../../shared/types.js';
import { useDirectoryPicker } from '../../services.js';
import { asProblem, ErrorNotice } from '../../ui.js';
import type { Act } from './shared.js';
import { ConnectedStorageSurface, ConnectionPreview } from './shared.js';

const DISCONNECT_NOTE = 'Disconnecting stops automatic synchronization and removes this Hub’s binding. The folder, its kanban-hub.yaml, and every other file remain, and local boards, workflows, tasks, notes, and projects stay on this machine.';

/** The folder the plugin proposes for this Hub; only this one may be created on connect. */
export function suggestedFolder(hubId: string): string {
  return '~/.dsh-kanban/' + hubId;
}

export function LocalFolderStoragePanel({ hub, sharing, act, pending }: { hub: HubState; sharing?: HubSharingView; act: Act; pending: string | null }) {
  const suggested = suggestedFolder(hub.id);
  const [folder, setFolder] = useState(sharing?.address ?? suggested);
  const [interval, setIntervalMinutes] = useState(String(sharing?.intervalMinutes ?? 1));
  const [browseError, setBrowseError] = useState<Problem | null>(null);
  const picker = useDirectoryPicker();
  useEffect(() => { setFolder(sharing?.address ?? suggested); }, [sharing?.address, suggested]);

  async function browse() {
    if (!picker) return;
    setBrowseError(null);
    try {
      const picked = await picker.pick();
      if (picked) setFolder(picked);
    } catch (error) { setBrowseError(asProblem(error)); }
  }

  if (!sharing) {
    return <>
      <p className="kb-hint">Keep this Hub's boards and workflows aligned through a folder on this machine. Put that folder inside Google Drive for desktop, OneDrive, Dropbox, or any other synchronization client, and the client shares it for you. Projects, tasks, notes, and Hub names stay on this machine.</p>
      <label className="kb-field">Folder<div className="kb-input-row">
        <input className="kb-input" aria-label="Team folder path" placeholder={suggested} value={folder} disabled={pending !== null} onChange={event => setFolder(event.target.value)} />
        <button type="button" className="kb-button" aria-label="Browse for the team folder" disabled={pending !== null || !picker} onClick={() => void browse()}>Browse…</button>
      </div></label>
      <label className="kb-field kb-share-interval">Check every (minutes)<input className="kb-input" aria-label="Check interval in minutes" type="number" min={0} max={1440} value={interval} disabled={pending !== null} onChange={event => setIntervalMinutes(event.target.value)} /></label>
      <div className="kb-share-actions">
        <button type="button" className="kb-button kb-primary" disabled={pending !== null || !folder.trim()} onClick={() => void act('connect', { type: 'sharing.connect', hubId: hub.id, provider: 'local-folder', settings: { path: folder.trim() }, intervalMinutes: Number(interval) })}>{pending === 'connect' ? 'Connecting…' : 'Connect'}</button>
      </div>
      <p className="kb-hint">Suggested: <code>{suggested}</code>. The plugin creates that folder when you connect to it; any other folder must already exist and be writable. The plugin creates or adopts <code>kanban-hub.yaml</code> there and never touches another file.</p>
      <p className="kb-hint">The synchronization client copies the folder between machines, so a change made elsewhere arrives when the client finishes downloading it. Save your edits and let the client settle before connecting another machine.</p>
      <ErrorNotice problem={browseError} />
    </>;
  }

  if (sharing.status === 'preview') {
    return <ConnectionPreview
      hub={hub} sharing={sharing} act={act} pending={pending} noun="folder"
      footnote={<p className="kb-hint">Getting the team configuration adopts the team version for boards that exist on both sides and keeps local-only boards as drafts. Replacing the team configuration overwrites the published boards with this Hub's boards.</p>}
    />;
  }

  const review = sharing.blockers.find(blocker => blocker.code === 'SHARING_CONFLICT_COPY');
  return <ConnectedStorageSurface
    hub={hub} sharing={sharing} act={act} pending={pending}
    summary={<>{sharing.pending > 0 && <span>{sharing.pending} pending</span>}{sharing.conflicts > 0 && <span>{sharing.conflicts} to review</span>}{sharing.lastSyncedAt && <span>Last sync {new Date(sharing.lastSyncedAt).toLocaleString()}</span>}</>}
    actions={<button type="button" className={'kb-button ' + (sharing.pending > 0 || sharing.updates > 0 ? 'kb-primary' : '')} disabled={pending !== null} onClick={() => void act('sync', { type: 'sharing.check', hubId: hub.id })}>{pending === 'sync' ? 'Syncing…' : 'Sync now'}</button>}
    guidance={review
      ? <p className="kb-hint" role="status">Decide which version is current, then delete or rename the other copies in the folder. The Hub synchronizes again after the next check finds them gone.</p>
      : sharing.conflicts > 0 ? <p className="kb-hint" role="status">Review the boards below.</p> : null}
    disconnectNote={DISCONNECT_NOTE}
  />;
}
