import React, { useEffect, useState } from 'react';
import type { ClientApi, HubSharingView, HubState, Problem, SharingAuthView, SharingCommand, SharingStorage } from '../../../shared/types.js';
import { SHARING_STORAGES } from '../../../shared/types.js';
import { asProblem } from '../../ui.js';
import { GitStoragePanel } from './git-panel.js';
import { GoogleDriveStoragePanel } from './google-drive-panel.js';
import { LocalFolderStoragePanel } from './local-folder-panel.js';
import { Blockers, ErrorBlock, type Act } from './shared.js';

/** One connection surface per storage, so the selector never branches on the storage id. */
const STORAGE_PANELS: Record<SharingStorage, React.ComponentType<{ hub: HubState; sharing?: HubSharingView; auth?: SharingAuthView; act: Act; pending: string | null }>> = {
  git: GitStoragePanel,
  'google-drive': GoogleDriveStoragePanel,
  'local-folder': LocalFolderStoragePanel,
};

const STORAGE_LABELS: Record<SharingStorage, string> = {
  git: 'Git repository',
  'google-drive': 'Google Drive',
  'local-folder': 'Local folder',
};

/** The Team Settings surface: one storage selector over per-storage panels. */
export function TeamSettings({ hub, sharing, auth, api }: { hub: HubState; sharing?: HubSharingView; auth?: SharingAuthView; api?: ClientApi }) {
  const [storage, setStorage] = useState<SharingStorage>(sharing?.provider ?? 'git');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<Problem | null>(null);
  useEffect(() => { setStorage(sharing?.provider ?? 'git'); }, [sharing?.provider]);
  useEffect(() => { setError(null); }, [sharing?.status, auth?.status]);

  const act: Act = async (label, command) => {
    if (!api) { setError({ code: 'SHARING_UNAVAILABLE', message: 'Team settings are unavailable in this view.' }); return false; }
    setPending(label); setError(null);
    try { await api.sharing(command as SharingCommand); return true; }
    catch (failure) { setError(asProblem(failure)); return false; }
    finally { setPending(null); }
  };

  const bound = sharing !== undefined;
  const errorBlockers = error !== null && Array.isArray(error.details?.blockers) ? (error.details.blockers as Array<{ code: string; message: string }>) : [];
  const Panel = STORAGE_PANELS[storage];
  return <div className="kb-form" aria-label="Team settings">
    <h3>Team Settings</h3>
    <p className="kb-hint">Choose where this Hub's boards and workflows are shared. Projects, tasks, notes, and Hub names stay on this machine.</p>
    <label className="kb-field">Storage<select className="kb-input" aria-label="Team storage" value={storage} disabled={bound || pending !== null} onChange={event => setStorage(event.target.value as SharingStorage)}>
      {SHARING_STORAGES.map(value => <option key={value} value={value}>{STORAGE_LABELS[value]}</option>)}
    </select></label>
    {bound && <p className="kb-hint">This Hub is connected to {sharing.providerLabel}. Disconnect to switch storage.</p>}
    <Panel hub={hub} sharing={sharing} auth={auth} act={act} pending={pending} />
    {errorBlockers.length > 0 && <Blockers blockers={errorBlockers} />}
    <ErrorBlock error={error} />
  </div>;
}
