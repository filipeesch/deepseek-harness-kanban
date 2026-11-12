import React from 'react';
import type { ClientApi, HubSharingView, HubState, SharingAuthView } from '../../../shared/types.js';
import { useSharingActions } from '../../sharing/actions.js';
import { ErrorNotice, type RunCommand } from '../../ui.js';
import { ChangesArea } from './changes-area.js';
import { ConnectionArea } from './connection-area.js';

/**
 * The Team Settings surface, in two areas: where this Hub publishes, and what changed
 * since the team configuration was last applied. Connection details appear once.
 */
export function TeamSettings({ hub, sharing, auth, api, run }: { hub: HubState; sharing?: HubSharingView; auth?: SharingAuthView; api?: ClientApi; run?: RunCommand }) {
  const actions = useSharingActions(api);
  const unavailable = sharing?.blockers.some(blocker => blocker.code === 'SHARING_DOCUMENT_VERSION_UNSUPPORTED') === true;
  return <div className="kb-form" aria-label="Team settings">
    <h3>Team Settings</h3>
    <p className="kb-hint">Projects, tasks, notes, and Hub names stay on this machine.</p>
    {unavailable && <p className="kb-error" role="alert"><strong>Update the plugin</strong><span>This team storage was written by a newer plugin version. Reading and publishing stay blocked until the plugin is updated.</span></p>}
    <ConnectionArea hub={hub} sharing={sharing} auth={auth} api={api} act={actions.run} pending={actions.pending} />
    {sharing !== undefined && <ChangesArea hub={hub} sharing={sharing} act={actions.run} pending={actions.pending} {...(api === undefined ? {} : { api })} {...(run === undefined ? {} : { run })} />}
    {actions.error && <ErrorNotice problem={actions.error} />}
  </div>;
}
