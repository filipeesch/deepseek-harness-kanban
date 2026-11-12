import React, { useEffect, useMemo, useState } from 'react';
import type { ClientApi, DriveDiscoveryView, HubSharingView, HubState, Problem } from '../../../shared/types.js';
import { ReopenIcon } from '../../icons.js';
import { useDirectoryPicker } from '../../services.js';
import { asProblem, ErrorNotice } from '../../ui.js';
import { DriveFolderPicker, type DriveBrowserPort } from './drive-folder-picker.js';
import type { Act } from './shared.js';
import { ConnectionPreview } from './shared.js';

const DOWNLOAD_URL = 'https://www.google.com/drive/download/';

/** The Google Drive Local connection surface: a folder inside the mounted Drive app. */
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
      .finally(() => { if (alive) setLoading(false); });
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
  const actions = <div className="kb-share-actions">
    <button type="button" className="kb-button" disabled={pending !== null || loading || api === undefined} onClick={() => void rescan()}><ReopenIcon size={14} /> {loading ? 'Scanning…' : 'Rescan'}</button>
    {picker !== null && <button type="button" className="kb-button" disabled={pending !== null} onClick={() => void useNativeFolder()}>Use another folder…</button>}
  </div>;

  if (sharing?.status === 'preview') {
    return <>
      <ConnectionPreview
        hub={hub} sharing={sharing} act={act} pending={pending} noun="folder"
        footnote={<p className="kb-hint">Getting the team boards adopts the team version for boards that exist on both sides and keeps local-only boards as drafts.</p>}
      />
      {pickerView}
    </>;
  }
  if (sharing !== undefined) {
    return <>
      <div className="kb-share-actions">
        {!confirmChange
          ? <button type="button" className="kb-button" disabled={pending !== null || port === undefined} onClick={() => setConfirmChange(true)}>Change folder</button>
          : <>
            <button type="button" className="kb-button kb-primary" disabled={pending !== null} onClick={() => setPickerOpen(true)}>Continue to folder browser</button>
            <button type="button" className="kb-button" onClick={() => setConfirmChange(false)}>Cancel</button>
          </>}
      </div>
      {confirmChange && <p className="kb-hint" role="status">Local boards, tasks, and notes stay on this machine. The Hub reconnects to the folder you choose.</p>}
      {pickerView}
    </>;
  }
  const state = discovery?.state;
  return <>
    <p className="kb-hint">Use a folder that the installed Google Drive for desktop app shares. The plugin reads and writes only its own layout there.</p>
    {discovery !== null && state === 'ready' && <>
      <p className="kb-share-meta"><span>{discovery.locations.length} Google Drive location{discovery.locations.length === 1 ? '' : 's'} detected</span></p>
      <div className="kb-share-actions">
        <button type="button" className="kb-button kb-primary" disabled={pending !== null || port === undefined} onClick={() => setPickerOpen(true)}>Choose folder</button>
        {actions}
      </div>
    </>}
    {discovery !== null && state !== 'ready' && <>
      <p className="kb-hint" role="status">
        {state === 'app-missing' && <>Google Drive for desktop was not detected on this computer. Install it from <a href={DOWNLOAD_URL} target="_blank" rel="noreferrer">Google Drive for desktop</a>, sign in, then rescan.</>}
        {state === 'unsupported' && <>Google Drive for desktop is not available on this platform. Use the local folder storage instead, or choose a folder with the native picker.</>}
        {state === 'empty' && <>No Google Drive account is mounted. Sign in to Drive for desktop, then rescan.</>}
        {state === 'failed' && <>The Google Drive settings could not be read on this computer. Rescan, or pick the folder with the native picker.</>}
      </p>
      {actions}
    </>}
    {discovery === null && <p className="kb-hint" role="status">{api === undefined ? 'Google Drive discovery is unavailable in this view.' : loading ? 'Looking for Google Drive on this computer…' : problem !== null ? 'Google Drive discovery could not be completed.' : 'Discovering Google Drive locations…'}</p>}
    {discovery === null && problem !== null && actions}
    {discovery?.reason && <ErrorNotice problem={discovery.reason} />}
    <ErrorNotice problem={problem} />
    {pickerView}
  </>;
}
