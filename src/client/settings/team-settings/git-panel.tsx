import React, { useEffect, useState } from 'react';
import type { HubSharingView, HubState } from '../../../shared/types.js';
import type { Act } from './shared.js';
import { ConnectionPreview } from './shared.js';

/** The Git connection surface: an address and a check interval. */
export function GitStoragePanel({ hub, sharing, act, pending }: { hub: HubState; sharing?: HubSharingView; act: Act; pending: string | null }) {
  const [repository, setRepository] = useState(sharing?.address ?? '');
  useEffect(() => { setRepository(sharing?.address ?? ''); }, [sharing?.address]);
  if (sharing?.status === 'preview') {
    return <ConnectionPreview
      hub={hub} sharing={sharing} act={act} pending={pending} noun="repository"
      footnote={<p className="kb-hint">Getting the team boards adopts the team version for boards that exist on both sides and keeps local-only boards as drafts. Publishing these boards replaces the published ones.</p>}
    />;
  }
  if (sharing !== undefined) return null;
  return <>
    <p className="kb-hint">Keep this Hub's boards and workflows aligned through a Git repository.</p>
    <form className="kb-share-form" onSubmit={event => { event.preventDefault(); if (repository.trim()) void act('connect', { type: 'sharing.connect', hubId: hub.id, provider: 'git', settings: { repository: repository.trim() } }); }}>
      <label className="kb-field">Repository address<input className="kb-input" aria-label="Repository address" placeholder="https:// or an absolute path" value={repository} disabled={pending !== null} onChange={event => setRepository(event.target.value)} /></label>
      <button type="submit" className="kb-button kb-primary" disabled={pending !== null || !repository.trim()}>{pending === 'connect' ? 'Connecting…' : 'Connect'}</button>
    </form>
    <p className="kb-hint">The plugin keeps a managed clone. Credentials come from Git on this machine; no secret is stored.</p>
  </>;
}
