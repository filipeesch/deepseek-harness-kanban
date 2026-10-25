import React, { useState } from 'react';
import type { Problem } from '../shared/types.js';
import { asProblem, ErrorNotice, Modal, type RunCommand } from './ui.js';

export function CreateHubDialog({ run, onClose, onCreated }: { run: RunCommand; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState(''); const [pending, setPending] = useState(false); const [error, setError] = useState<Problem | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!name.trim() || pending) return;
    setPending(true); setError(null);
    try {
      const result = await run({ type: 'hub.create', name: name.trim() });
      const id = result.commandReceipt?.kind === 'hub' ? result.commandReceipt.id : undefined;
      if (!id) setError({ code: 'CREATION_RECEIPT_REQUIRED', message: 'The Hub was saved without a creation receipt. Close and reload before retrying.' });
      else onCreated(id);
    } catch (failure) { setError(asProblem(failure)); }
    finally { setPending(false); }
  }
  return <Modal title="Create Hub" onClose={onClose} busy={pending}><form className="kb-form" onSubmit={submit}><label className="kb-field">Hub name<input className="kb-input" required autoFocus aria-label="Hub name" value={name} onChange={event => setName(event.target.value)} /></label><p className="kb-hint">A Hub groups projects, boards, and their workflows. It has no filesystem root.</p><ErrorNotice problem={error} /><div className="kb-actions"><button type="button" className="kb-button" onClick={onClose}>Cancel</button><button className="kb-button kb-primary" disabled={pending || !name.trim()}>{pending ? 'Creating…' : 'Create Hub'}</button></div></form></Modal>;
}

export function CreateBoardDialog({ hubId, run, onClose, onCreated }: { hubId: string; run: RunCommand; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState(''); const [pending, setPending] = useState(false); const [error, setError] = useState<Problem | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!name.trim() || pending) return;
    setPending(true); setError(null);
    try {
      const result = await run({ type: 'board.create', hubId, name: name.trim() });
      const id = result.commandReceipt?.kind === 'board' ? result.commandReceipt.id : undefined;
      if (!id) setError({ code: 'CREATION_RECEIPT_REQUIRED', message: 'The board was saved without a creation receipt. Close and reload before retrying.' });
      else onCreated(id);
    } catch (failure) { setError(asProblem(failure)); }
    finally { setPending(false); }
  }
  return <Modal title="Create board" onClose={onClose} busy={pending}><form className="kb-form" onSubmit={submit}><label className="kb-field">Board name<input className="kb-input" required autoFocus aria-label="Board name" value={name} onChange={event => setName(event.target.value)} /></label><p className="kb-hint">The board starts with the default workflow. You can edit its YAML in Configuration → Board.</p><ErrorNotice problem={error} /><div className="kb-actions"><button type="button" className="kb-button" onClick={onClose}>Cancel</button><button className="kb-button kb-primary" disabled={pending || !name.trim()}>{pending ? 'Creating…' : 'Create board'}</button></div></form></Modal>;
}
