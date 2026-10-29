import React, { useEffect, useRef, useState } from 'react';
import type { BoardSettings as BoardSettingsInput, KanbanSettings, Problem } from '../../shared/types.js';
import { worktreePathForBranch } from '../../shared/worktree-name.js';
import { useDirectoryPicker } from '../services.js';
import { asProblem, ErrorNotice, useAction, type RunCommand } from '../ui.js';

export function GeneralSettings({ settings, settingsRevision, run }: { settings?: BoardSettingsInput | KanbanSettings; settingsRevision: number; run: RunCommand }) {
  const stored = settings?.worktreeBasePath ?? '';
  const [basePath, setBasePath] = useState(stored); const [revision, setRevision] = useState(settingsRevision); const [saved, setSaved] = useState(false); const [browseError, setBrowseError] = useState<Problem | null>(null); const action = useAction(run);
  const picker = useDirectoryPicker();
  const draftGeneration = useRef(0);
  useEffect(() => () => { draftGeneration.current++; }, []);
  const change = (value: string) => { if (action.pending) return; draftGeneration.current++; setBasePath(value); setSaved(false); };
  async function browse() {
    if (!picker) return;
    setBrowseError(null);
    let picked: string | null;
    try { picked = await picker.pick(); }
    catch (error) { setBrowseError(asProblem(error)); return; }
    if (picked) change(picked);
  }
  function reload() { if (action.pending) return; draftGeneration.current++; setBasePath(stored); setRevision(settingsRevision); setSaved(false); action.clearError(); }
  const example = worktreePathForBranch(basePath.trim(), 'fix-login');
  return <form className="kb-form" aria-label="General settings" onSubmit={async event => {
    event.preventDefault(); if (action.pending) return;
    const generation = draftGeneration.current; const path = basePath.trim();
    const result = await action.execute({ type: 'settings.save', settings: path ? { worktreeBasePath: path } : {}, expectedRevision: revision });
    if (!result || generation !== draftGeneration.current) return;
    setBasePath(result.state.settings.worktreeBasePath ?? ''); setRevision(result.state.settings.revision); setSaved(true);
  }}>
    <h3>Worktree base path</h3>
    <label className="kb-field">Worktree base path<div className="kb-input-row"><input className="kb-input" aria-label="Worktree base path" disabled={action.pending} value={basePath} placeholder="Absolute path for task worktrees" onChange={event => change(event.target.value)} /><button type="button" className="kb-button" aria-label="Browse for worktree base path" disabled={action.pending || !picker} onClick={() => void browse()}>Browse…</button></div></label>
    <p className="kb-hint">New task worktrees default to this directory plus the branch name. Leave empty to enter each task's destination manually.</p>
    <p className="kb-hint">Example default: <code>{example || '<base path>/fix-login'}</code></p>
    <p className="kb-hint">Existing worktrees keep their current paths when this setting changes. A base path inside a repository is allowed; its worktrees appear as untracked content.</p>
    <ErrorNotice problem={action.error} /><ErrorNotice problem={browseError} />
    <div className="kb-actions"><button type="button" className="kb-button" disabled={action.pending} onClick={reload}>Reload saved settings</button><button className="kb-button kb-primary" disabled={action.pending}>{action.pending ? 'Saving…' : 'Save settings'}</button></div>
    {saved && <p role="status">Settings saved.</p>}
  </form>;
}
