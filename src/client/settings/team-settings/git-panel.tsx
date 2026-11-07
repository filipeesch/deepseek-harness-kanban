import React, { useEffect, useState } from 'react';
import type { HubSharingView, HubState } from '../../../shared/types.js';
import type { Act } from './shared.js';
import { ConnectedStorageSurface, ConnectionPreview } from './shared.js';

const DISCONNECT_NOTE = "Disconnecting stops automatic checks and removes the local copy of the repository. Boards, workflows, tasks, notes, and projects stay on this machine. The team's published configuration is unchanged.";

export function GitStoragePanel({ hub, sharing, act, pending }: { hub: HubState; sharing?: HubSharingView; act: Act; pending: string | null }) {
  const [repository, setRepository] = useState(sharing?.address ?? sharing?.repository ?? '');
  const [interval, setIntervalMinutes] = useState(String(sharing?.intervalMinutes ?? 5));
  useEffect(() => { setRepository(sharing?.address ?? sharing?.repository ?? ''); }, [sharing?.address, sharing?.repository]);

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
    return <ConnectionPreview
      hub={hub} sharing={sharing} act={act} pending={pending} noun="repository"
      footnote={<p className="kb-hint">Getting the team configuration adopts the team version for boards that exist on both sides and keeps local-only boards as drafts. Replacing the team configuration overwrites the published boards with this Hub's boards.</p>}
    />;
  }

  return <ConnectedStorageSurface
    hub={hub} sharing={sharing} act={act} pending={pending}
    actions={<>
      <button type="button" className="kb-button" disabled={pending !== null} onClick={() => void act('refresh', { type: 'sharing.check', hubId: hub.id })}>{pending === 'refresh' ? 'Checking…' : 'Refresh'}</button>
      <button type="button" className={'kb-button ' + (sharing.updates > 0 ? 'kb-primary' : '')} disabled={pending !== null || sharing.updates === 0} onClick={() => void act('updates', { type: 'sharing.getUpdates', hubId: hub.id })}>{pending === 'updates' ? 'Getting…' : 'Get updates' + (sharing.updates > 0 ? ' (' + sharing.updates + ')' : '')}</button>
      <button type="button" className={'kb-button ' + (sharing.drafts > 0 && sharing.updates === 0 && sharing.conflicts === 0 ? 'kb-primary' : '')} disabled={pending !== null || sharing.drafts === 0 || sharing.updates > 0 || sharing.conflicts > 0} onClick={() => void act('publish', { type: 'sharing.publish', hubId: hub.id })}>{pending === 'publish' ? 'Publishing…' : 'Publish' + (sharing.drafts > 0 ? ' (' + sharing.drafts + ')' : '')}</button>
    </>}
    guidance={sharing.updates > 0 ? <p className="kb-hint">Get the team updates before publishing. Publishing is unavailable while the team has changes you have not reviewed.</p> : null}
    disconnectNote={DISCONNECT_NOTE}
  />;
}
