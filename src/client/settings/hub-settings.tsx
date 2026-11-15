import React, { useState } from 'react';
import type { HubSharingView, HubState, Problem } from '../../shared/types.js';
import { ErrorNotice, type RunCommand } from '../ui.js';
import { usePanelDirty } from './board/use-panel-dirty.js';

/**
 * The Hub's own section: its identity, and its deletion in a danger zone of its own.
 * Boards are listed and managed by the Boards section, so this surface names no board.
 */
export function HubSettings({ hub, hubCount, run, sharing, onDeleted, onDirtyChange }: {
  hub: HubState; hubCount: number; run: RunCommand; sharing?: HubSharingView; onDeleted?: () => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const [name, setName] = useState(hub.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<Problem | null>(null);
  const [pending, setPending] = useState(false);
  const tasks = hub.tasks.length;
  const dirty = name.trim().length > 0 && name.trim() !== hub.name;
  usePanelDirty(dirty, onDirtyChange);
  const published = sharing !== undefined && sharing.status !== 'preview';
  async function act(command: Parameters<RunCommand>[0]) { setPending(true); setError(null); try { return await run(command); } catch (failure) { setError(failure as Problem); return undefined; } finally { setPending(false); } }
  async function saveName(event: React.FormEvent) { event.preventDefault(); if (!name.trim()) return; await act({ type: 'hub.rename', hubId: hub.id, name: name.trim(), expectedRevision: hub.revision }); }
  async function deleteHub() { const result = await act({ type: 'hub.delete', hubId: hub.id, confirmed: true }); if (result) onDeleted?.(); }
  return <div className="kb-form" aria-label="Hub settings">
    <form className="kb-form" onSubmit={saveName}>
      <h3>Hub</h3>
      <label className="kb-field">Hub name<input className="kb-input" value={name} disabled={pending} onChange={event => setName(event.target.value)} /></label>
      <div className="kb-actions"><button className="kb-button kb-primary" disabled={pending || !name.trim()}>{pending ? 'Saving…' : 'Save Hub name'}</button></div>
    </form>
    <section className="kb-danger-zone" aria-label="Hub danger zone">
      <h3>Danger zone</h3>
      <p className="kb-hint">Deleting a Hub keeps project directories, worktrees, native conversations, and native workspaces.</p>
      <div className="kb-actions"><button type="button" className="kb-button kb-danger" disabled={pending || hubCount <= 1 || tasks > 0} title={hubCount <= 1 ? 'At least one Hub must exist.' : tasks > 0 ? 'Delete every task before deleting the Hub.' : 'Delete this Hub and its task-free projects'} onClick={() => setConfirmDelete(true)}>Delete Hub</button></div>
    </section>
    {confirmDelete && <div className="kb-inline-confirm" role="alertdialog" aria-label={'Confirm deleting Hub ' + hub.name}><p>Delete Hub <strong>{hub.name}</strong> with {hub.boards.length} {hub.boards.length === 1 ? 'board' : 'boards'} and {hub.projects.length} {hub.projects.length === 1 ? 'project' : 'projects'}? This removes the Hub, its empty boards, and its task-free project registrations. {published ? "The team's published configuration is not removed. " : ''}Files, worktrees, native conversations, and native workspaces are kept.</p><div className="kb-actions"><button type="button" className="kb-button" disabled={pending} onClick={() => setConfirmDelete(false)}>Cancel</button><button type="button" className="kb-button kb-danger" disabled={pending} onClick={() => void deleteHub()}>{pending ? 'Deleting…' : 'Delete Hub'}</button></div></div>}
    <ErrorNotice problem={error} />
  </div>;
}
