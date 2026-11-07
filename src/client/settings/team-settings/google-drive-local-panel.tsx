import React, { useEffect, useMemo, useState } from 'react';
import type { ClientApi, DriveDiscoveryView, HubSharingView, HubState, Problem } from '../../../shared/types.js';
import { ReopenIcon } from '../../icons.js';
import { useDirectoryPicker } from '../../services.js';
import { asProblem, ErrorNotice } from '../../ui.js';
import { DriveFolderPicker, type DriveBrowserPort } from './drive-folder-picker.js';
import type { Act } from './shared.js';
import { ConnectedStorageSurface, ConnectionPreview } from './shared.js';

const DISCONNECT_NOTE = 'Disconnecting stops automatic synchronization and removes this Hub’s binding. The Drive folder, its kanban-hub.yaml, and every other file remain, and local boards, workflows, tasks, notes, and projects stay on this machine.';
const DOWNLOAD_URL = 'https://www.google.com/drive/download/';

export function GoogleDriveLocalStoragePanel({ hub, sharing, act, pending, api }: { hub: HubState; sharing?: HubSharingView; act: Act; pending: string | null; api?: ClientApi }) {
  const [discovery, setDiscovery] = useState<DriveDiscoveryView | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmChange, setConfirmChange] = useState(false);
  const picker = useDirectoryPicker();

  const port = useMemo<DriveBrowserPort | undefined>(() => {
    if (api === undefined) return undefined;
    return {
      roots: async refresh => {
        const result = await api.localDrive({ action: 'roots', ...(refresh ? { refresh: true } : {}) });
        if (result.action !== 'roots') throw new Error('Unexpected discovery result.');
        return result.discovery;
      },
      list: async path => {
        const result = await api.localDrive({ action: 'list', path });
        if (result.action !== 'list') throw new Error('Unexpected folder result.');
        return result.page;
      },
      ...(picker === null ? {} : { pickNative: () => picker.pick() }),
    };
  }, [api, picker]);

  async function rescan(): Promise<void> {
    if (api === undefined) return;
    setLoading(true);
    setProblem(null);
    try {
      const result = await api.localDrive({ action: 'roots', refresh: true });
      if (result.action !== 'roots') throw new Error('Unexpected discovery result.');
      setDiscovery(result.discovery);
    } catch (failure) { setProblem(asProblem(failure)); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (sharing !== undefined || api === undefined || discovery !== null) return;
    let alive = true;
    setLoading(true);
    api.localDrive({ action: 'roots' }).then(result => {
      if (!alive || result.action !== 'roots') return;
      setDiscovery(result.discovery);
    }).catch(failure => { if (alive) setProblem(asProblem(failure)); })
      .finally(() => setLoading(false));
    return () => { alive = false; };
  }, [sharing, api, discovery]);

  async function useNativeFolder(): Promise<void> {
    if (picker === null) return;
    setProblem(null);
    try {
      const picked = await picker.pick();
      if (picked) await connect(picked);
    } catch (failure) { setProblem(asProblem(failure)); }
  }

  async function connect(path: string): Promise<void> {
    setPickerOpen(false);
    setConfirmChange(false);
    if (sharing === undefined) await act('connect', { type: 'sharing.connect', hubId: hub.id, provider: 'google-drive-local', settings: { path } });
    else await act('change', { type: 'sharing.changeLocation', hubId: hub.id, settings: { path }, confirmed: true });
  }

  const pickerView = pickerOpen && port !== undefined
    ? <DriveFolderPicker open busy={pending !== null} port={port} onClose={() => setPickerOpen(false)} onSelect={path => void connect(path)} />
    : null;

  if (!sharing) {
    const state = discovery?.state;
    return <>
      <p className="kb-hint">Use a folder that the installed Google Drive for desktop app shares. The plugin reads <code>kanban-hub.yaml</code> there and never touches another file; no Google account authorization is requested, and projects, tasks, notes, and Hub names stay on this machine.</p>
      {discovery !== null && state === 'ready' && <>
        <p className="kb-share-meta"><span>{discovery.locations.length} Google Drive location{discovery.locations.length === 1 ? '' : 's'} detected</span></p>
        {discovery.sources?.some(source => !source.ok) && <p className="kb-hint" role="status">Some Google Drive settings could not be read; Rescan may help.</p>}
        <div className="kb-share-actions">
          <button type="button" className="kb-button kb-primary" disabled={pending !== null || port === undefined} onClick={() => setPickerOpen(true)}>Choose folder</button>
          <button type="button" className="kb-button" disabled={pending !== null || loading || api === undefined} onClick={() => void rescan()}><ReopenIcon size={14} /> {loading ? 'Scanning…' : 'Rescan'}</button>
          {picker !== null && <button type="button" className="kb-button" disabled={pending !== null} onClick={() => void useNativeFolder()}>Use another folder…</button>}
        </div>
        <p className="kb-hint">The plugin creates or adopts <code>kanban-hub.yaml</code> in the selected folder. The Drive app syncs that file between machines.</p>
      </>}
      {discovery !== null && state !== 'ready' && <>
        <p className="kb-hint" role="status">
          {state === 'app-missing' && <>Google Drive for desktop was not detected on this computer. Install it from <a href={DOWNLOAD_URL} target="_blank" rel="noreferrer">Google Drive for desktop</a>, sign in, then rescan.</>}
          {state === 'unsupported' && <>Google Drive for desktop is not available on this platform. Use the local folder storage instead, or choose a folder with the native picker.</>}
          {state === 'empty' && <>No Google Drive account is mounted. Sign in to Drive for desktop, then rescan.</>}
          {state === 'failed' && <>The Google Drive settings could not be read on this computer. Rescan, or pick the folder with the native picker.</>}
        </p>
        <div className="kb-share-actions">
          <button type="button" className="kb-button" disabled={pending !== null || loading || api === undefined} onClick={() => void rescan()}><ReopenIcon size={14} /> {loading ? 'Scanning…' : 'Rescan'}</button>
          {picker !== null && <button type="button" className="kb-button" disabled={pending !== null} onClick={() => void useNativeFolder()}>Use another folder…</button>}
        </div>
      </>}
      {discovery === null && <>
        <p className="kb-hint" role="status">{loading || api === undefined ? 'Looking for Google Drive on this computer…' : problem !== null ? 'Google Drive discovery could not be completed.' : 'Discovering Google Drive locations…'}</p>
        {problem !== null && <div className="kb-share-actions">
          <button type="button" className="kb-button" disabled={pending !== null || loading || api === undefined} onClick={() => void rescan()}><ReopenIcon size={14} /> {loading ? 'Scanning…' : 'Rescan'}</button>
          {picker !== null && <button type="button" className="kb-button" disabled={pending !== null} onClick={() => void useNativeFolder()}>Use another folder…</button>}
        </div>}
      </>}
      {discovery?.reason && <ErrorNotice problem={discovery.reason} />}
      <ErrorNotice problem={problem} />
      {pickerView}
    </>;
  }

  if (sharing.status === 'preview') {
    return <>
      <ConnectionPreview
        hub={hub} sharing={sharing} act={act} pending={pending} noun="folder"
        footnote={<p className="kb-hint">Getting the team configuration adopts the team version for boards that exist on both sides and keeps local-only boards as drafts. Replacing the team configuration overwrites the published boards with this Hub's boards.</p>}
      />
      {pickerView}
    </>;
  }

  const unavailable = sharing.error?.code === 'SHARING_DRIVE_MOUNT_UNAVAILABLE' || sharing.error?.code === 'SHARING_DRIVE_PERMISSION_DENIED';
  const conflictCopy = sharing.blockers.some(blocker => blocker.code === 'SHARING_CONFLICT_COPY');
  const surface = <ConnectedStorageSurface
    hub={hub} sharing={sharing} act={act} pending={pending}
    summary={<>{sharing.address && <span>{sharing.address}</span>}{sharing.pending > 0 && <span>{sharing.pending} pending</span>}{sharing.conflicts > 0 && <span>{sharing.conflicts} to review</span>}{sharing.lastSyncedAt && <span>Last sync {new Date(sharing.lastSyncedAt).toLocaleString()}</span>}</>}
    actions={<>
      <button type="button" className={'kb-button ' + (sharing.pending > 0 || sharing.updates > 0 ? 'kb-primary' : '')} disabled={pending !== null} onClick={() => void act('sync', { type: 'sharing.check', hubId: hub.id })}>{pending === 'sync' ? 'Syncing…' : 'Sync now'}</button>
      {!confirmChange
        ? <button type="button" className="kb-button" disabled={pending !== null || port === undefined} onClick={() => setConfirmChange(true)}>Change folder</button>
        : <>
          <button type="button" className="kb-button kb-primary" disabled={pending !== null} onClick={() => setPickerOpen(true)}>Continue to folder browser</button>
          <button type="button" className="kb-button" onClick={() => setConfirmChange(false)}>Cancel</button>
        </>}
      {sharing.conflicts > 0 && <span className="kb-share-board-state">Review the boards below.</span>}
    </>}
    guidance={<>
      {confirmChange && <p className="kb-hint" role="status">Local boards, tasks, and notes stay on this machine. The Hub reconnects to the folder you choose and follows the first-connection choice when that folder already has a document.</p>}
      {conflictCopy && <p className="kb-hint" role="status">Decide which version is current, then delete or rename the other copies in the folder. The Hub synchronizes again after the next check finds them gone.</p>}
      {unavailable && <p className="kb-hint" role="status">The Drive app is not providing this folder right now. Reopen Google Drive for desktop, or choose another folder.</p>}
    </>}
    disconnectNote={DISCONNECT_NOTE}
  />;
  return <>{surface}{pickerView}</>;
}
