import React, { useCallback, useEffect, useState } from 'react';
import type { ClientApi, CreateWorktree, Project, Task } from '../shared/types.js';
import { asProblem, ErrorNotice, useAction, type RunCommand } from './ui.js';

export function initialWorktree(task: Task, project?: Project): CreateWorktree {
  const slug = task.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  return { mode: 'new', branchName: 'task/' + task.id + (slug ? '-' + slug : ''), path: '', sourceBranch: project?.defaultBranch ?? '' };
}
export function validWorktree(value: CreateWorktree) { return Boolean(value.path.trim() && value.branchName.trim() && (value.mode === 'existing' || value.sourceBranch?.trim())); }
export function cleanWorktree(value: CreateWorktree): CreateWorktree { return { mode: value.mode, path: value.path.trim(), branchName: value.branchName.trim(), ...(value.mode === 'new' ? { sourceBranch: value.sourceBranch?.trim() } : {}) }; }

export function useBranches(api: ClientApi, taskId: string) {
  const [branches, setBranches] = useState<string[]>([]); const [pending, setPending] = useState(false); const [error, setError] = useState<ReturnType<typeof asProblem> | null>(null); const [attempt, setAttempt] = useState(0);
  useEffect(() => { let current = true; setPending(true); setError(null); void Promise.resolve().then(() => api.branches(taskId)).then(value => { if (current) setBranches(value); }, failure => { if (current) setError(asProblem(failure)); }).finally(() => { if (current) setPending(false); }); return () => { current = false; }; }, [api, taskId, attempt]);
  return { branches, pending, error, reload: useCallback(() => setAttempt(value => value + 1), []) };
}

export function WorktreeFields({ value, onChange, branches, disabled = false, prefix }: { value: CreateWorktree; onChange: (value: CreateWorktree) => void; branches: string[]; disabled?: boolean; prefix: string }) {
  return <fieldset className="kb-form kb-fieldset" disabled={disabled}><legend>Create a worktree</legend>
    <label className="kb-field">Branch mode<select className="kb-input" value={value.mode} onChange={event => { const mode = event.target.value as CreateWorktree['mode']; onChange({ ...value, mode, branchName: mode === 'existing' ? branches[0] ?? '' : value.branchName }); }}><option value="new">New branch</option><option value="existing">Existing branch</option></select></label>
    {value.mode === 'new' ? <><label className="kb-field">Branch name<input className="kb-input" value={value.branchName} onChange={event => onChange({ ...value, branchName: event.target.value })} required /></label><label className="kb-field">Source branch<input className="kb-input" list={prefix + '-branches'} value={value.sourceBranch ?? ''} onChange={event => onChange({ ...value, sourceBranch: event.target.value })} required /></label><datalist id={prefix + '-branches'}>{branches.map(branch => <option key={branch} value={branch} />)}</datalist></> : <label className="kb-field">Existing branch<select className="kb-input" value={value.branchName} onChange={event => onChange({ ...value, branchName: event.target.value })} required><option value="" disabled>Select a branch</option>{branches.map(branch => <option key={branch} value={branch}>{branch}</option>)}</select></label>}
    <label className="kb-field">Worktree path<input className="kb-input" value={value.path} onChange={event => onChange({ ...value, path: event.target.value })} placeholder="Absolute path to the worktree" required /></label><p className="kb-hint">The agent directory will use the project's relative path within this checkout. A cwd change does not grant filesystem access.</p>
  </fieldset>;
}

export function OperationStatus({ task, run }: { task: Task; run: RunCommand }) {
  const action = useAction(run); const operation = task.operation;
  if (!operation) return null;
  const text = operation.phase === 'waiting' ? 'Waiting for every conversation to become idle.' : operation.phase === 'failed' ? 'The operation needs attention. Recovery information has been retained.' : 'Worktree operation: ' + operation.phase + '.';
  return <div className="kb-operation" aria-live="polite"><p role="status">{text}</p>{operation.targetDirectory && <p className="kb-hint">Target: <code>{operation.targetDirectory}</code></p>}<p className="kb-hint">Conversations switched: {operation.switchedSessionIds.length} / {task.sessionIds.length}</p><ErrorNotice problem={operation.error ?? null} /><ErrorNotice problem={action.error} />{(operation.phase === 'failed' || operation.phase === 'waiting') && <div className="kb-actions"><button className="kb-button" disabled={action.pending} onClick={() => void action.execute({ type: 'operation.retry', taskId: task.id })}>{action.pending ? 'Working…' : 'Retry operation'}</button>{operation.phase === 'failed' && <button className="kb-button" disabled={action.pending} onClick={() => void action.execute({ type: 'operation.return', taskId: task.id })}>Return chats to base project</button>}</div>}</div>;
}

export function PendingTransitionStatus({ task, run, columnName }: { task: Task; run: RunCommand; columnName: string }) {
  const action = useAction(run); const transition = task.pendingTransition;
  if (!transition) return null;
  return <div className="kb-operation" aria-live="polite"><p role="status">{transition.status === 'sending' ? 'Sending the confirmed workflow instruction.' : transition.status === 'failed' ? 'The confirmed workflow action needs attention.' : 'The confirmed workflow action is waiting for the worktree context.'}</p><p className="kb-hint">Destination: {columnName}. {transition.mode === 'run' ? 'The entry instruction was explicitly approved.' : 'Move only; no agent instruction will run.'}</p><ErrorNotice problem={transition.error ?? null} /><ErrorNotice problem={action.error} />{!task.operation && transition.status !== 'sending' && <div className="kb-actions"><button className="kb-button" disabled={action.pending} onClick={() => void action.execute({ type: 'operation.retry', taskId: task.id })}>Retry confirmed action</button><button className="kb-button" disabled={action.pending} onClick={() => void action.execute({ type: 'operation.return', taskId: task.id })}>Cancel action and return to base</button></div>}</div>;
}

function UnclaimedWorktreesNotice({ task }: { task: Task }) {
  const entries = task.unclaimedWorktrees ?? [];
  if (entries.length === 0) return null;
  return <section className="kb-notice" role="note" aria-label="Unclaimed worktrees"><strong>Unclaimed checkouts remain on disk</strong><p>These paths are not the task's active worktree. They could not be verified and will not be attached or removed automatically. Inspect each checkout manually with Git before deciding what to keep.</p><ul className="kb-note-list">{entries.map((entry, index) => <li className="kb-note" key={entry.path + ':' + index}><p>Path: <code>{entry.path}</code></p><p>Branch: <code>{entry.branch}</code></p><ErrorNotice problem={entry.error} /></li>)}</ul></section>;
}

export function GitPanel({ task, project, api, run, onRemove }: { task: Task; project?: Project; api: ClientApi; run: RunCommand; onRemove: () => void }) {
  const branches = useBranches(api, task.id); const [mode, setMode] = useState('Create'); const [value, setValue] = useState<CreateWorktree>(() => initialWorktree(task, project)); const [attachPath, setAttachPath] = useState(''); const action = useAction(run);
  const blocked = Boolean(task.operation || task.pendingTransition) || Boolean(task.archivedAt); const tree = task.worktree;
  return <div className="kb-form"><UnclaimedWorktreesNotice task={task} /><dl className="kb-details"><dt>Base project path</dt><dd><code>{project?.projectPath ?? 'Project is unavailable'}</code></dd><dt>Git root</dt><dd><code>{project?.gitRootPath ?? 'Project is unavailable'}</code></dd><dt>Effective agent directory</dt><dd><code>{task.effectiveCwd}</code></dd></dl><p className="kb-hint">Native DSH workspace grouping and Files may still show the original project location.</p>
    {tree && <div className="kb-worktree"><h3>Current worktree</h3><dl className="kb-details"><dt>State</dt><dd>{tree.status}</dd><dt>Branch</dt><dd>{tree.branch}</dd><dt>Worktree path</dt><dd><code>{tree.path}</code></dd><dt>Ownership</dt><dd>{tree.owned ? 'Created by Kanban' : 'Attached external worktree'}</dd></dl><button type="button" className="kb-button kb-danger" disabled={blocked || action.pending} onClick={onRemove}>Remove worktree</button></div>}
    <OperationStatus task={task} run={run} />
    {(!tree || tree.status === 'error') && <><div className="kb-row"><h3>{tree ? 'Retry worktree setup' : 'Worktree setup'}</h3><button type="button" className="kb-button" onClick={branches.reload} disabled={branches.pending}>{branches.pending ? 'Loading branches…' : 'Refresh branches'}</button></div><ErrorNotice problem={branches.error} /><label className="kb-field">Setup method<select className="kb-input" value={mode} disabled={blocked || action.pending} onChange={event => setMode(event.target.value)}><option>Create</option><option>Attach existing worktree</option></select></label>
    <form className="kb-form" onSubmit={async event => { event.preventDefault(); if (blocked) return; if (mode === 'Create' && validWorktree(value)) await action.execute({ type: 'worktree.create', taskId: task.id, ...cleanWorktree(value) }); if (mode !== 'Create' && attachPath.trim()) await action.execute({ type: 'worktree.attach', taskId: task.id, path: attachPath.trim() }); }}>
      {mode === 'Create' ? <WorktreeFields value={value} onChange={setValue} branches={branches.branches} disabled={blocked || action.pending} prefix={'git-' + task.id} /> : <><label className="kb-field">Existing worktree path<input className="kb-input" required value={attachPath} disabled={blocked || action.pending} onChange={event => setAttachPath(event.target.value)} /></label><p className="kb-hint">Attach an existing checkout from this project's repository. The existing branch and directory are reused, not recreated.</p></>}
      <ErrorNotice problem={action.error} /><button className="kb-button kb-primary" disabled={blocked || action.pending || (mode === 'Create' ? !validWorktree(value) : !attachPath.trim())}>{action.pending ? 'Preparing…' : mode === 'Create' ? 'Create worktree' : 'Attach worktree'}</button>
    </form></>}
    {task.archivedAt && <p className="kb-hint">Restore this task before changing its worktree.</p>}
  </div>;
}
