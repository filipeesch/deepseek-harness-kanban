import React, { useEffect, useId, useState } from 'react';
import type { ClientApi, HubSharingView, HubState, SharingAuthView } from '../../../shared/types.js';
import { useSharingActions } from '../../sharing/actions.js';
import { ErrorNotice, Tabs, type RunCommand } from '../../ui.js';
import { ChangesArea } from './changes-area.js';
import { ConnectionArea } from './connection-area.js';

/**
 * The Team Settings surface, in two areas presented as sub-tabs: where this Hub
 * publishes, and what changed since the team configuration was last applied. The
 * Changes area is only offered while the Hub is bound, because a Hub with no binding
 * publishes nothing; connection details appear once, in the Connection area.
 */
export function TeamSettings({ hub, sharing, auth, api, run }: { hub: HubState; sharing?: HubSharingView; auth?: SharingAuthView; api?: ClientApi; run?: RunCommand }) {
  const actions = useSharingActions(api);
  const id = useId();
  const [area, setArea] = useState<'Connection' | 'Changes'>('Connection');
  const unavailable = sharing?.blockers.some(blocker => blocker.code === 'SHARING_DOCUMENT_VERSION_UNSUPPORTED') === true;
  const bound = sharing !== undefined && sharing.status !== 'preview';
  const areas: readonly string[] = bound ? ['Connection', 'Changes'] : ['Connection'];
  // Losing the binding removes the Changes sub-tab, so the surface returns to Connection.
  useEffect(() => { if (!bound) setArea('Connection'); }, [bound]);
  const selected = areas.includes(area) ? area : 'Connection';
  return <div className="kb-form" aria-label="Team settings">
    <h3>Team Settings</h3>
    <p className="kb-hint">Projects, tasks, notes, and Hub names stay on this machine.</p>
    <Tabs label="Team settings areas" values={areas} selected={selected} onSelect={value => setArea(value as 'Connection' | 'Changes')} id={id} />
    {unavailable && <p className="kb-error" role="alert"><strong>Update dsh-kanban</strong><span>This team storage was written by a newer plugin version. Reading and publishing stay blocked until dsh-kanban is updated.</span></p>}
    <div className="kb-share-panel" role="tabpanel" id={id + '-panel-' + selected} aria-labelledby={id + '-tab-' + selected}>
      {selected === 'Connection'
        ? <ConnectionArea hub={hub} sharing={sharing} auth={auth} api={api} act={actions.run} pending={actions.pending} />
        : sharing !== undefined && <ChangesArea hub={hub} sharing={sharing} act={actions.run} pending={actions.pending} {...(api === undefined ? {} : { api })} {...(run === undefined ? {} : { run })} />}
      {!bound && <p className="kb-hint">Board changes appear here once this Hub is connected to team storage.</p>}
    </div>
    {actions.error && <ErrorNotice problem={actions.error} />}
  </div>;
}
