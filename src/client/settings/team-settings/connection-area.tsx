import React, { useEffect, useState } from 'react';
import type { ClientApi, HubSharingView, HubState, SharingAuthView, SharingStorage } from '../../../shared/types.js';
import { ErrorNotice } from '../../ui.js';
import { GoogleDriveLocalStoragePanel } from './google-drive-local-panel.js';
import { GoogleDriveStoragePanel } from './google-drive-panel.js';
import { GitStoragePanel } from './git-panel.js';
import { LocalFolderStoragePanel } from './local-folder-panel.js';
import { DisconnectAction, IntervalSettings, StatusLine, type Act } from './shared.js';
import { STORAGE_META, StorageCards } from './storage-cards.js';

/** One connection surface per storage, so this area never branches on the storage id. */
const STORAGE_PANELS: Record<SharingStorage, React.ComponentType<{ hub: HubState; sharing?: HubSharingView; auth?: SharingAuthView; act: Act; pending: string | null; api?: ClientApi }>> = {
  git: GitStoragePanel,
  'google-drive': GoogleDriveStoragePanel,
  'google-drive-local': GoogleDriveLocalStoragePanel,
  'local-folder': LocalFolderStoragePanel,
};

const DISCONNECT_NOTE = 'Disconnecting stops automatic checks and removes the binding. Every local board, workflow, task, note, project, conversation, and worktree stays on this machine, and the team storage is unchanged.';

/**
 * Where this Hub publishes: the storage, its location, its check interval, and the
 * actions that belong to the connection. Nothing here lists board changes.
 */
export function ConnectionArea({ hub, sharing, auth, api, act, pending }: { hub: HubState; sharing?: HubSharingView; auth?: SharingAuthView; api?: ClientApi; act: Act; pending: string | null }) {
  const [storage, setStorage] = useState<SharingStorage>(sharing?.provider ?? 'git');
  useEffect(() => { setStorage(sharing?.provider ?? 'git'); }, [sharing?.provider]);
  const Panel = STORAGE_PANELS[sharing?.provider ?? storage];
  if (sharing === undefined) {
    return <section className="kb-share-area" aria-label="Connection">
      <h4>Connection</h4>
      <p className="kb-hint">Choose where this Hub publishes.</p>
      <StorageCards value={storage} onChange={setStorage} locked={false} busy={pending !== null} />
      <Panel hub={hub} act={act} pending={pending} api={api} />
    </section>;
  }
  if (sharing.status === 'preview') {
    return <section className="kb-share-area" aria-label="Connection">
      <h4>Connection</h4>
      <Panel hub={hub} sharing={sharing} auth={auth} act={act} pending={pending} api={api} />
      {sharing.error && <ErrorNotice problem={sharing.error} />}
    </section>;
  }
  const meta = STORAGE_META[sharing.provider];
  return <section className="kb-share-area" aria-label="Connection">
    <h4>Connection</h4>
    <p className="kb-share-meta"><span className="kb-share-status">{meta.label}</span><span>{sharing.address}</span>{sharing.authorization !== undefined && auth?.email !== undefined && <span>{auth.email}</span>}</p>
    <StatusLine sharing={sharing} />
    {sharing.notice && <p className="kb-hint" role="status">{sharing.notice.message}</p>}
    {sharing.supportsFiles
      ? <p className="kb-hint">Team documents live in <code>team-files/</code> in this storage.</p>
      : <p className="kb-hint">Team files are unavailable with {sharing.providerLabel}.</p>}
    {sharing.error && <ErrorNotice problem={sharing.error} />}
    <div className="kb-share-actions">
      <button type="button" className="kb-button" disabled={pending !== null} onClick={() => void act('refresh', { type: 'sharing.check', hubId: hub.id })}>{pending === 'refresh' ? 'Checking…' : 'Refresh'}</button>
      {sharing.provider === 'google-drive' && <button type="button" className="kb-button" disabled={pending !== null} onClick={() => void act('auth-switch', { type: 'sharing.auth.switch' })}>Switch account</button>}
      <DisconnectAction hubId={hub.id} act={act} pending={pending} note={DISCONNECT_NOTE} />
    </div>
    <Panel hub={hub} sharing={sharing} auth={auth} act={act} pending={pending} api={api} />
    <IntervalSettings hubId={hub.id} sharing={sharing} act={act} pending={pending} />
  </section>;
}
