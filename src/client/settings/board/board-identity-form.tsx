import React, { useState } from 'react';
import type { Board, HubState, Problem } from '../../../shared/types.js';
import { ErrorNotice, type RunCommand } from '../../ui.js';
import { usePanelDirty } from './use-panel-dirty.js';

/** The board's display name, which every presentation and the published entry use. */
export function BoardIdentityForm({ hub, board, run, onDirtyChange }: { hub: HubState; board: Board; run: RunCommand; onDirtyChange?: (dirty: boolean) => void }) {
  const [name, setName] = useState(board.name);
  usePanelDirty(name !== board.name, onDirtyChange);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Problem | null>(null);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setPending(true); setError(null);
    try { await run({ type: 'board.rename', hubId: hub.id, boardId: board.id, name: name.trim(), expectedRevision: hub.revision }); }
    catch (failure) { setError(failure as Problem); }
    finally { setPending(false); }
  }
  return <form className="kb-form" onSubmit={save}>
    <h3>Board</h3>
    <label className="kb-field">Board name<input className="kb-input" value={name} disabled={pending} onChange={event => setName(event.target.value)} /></label>
    <div className="kb-actions"><button className="kb-button kb-primary" disabled={pending || !name.trim()}>{pending ? 'Saving…' : 'Save board name'}</button></div>
    <ErrorNotice problem={error} />
  </form>;
}
