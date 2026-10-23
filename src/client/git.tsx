import React, { useId, useState } from 'react';
import type { ClientApi, CreateWorktree, Project, Task } from '../shared/types.js';
import { asProblem, ErrorNotice, useAction, type RunCommand } from './ui.js';
import { taskTitleSlug } from '../shared/worktree-name.js';
import { cleanWorktree, validWorktree, type WorktreeDraft } from './worktree-draft.js';

export function useBranches(api: ClientApi, taskId: string) {
  const [branches, setBranches] = useState<string[]>([]); const [pending, setPending] = useState(false); const [error, setError] = useState<ReturnType<typeof asProblem> | null>(null); const [attempt, setAttempt] = useState(0);
  React.useEffect(() => { let current = true; setPending(true); setError(null); void Promise.resolve().then(() => api.branches(taskId)).then(value => { if (current) setBranches(value); }, failure => { if (current) setError(asProblem(failure)); }).finally(() => { if (current) setPending(false); }); return () => { current = false; }; }, [api, taskId, attempt]);
  return { branches, pending, error, reload: React.useCallback(() => setAttempt(value => value + 1), []) };
}

function BranchInput({ label, value, onChange, branches, placeholder }: { label: string; value: string; onChange: (value: string) => void; branches: string[]; placeholder?: string }) {
  const id = useId();
  return <label className="kb-field">{label}<input className="kb-input" role="combobox" aria-label={label} list={id} value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} autoComplete="off" /><datalist id={id}>{branches.map(branch => <option key={branch} value={branch} />)}</datalist>{branches.length === 0 && <span className="kb-hint">No local branches found.</span>}</label>;
}

export function WorktreeFields({ value, onChange, branches, disabled = false, canReset = false, onResetPath, defaultBranchName }: { value: CreateWorktree; onChange: (value: CreateWorktree) => void; branches: string[]; disabled?: boolean; canReset?: boolean; onResetPath?: () => void; defaultBranchName?: string }) {
  return <fieldset className="kb-form kb-fieldset" disabled={disabled}><legend>Create a worktree</legend>
    <label className="kb-field">Branch mode<select className="kb-input" value={value.mode} onChange={event => { const mode = event.target.value as CreateWorktree['mode']; onChange({ ...value, mode, branchName: mode === 'existing' ? branches[0] ?? '' : defaultBranchName || value.branchName }); }}><option value="new">New branch</option><option value="existing">Existing branch</option></select></label>
    {value.mode === 'new' ? <><label className="kb-field">Branch name<input className="kb-input" value={value.branchName} onChange={event => onChange({ ...value, branchName: event.target.value })} required /></label><BranchInput label="Source branch" value={value.sourceBranch ?? ''} onChange={sourceBranch => onChange({ ...value, sourceBranch })} branches={branches} placeholder="Project default or HEAD" /><p className="kb-hint">Leave the source empty to use the project&apos;s default branch or HEAD.</p></> : <BranchInput label="Existing branch" value={value.branchName} onChange={branchName => onChange({ ...value, branchName })} branches={branches} />}
    <label className="kb-field">Worktree path<div className="kb-input-row"><input className="kb-input" aria-label="Worktree path" value={value.path} onChange={event => onChange({ ...value, path: event.target.value })} placeholder="Absolute path to the worktree" required /><button type="button" className="kb-button" disabled={disabled || !canReset} onClick={onResetPath}>Use default path</button></div></label><p className="kb-hint">The agent directory will use the project's relative path within this checkout. A cwd change does not grant filesystem access.</p>
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
  return <section className="kb-notice kb-unclaimed" role="note" aria-label="Unclaimed worktrees"><strong>Unclaimed checkouts remain on disk</strong><p>These paths are not the task's active worktree and will not be attached or removed automatically.</p><ul className="kb-note-list">{entries.map((entry, index) => <li className="kb-note" key={entry.path + ':' + index}><p>Path: <code>{entry.path}</code></p><p>Branch: <code>{entry.branch}</code></p><ErrorNotice problem={entry.error} /></li>)}</ul></section>;
}

export function GitPanel({ task, project, api, run, worktreeBasePath, draft }: { task: Task; project?: Project; api: ClientApi; run: RunCommand; worktreeBasePath?: string; draft: WorktreeDraft }) {
  const branches = useBranches(api, task.id); const [createMode, setCreateMode] = useState<'create' | 'attach'>('create'); const [attachPath, setAttachPath] = useState(''); const [confirmRemove, setConfirmRemove] = useState(false); const action = useAction(run);
  const blocked = Boolean(task.operation || task.pendingTransition); const tree = task.worktree;
  const defaultBranchName = draft.suggestion?.branchName ?? taskTitleSlug(task.title);
  const stateLabel = !tree ? 'none' : tree.status === 'ready' ? 'ready' : tree.status === 'preparing' ? 'creating' : 'error';
  async function create() { if (blocked || !validWorktree(draft.value)) return; await action.execute({ type: 'worktree.create', taskId: task.id, ...cleanWorktree(draft.value) }); }
  async function attach() { if (blocked || !attachPath.trim()) return; await action.execute({ type: 'worktree.attach', taskId: task.id, path: attachPath.trim() }); }
  async function remove() { if (!tree || blocked) return; await action.execute({ type: 'worktree.remove', taskId: task.id, confirmed: true, expectedWorktreePath: tree.path }); }
  const statusLabel = stateLabel === 'ready' ? 'Ready' : stateLabel === 'creating' ? 'Creating' : stateLabel === 'error' ? 'Needs attention' : 'Not created';
  return <div className="kb-git">
    <UnclaimedWorktreesNotice task={task} />
    <section className="kb-git-card" aria-label="Worktree">
      <header className="kb-git-card-header">
        <div className="kb-git-heading"><h3>Worktree</h3><span className={'kb-status kb-status-' + stateLabel} role="status"><span className="kb-status-dot" aria-hidden="true" />{statusLabel}</span></div>
        <button type="button" className="kb-button kb-button-subtle" disabled={branches.pending} onClick={branches.reload}>{branches.pending ? 'Loading…' : 'Refresh branches'}</button>
      </header>
      {stateLabel === 'ready' && tree && <div className="kb-git-card-body">
        <dl className="kb-property-list">
          <div className="kb-property"><dt>Branch</dt><dd><code>{tree.branch}</code></dd></div>
          <div className="kb-property"><dt>Path</dt><dd className="kb-property-path"><code>{tree.path}</code></dd></div>
        </dl>
        <div className="kb-git-card-actions">
          {!confirmRemove ? <button type="button" className="kb-button kb-button-danger-quiet" disabled={blocked || action.pending} onClick={() => setConfirmRemove(true)}>Remove worktree</button> : <div className="kb-inline-confirm"><p>Remove the worktree at <code>{tree.path}</code>? The task and branch are kept.</p><div className="kb-actions"><button type="button" className="kb-button" disabled={action.pending} onClick={() => setConfirmRemove(false)}>Cancel</button><button type="button" className="kb-button kb-danger" disabled={action.pending} onClick={() => void remove()}>{action.pending ? 'Removing…' : 'Confirm worktree removal'}</button></div></div>}
        </div>
      </div>}
      {stateLabel === 'creating' && <div className="kb-git-card-body"><p className="kb-git-progress" role="status">Creating worktree…</p><p className="kb-hint">The task conversations will move to the checkout once it is ready.</p></div>}
      {(stateLabel === 'none' || stateLabel === 'error') && <div className="kb-git-card-body">
        {stateLabel === 'error' && <div className="kb-callout kb-callout-danger" role="alert"><strong>Worktree setup failed</strong><p>Review the error and retry, or attach an existing checkout.</p></div>}
        <div className="kb-segmented" role="group" aria-label="Worktree setup mode">
          <button type="button" className={'kb-segment' + (createMode === 'create' ? ' is-active' : '')} aria-pressed={createMode === 'create'} onClick={() => setCreateMode('create')}>Create new</button>
          <button type="button" className={'kb-segment' + (createMode === 'attach' ? ' is-active' : '')} aria-pressed={createMode === 'attach'} aria-label="Attach existing worktree" onClick={() => setCreateMode('attach')}>Attach existing</button>
        </div>
        <ErrorNotice problem={branches.error} /><ErrorNotice problem={draft.suggestionError} />{draft.suggestionError && <button type="button" className="kb-button" disabled={draft.suggestionPending} onClick={draft.reloadSuggestion}>Retry suggestion</button>}
        {createMode === 'create' ? <>
          <p className="kb-hint">{worktreeBasePath ? <>Worktree destinations default to <code>{worktreeBasePath}</code> plus the branch name.</> : 'Set a worktree base path in Configuration → General to prefill destinations. A destination is required before creating a worktree.'}</p>
          {draft.suggestionPending && <p className="kb-hint" role="status">Resolving worktree defaults…</p>}
          <WorktreeFields value={draft.value} onChange={draft.assign} branches={branches.branches} disabled={blocked || action.pending} defaultBranchName={defaultBranchName} canReset={Boolean(worktreeBasePath)} onResetPath={draft.resetPath} />
          <div className="kb-git-card-actions"><button type="button" className="kb-button kb-primary" disabled={blocked || action.pending || !validWorktree(draft.value)} onClick={() => void create()}>{action.pending ? 'Preparing…' : 'Create worktree'}</button></div>
        </> : <>
          <label className="kb-field">Existing worktree path<input className="kb-input" required value={attachPath} disabled={blocked || action.pending} onChange={event => setAttachPath(event.target.value)} /></label>
          <p className="kb-hint">Attach an existing checkout from this project's repository. The existing branch and directory are reused, not recreated.</p>
          <div className="kb-git-card-actions"><button type="button" className="kb-button kb-primary" disabled={blocked || action.pending || !attachPath.trim()} onClick={() => void attach()}>{action.pending ? 'Attaching…' : 'Attach worktree'}</button></div>
        </>}
      </div>}
      {task.operation && <div className="kb-git-card-body"><OperationStatus task={task} run={run} /></div>}
      <ErrorNotice problem={action.error} />
    </section>
    <details className="kb-git-card kb-details-card">
      <summary><span>Details</span><span className="kb-details-hint">Paths and ownership</span></summary>
      <div className="kb-details-body">
        <dl className="kb-property-list">
          <div className="kb-property"><dt>Base project path</dt><dd className="kb-property-path"><code>{project?.projectPath ?? 'Project is unavailable'}</code></dd></div>
          <div className="kb-property"><dt>Git root</dt><dd className="kb-property-path"><code>{project?.gitRootPath ?? 'Project is unavailable'}</code></dd></div>
          <div className="kb-property"><dt>Effective agent directory</dt><dd className="kb-property-path"><code>{task.effectiveCwd}</code></dd></div>
          {tree && <div className="kb-property"><dt>Ownership</dt><dd>{tree.owned ? 'Created by Kanban' : 'Attached external worktree'}</dd></div>}
        </dl>
        <p className="kb-hint">Native DSH workspace grouping and Files may still show the original project location.</p>
      </div>
    </details>
  </div>;
}
