import React, { useEffect, useId, useState } from 'react';
import type { Board, BoardState, HubState } from '../../../shared/types.js';
import { isPublishedProject } from '../../../shared/project.js';
import { ErrorNotice, useAction, type RunCommand } from '../../ui.js';
import { usePanelDirty } from './use-panel-dirty.js';

/**
 * Which projects may create tasks on this board. The board records project keys; an
 * absent list allows every project of the Hub and an empty list closes creation. The
 * form saves against the revision it was opened at, so an incoming team change can
 * never be overwritten by a stale selection.
 */
export function BoardProjectScopeForm({ state, hub, board, run, onDirtyChange }: {
  state: BoardState;
  hub: HubState;
  board: Board;
  run: RunCommand;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const id = useId();
  const action = useAction(run);
  const [mode, setMode] = useState<'all' | 'selected'>(board.allowedProjectKeys === undefined ? 'all' : 'selected');
  const [selected, setSelected] = useState<string[]>(() => [...(board.allowedProjectKeys ?? [])]);
  const [baseRevision, setBaseRevision] = useState(hub.revision);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  // A pristine draft follows the board; a dirty one keeps the user's work until it is
  // saved or explicitly reloaded.
  useEffect(() => {
    if (dirty) return;
    setMode(board.allowedProjectKeys === undefined ? 'all' : 'selected');
    setSelected([...(board.allowedProjectKeys ?? [])]);
    setBaseRevision(hub.revision);
  }, [board.allowedProjectKeys, hub.revision, dirty]);
  usePanelDirty(dirty, onDirtyChange);
  const stale = dirty && hub.revision !== baseRevision;
  const counts = new Map<string, number>();
  for (const task of state.tasks) counts.set(task.projectId, (counts.get(task.projectId) ?? 0) + 1);
  function edit(nextMode: 'all' | 'selected'): void { setMode(nextMode); setDirty(true); setSaved(false); }
  function toggle(key: string): void {
    setSaved(false); setDirty(true);
    setSelected(current => current.includes(key) ? current.filter(value => value !== key) : [...current, key]);
  }
  function reload(): void {
    setMode(board.allowedProjectKeys === undefined ? 'all' : 'selected');
    setSelected([...(board.allowedProjectKeys ?? [])]);
    setBaseRevision(hub.revision);
    setDirty(false);
    setSaved(false);
    action.clearError();
  }
  async function save(): Promise<void> {
    const result = await action.execute({
      type: 'board.projects.save',
      hubId: hub.id,
      boardId: board.id,
      ...(mode === 'all' ? {} : { projectKeys: selected }),
      expectedRevision: baseRevision,
    });
    if (result === null) return;
    setBaseRevision(result.state.hubs.find(value => value.id === hub.id)?.revision ?? baseRevision);
    setDirty(false);
    setSaved(true);
  }
  return <div className="kb-form" role="group" aria-label="Board project scope">
    <h3>Projects</h3>
    <p className="kb-hint">Choose which projects may create tasks on this board. Cards already on the board stay where they are either way.</p>
    {stale && <p className="kb-hint" role="alert">The board changed while this form was open, so saving is unavailable. Reload the scope to continue from the current value.</p>}
    <label className="kb-choice"><input type="radio" name={id + '-mode'} checked={mode === 'all'} disabled={action.pending || stale} onChange={() => edit('all')} /> All projects of this Hub</label>
    <label className="kb-choice"><input type="radio" name={id + '-mode'} checked={mode === 'selected'} disabled={action.pending || stale} onChange={() => edit('selected')} /> Selected projects</label>
    {mode === 'selected' && <>
      <ul className="kb-project-list">{hub.projects.map(project => {
        const cards = counts.get(project.id) ?? 0;
        const placeholder = isPublishedProject(project);
        return <li key={project.id}>
          <label className="kb-choice">
            <input type="checkbox" checked={selected.includes(project.projectKey)} disabled={action.pending || stale} onChange={() => toggle(project.projectKey)} /> {project.name}
          </label>
          <span className="kb-hint">{project.projectKey}{placeholder ? ' · awaiting adoption' : cards === 0 ? '' : ' · ' + cards + (cards === 1 ? ' card' : ' cards')}</span>
        </li>;
      })}</ul>
      {hub.projects.length === 0 && <p className="kb-hint">This Hub has no projects yet.</p>}
      {selected.length === 0 && <p className="kb-hint" role="status">No project is selected, so this board accepts no new task.</p>}
    </>}
    <div className="kb-actions">
      <button type="button" className="kb-button kb-primary" disabled={action.pending || stale} onClick={() => void save()}>{action.pending ? 'Saving…' : 'Save project scope'}</button>
      {stale && <button type="button" className="kb-button" disabled={action.pending} onClick={reload}>Reload scope</button>}
    </div>
    {saved && action.error === null && <p role="status">Project scope saved.</p>}
    <ErrorNotice problem={action.error} />
  </div>;
}
