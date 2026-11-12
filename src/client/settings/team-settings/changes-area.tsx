import React, { useState } from 'react';
import type { ClientApi, HubSharingView, HubState, Problem } from '../../../shared/types.js';
import { BOARD_STATE_LABEL, countLabel } from '../../sharing/status.js';
import { type RunCommand } from '../../ui.js';
import { ChangeList } from './change-list.js';
import { asProblem, ErrorNotice } from '../../ui.js';
import { Blockers, type Act } from './shared.js';

/**
 * What changed since the team configuration was last applied: one row per published
 * board with its state, its counts, and the action that state requires. Nothing here
 * repeats the connection details.
 */
export function ChangesArea({ hub, sharing, act, pending, api, run }: { hub: HubState; sharing: HubSharingView; act: Act; pending: string | null; api?: ClientApi; run?: RunCommand }) {
  const [removalProblem, setRemovalProblem] = useState<Problem | null>(null);
  if (sharing.status === 'preview') return null;
  const choices = sharing.boards.filter(board => board.state === 'needs-review').length;
  const updateRequired = sharing.boards.filter(board => board.state === 'update-required').length;
  // A storage-level review or a layout version suspends every write; one board's
  // conflict does not, because publishing is isolated per board.
  const suspended = sharing.blockers.length > 0 || sharing.status === 'unavailable';
  return <section className="kb-share-area" aria-label="Changes">
    <h4>Changes</h4>
    <p className="kb-share-meta">
      <span>{countLabel(sharing.drafts, 'board to publish', 'boards to publish')}</span>
      <span>{countLabel(sharing.updates, 'board to get', 'boards to get')}</span>
      {choices > 0 && <span>{countLabel(choices, 'board needs a choice', 'boards need a choice')}</span>}
      {updateRequired > 0 && <span>{countLabel(updateRequired, 'board needs a plugin update', 'boards need a plugin update')}</span>}
    </p>
    <div className="kb-share-actions">
      <button type="button" className={'kb-button ' + (sharing.drafts > 0 && !suspended ? 'kb-primary' : '')} disabled={pending !== null || (sharing.drafts === 0 && sharing.pendingRemovals.length === 0) || suspended} onClick={() => void act('publish-all', { type: 'sharing.publishAll', hubId: hub.id })}>{pending === 'publish-all' ? 'Publishing…' : 'Publish all'}</button>
      <button type="button" className={'kb-button ' + (sharing.updates > 0 ? 'kb-primary' : '')} disabled={pending !== null || sharing.updates === 0 || suspended} onClick={() => void act('updates', { type: 'sharing.getUpdates', hubId: hub.id })}>{pending === 'updates' ? 'Getting…' : 'Get updates'}</button>
    </div>
    <Blockers blockers={sharing.blockers} />
    {removalProblem !== null && <ErrorNotice problem={removalProblem} />}
    <ul className="kb-share-boards" aria-label="Published boards">
      {sharing.boards.map(board => <li key={board.boardId} className="kb-share-board" data-state={board.state}>
        <div className="kb-share-board-main">
          <span className="kb-share-board-name">{board.name}</span>
          <span className="kb-share-board-state">{BOARD_STATE_LABEL[board.state] ?? board.state}
            {board.state === 'updates-available' && board.updates !== undefined ? ' · ' + countLabel(board.updates, 'change to get', 'changes to get') : ''}
            {board.draft && board.detail !== undefined ? ' · ' + countLabel(board.detail.changes.length, 'change to publish', 'changes to publish') : ''}
          </span>
          {board.detail && <ChangeList changes={board.detail.changes} label={'Changes for ' + board.name} />}
          {board.detail?.local !== undefined && board.detail.team !== undefined && <details className="kb-share-diff">
            <summary>Compare the texts</summary>
            <div className="kb-share-diff-body">
              <div><h5>This machine: {board.detail.localName ?? board.name}</h5><pre>{board.detail.local}</pre></div>
              <div><h5>Team: {board.detail.teamName ?? board.name}</h5><pre>{board.detail.team}</pre></div>
            </div>
          </details>}
        </div>
        <div className="kb-share-actions">
          {board.state === 'draft' && <button type="button" className="kb-button kb-primary" disabled={pending !== null || suspended} onClick={() => void act('publish-board', { type: 'sharing.publishBoard', hubId: hub.id, boardId: board.boardId })}>{pending === 'publish-board' ? 'Publishing…' : 'Publish'}</button>}
          {board.state === 'updates-available' && board.draft && <span className="kb-share-board-state">Local changes are kept; get updates first.</span>}
          {board.state === 'updates-available' && <button type="button" className="kb-button kb-primary" disabled={pending !== null || suspended} onClick={() => void act('update-board', { type: 'sharing.updateBoard', hubId: hub.id, boardId: board.boardId })}>{pending === 'update-board' ? 'Updating…' : 'Get updates'}</button>}
          {board.state === 'needs-review' && board.key !== undefined && <>
            <button type="button" className="kb-button kb-primary" disabled={pending !== null || suspended} onClick={() => void act('resolve-team', { type: 'sharing.resolve', hubId: hub.id, boardId: board.boardId, choice: 'team' })}>Use the team version</button>
            <button type="button" className="kb-button" disabled={pending !== null || suspended} onClick={() => void act('resolve-local', { type: 'sharing.resolve', hubId: hub.id, boardId: board.boardId, choice: 'local' })}>Keep the local version</button>
          </>}
          {board.state === 'needs-review' && board.key === undefined && <span className="kb-share-board-state">A local board already uses this name. Rename or publish it first.</span>}
          {board.state === 'update-required' && <span className="kb-share-board-state">Update the plugin to use this team board.</span>}
          {board.state === 'orphan' && <>
            <button type="button" className="kb-button" disabled={pending !== null || suspended} onClick={() => void act('orphan', { type: 'sharing.publishOrphan', hubId: hub.id, boardId: board.boardId })}>Publish as a new board</button>
            {run !== undefined && api !== undefined && <button type="button" className="kb-button" disabled={pending !== null || suspended} onClick={() => { setRemovalProblem(null); void run({ type: 'board.delete', hubId: hub.id, boardId: board.boardId, confirmed: true, sharing: 'local' }).catch(failure => setRemovalProblem(asProblem(failure))); }}>Delete here</button>}
          </>}
        </div>
      </li>)}
    </ul>
    {sharing.incoming.length > 0 && <p className="kb-hint" role="status">New from the team: {sharing.incoming.map(board => board.name).join(', ')}. Get updates to add them.</p>}
    {sharing.pendingRemovals.length > 0 && <p className="kb-hint" role="status">A board removal is still waiting to be sent: {sharing.pendingRemovals.map(board => board.name).join(', ')}. Publish all retries it.</p>}
    {sharing.removed.length > 0 && <ul className="kb-share-boards" aria-label="Boards removed only from this installation">
      {sharing.removed.map(board => <li key={board.key} className="kb-share-board">
        <div className="kb-share-board-main"><span className="kb-share-board-name">{board.name}</span><span className="kb-share-board-state">Removed here</span></div>
        <div className="kb-share-actions"><button type="button" className="kb-button" disabled={pending !== null || suspended} onClick={() => void act('restore', { type: 'sharing.restore', hubId: hub.id, boardId: board.boardId })}>Restore</button></div>
      </li>)}
    </ul>}
  </section>;
}