import React, { useEffect, useState } from 'react';
import type { HubSharingView, HubState, Problem, SharingCommand } from '../../../shared/types.js';
import { ErrorNotice } from '../../ui.js';
import { HUB_STATUS_LABEL } from '../../sharing/status.js';

export type Act = (label: string, command: SharingCommand) => Promise<Problem | null>;

export function Blockers({ blockers }: { blockers: Array<{ code: string; message: string }> }) {
  if (blockers.length === 0) return null;
  return <ul className="kb-share-blockers" aria-label="Storage blockers">
    {blockers.map((blocker, index) => <li key={blocker.code + ':' + index} className="kb-share-blocker"><span className="kb-share-blocker-text">{blocker.message}</span><span className="kb-share-code">{blocker.code}</span></li>)}
  </ul>;
}

export function ErrorBlock({ error }: { error: Problem | null }) { return <ErrorNotice problem={error} />; }

/** Board names compare case-insensitively and ignoring surrounding space. */
function normalized(names: readonly string[]): string[] {
  return names.map(name => name.trim().toLocaleLowerCase());
}

/** The one-line state of the connection: status, last check, and the check interval. */
export function StatusLine({ sharing }: { sharing: HubSharingView }) {
  const attention = sharing.updates + sharing.drafts + sharing.conflicts + sharing.blockers.length;
  return <p className="kb-share-meta">
    <span className={'kb-share-status' + (attention > 0 ? ' is-attention' : '')}>{HUB_STATUS_LABEL[sharing.status]}</span>
    {sharing.lastCheckedAt && <span>Checked {new Date(sharing.lastCheckedAt).toLocaleString()}</span>}
    <span>{sharing.intervalMinutes === 0 ? 'Manual checks only' : 'Every ' + sharing.intervalMinutes + ' min'}</span>
  </p>;
}

/**
 * The two first-connection choices over a storage that already has published boards.
 * The storage supplies its own noun, notice, and footnote.
 */
export function ConnectionPreview({ hub, sharing, act, pending, noun, notice, footnote, disabled = false }: {
  hub: HubState; sharing: HubSharingView; act: Act; pending: string | null;
  noun: string; notice?: React.ReactNode; footnote?: React.ReactNode; disabled?: boolean;
}) {
  const [confirmReplace, setConfirmReplace] = useState(false);
  useEffect(() => { setConfirmReplace(false); }, [sharing.status, sharing.address]);
  const blocked = pending !== null || disabled;
  const published = sharing.preview?.publishedBoards ?? 0;
  return <>
    <p className="kb-hint">This {noun} already has {published} published board{published === 1 ? '' : 's'}. This Hub has {sharing.preview?.localBoards ?? hub.boards.length}. Choose which boards become the shared ones.</p>
    <p className="kb-share-meta"><span>{sharing.address}</span></p>
    <ul className="kb-share-boards" aria-label="Published boards">
      {(sharing.previewBoards ?? []).map(board => <li key={board.key} className="kb-share-board"><div className="kb-share-board-main"><span className="kb-share-board-name">{board.name}</span><span className="kb-share-board-state">{normalized(hub.boards.map(entry => entry.name)).includes(normalized([board.name])[0]!) ? 'In both' : 'Only in the team'}</span></div></li>)}
      {hub.boards.filter(board => !normalized((sharing.previewBoards ?? []).map(entry => entry.name)).includes(normalized([board.name])[0]!)).map(board => <li key={board.id} className="kb-share-board"><div className="kb-share-board-main"><span className="kb-share-board-name">{board.name}</span><span className="kb-share-board-state">Only in this Hub</span></div></li>)}
    </ul>
    {notice}
    <div className="kb-share-actions">
      <button type="button" className="kb-button kb-primary" disabled={blocked} onClick={() => void act('receive', { type: 'sharing.receive', hubId: hub.id })}>{pending === 'receive' ? 'Getting…' : 'Get the team boards'}</button>
      {!confirmReplace
        ? <button type="button" className="kb-button" disabled={blocked} onClick={() => setConfirmReplace(true)}>Publish these boards instead</button>
        : <><button type="button" className="kb-button kb-danger" disabled={blocked} onClick={() => void act('initial', { type: 'sharing.publishInitial', hubId: hub.id, confirmed: true })}>{pending === 'initial' ? 'Publishing…' : 'Replace the published boards'}</button><button type="button" className="kb-button" onClick={() => setConfirmReplace(false)}>Back</button></>}
      <button type="button" className="kb-button" disabled={pending !== null} onClick={() => { setConfirmReplace(false); void act('disconnect', { type: 'sharing.disconnect', hubId: hub.id }); }}>Cancel connection</button>
    </div>
    {footnote}
    {confirmReplace && <p className="kb-hint" role="status">Replacing publishes this Hub's boards and removes the boards it does not have.</p>}
    <Blockers blockers={sharing.blockers} />
    {sharing.error && <ErrorNotice problem={sharing.error} />}
  </>;
}

/** The check interval, shared by every connected storage. */
export function IntervalSettings({ hubId, sharing, act, pending }: { hubId: string; sharing: HubSharingView; act: Act; pending: string | null }) {
  const [interval, setIntervalMinutes] = useState(String(sharing.intervalMinutes));
  useEffect(() => { setIntervalMinutes(String(sharing.intervalMinutes)); }, [sharing.intervalMinutes]);
  return <form className="kb-share-form" onSubmit={event => { event.preventDefault(); void act('interval', { type: 'sharing.setInterval', hubId, intervalMinutes: Number(interval) }); }}>
    <label className="kb-field kb-share-interval">Minutes between checks<input className="kb-input" aria-label="Check interval in minutes" type="number" min={0} max={1440} value={interval} disabled={pending !== null} onChange={event => setIntervalMinutes(event.target.value)} /></label>
    <button type="submit" className="kb-button" disabled={pending !== null}>{pending === 'interval' ? 'Saving…' : 'Save interval'}</button>
  </form>;
}

/** Disconnect with its confirmation and the storage's own explanation. */
export function DisconnectAction({ hubId, act, pending, note }: { hubId: string; act: Act; pending: string | null; note: string }) {
  const [confirm, setConfirm] = useState(false);
  return <>
    {!confirm
      ? <button type="button" className="kb-button kb-danger" disabled={pending !== null} onClick={() => setConfirm(true)}>Disconnect</button>
      : <><button type="button" className="kb-button kb-danger" disabled={pending !== null} onClick={() => void act('disconnect', { type: 'sharing.disconnect', hubId })}>{pending === 'disconnect' ? 'Disconnecting…' : 'Confirm disconnect'}</button><button type="button" className="kb-button" onClick={() => setConfirm(false)}>Cancel</button></>}
    {confirm && <p className="kb-hint" role="status">{note}</p>}
  </>;
}
