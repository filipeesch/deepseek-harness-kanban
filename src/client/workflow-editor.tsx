import { useEffect, useId, useRef, useState } from 'react';
import type { KanbanSnapshot, BoardState, Problem } from '../shared/types.js';
import { CodeEditor } from './code-editor.js';
import { analyzeWorkflow } from './workflow-diagnostics.js';
import { asProblem, ErrorNotice, useAction, type RunCommand } from './ui.js';

export interface WorkflowEditorProps {
  state: BoardState;
  run: RunCommand;
  yaml: string;
  baseRevision: number;
  onYamlChange: (yaml: string) => void;
  onSaved: (snapshot: KanbanSnapshot) => void;
  onReload: () => void;
  /** Present only when the Hub is published; publishes this save immediately after it lands locally. */
  onShare?: () => Promise<void>;
}

/** Rich workflow YAML editor backed by the shared parser and a controlled CodeMirror surface. */
export function WorkflowEditor({ state, run, yaml, baseRevision, onYamlChange, onSaved, onReload, onShare }: WorkflowEditorProps) {
  const action = useAction(run);
  const [analysis, setAnalysis] = useState(() => analyzeWorkflow(yaml));
  const [checking, setChecking] = useState(false);
  const [saved, setSaved] = useState(false);
  const [shareProblem, setShareProblem] = useState<Problem | null>(null);
  const [sharing, setSharing] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const firstAnalysis = useRef(true);
  const hintId = useId();

  useEffect(() => {
    if (firstAnalysis.current) { firstAnalysis.current = false; return; }
    setChecking(true);
    const timer = setTimeout(() => {
      setAnalysis(analyzeWorkflow(yaml));
      setChecking(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [yaml]);

  const dirty = yaml !== state.workflowYaml;
  const canSave = !action.pending && !sharing && !checking && analysis.status === 'valid' && Boolean(yaml.trim());

  function change(value: string) {
    if (action.pending || sharing) return;
    setSaved(false); setConfirmReload(false); setShareProblem(null);
    onYamlChange(value);
  }
  async function save(share = false) {
    if (!canSave) return;
    const result = await action.execute({ type: 'workflow.save', yaml, expectedRevision: baseRevision });
    if (!result) return;
    setSaved(true);
    setAnalysis(analyzeWorkflow(yaml));
    onSaved(result);
    if (!share || onShare === undefined) return;
    setSharing(true); setShareProblem(null);
    try { await onShare(); }
    catch (error) { setShareProblem(asProblem(error)); }
    finally { setSharing(false); }
  }
  function reload() {
    if (action.pending || sharing) return;
    if (dirty && !confirmReload) { setConfirmReload(true); return; }
    setConfirmReload(false); setSaved(false); setShareProblem(null); action.clearError();
    onReload();
  }

  return <div className="kb-form kb-workflow-editor">
    <div className="kb-workflow-editor-head">
      <div>
        <h3>Workflow YAML</h3>
        <p className="kb-hint" id={hintId}>Configure columns, groups, transitions, and optional entry instructions. WIP limits are not supported.</p>
      </div>
      <span className={'kb-editor-status ' + (checking ? 'is-checking' : analysis.status === 'valid' ? 'is-valid' : 'is-invalid')} role="status">
        {checking ? 'Checking…' : analysis.status === 'valid' ? 'Valid workflow' : analysis.issues.length + (analysis.issues.length === 1 ? ' issue' : ' issues')}
      </span>
    </div>
    <div className={'kb-workflow-surface' + (maximized ? ' is-maximized' : '')}>
      <CodeEditor value={yaml} onChange={change} label="Workflow YAML" readOnly={action.pending || sharing} diagnostics={analysis.diagnostics} onSaveShortcut={() => void save()} describedBy={hintId} />
      <button type="button" className="kb-button kb-button-subtle kb-editor-maximize" aria-label={maximized ? 'Restore workflow editor' : 'Maximize workflow editor'} aria-pressed={maximized} onClick={() => setMaximized(value => !value)}>{maximized ? 'Restore' : 'Maximize'}</button>
    </div>
    {analysis.issues.length > 0 && <ul className="kb-issues" aria-label="Workflow validation issues">{analysis.issues.map((issue, index) => <li key={issue.code + ':' + index}><code>{issue.code}</code> {issue.message}</li>)}</ul>}
    <ErrorNotice problem={action.error} />
    <ErrorNotice problem={shareProblem} />
    {confirmReload && <div className="kb-inline-confirm" role="alertdialog" aria-label="Discard workflow draft">
      <p>Discard the unsaved workflow draft and reload the saved workflow?</p>
      <div className="kb-actions"><button type="button" className="kb-button" onClick={() => setConfirmReload(false)}>Keep editing</button><button type="button" className="kb-button kb-danger" onClick={reload}>Discard and reload</button></div>
    </div>}
    <div className="kb-actions kb-workflow-actions">
      <button type="button" className="kb-button" disabled={action.pending || sharing} onClick={reload}>Reload saved workflow</button>
      <button type="button" className="kb-button" disabled={!canSave} onClick={() => void save(false)}>{action.pending || sharing ? 'Saving…' : 'Save workflow'}</button>
      {onShare !== undefined && <button type="button" className="kb-button kb-primary" disabled={!canSave} onClick={() => void save(true)}>{sharing ? 'Publishing…' : 'Save and share'}</button>}
    </div>
    {saved && <p role="status">Workflow saved.</p>}
  </div>;
}
