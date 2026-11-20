import React, { useState } from 'react';
import type {
  ClientApi, HubState, KanbanSnapshot, Problem, WorkflowImportDecision, WorkflowImportEntry,
  WorkflowImportPlan, WorkflowImportResult, WorkflowImportSettlement,
} from '../../../shared/types.js';
import { asProblem, ErrorNotice, Modal, type RunCommand } from '../../ui.js';
import { boardNameKey } from '../../../domain/workflow-transfer/plan.js';
import { toBase64, type WorkflowFilePort } from './transfer-files.js';

/**
 * Import: choose one document, read what it would do, settle each conflict, apply.
 *
 * The surface is one dialog. Choosing a file reads the document and renders its
 * plan; the plan's rows are the settlement controls; **Import** applies at once.
 * There is no second confirmation, and the host's result stays visible with every
 * entry it reports, because a partial application is the behavior this product
 * chose for an import.
 */

/** The shared policy's labels: the row control uses the shorter form of the same choice. */
const POLICY_LABEL: Record<WorkflowImportSettlement, string> = { replace: 'Replace', copy: 'Create a copy', skip: 'Skip' };
const ROW_LABEL: Record<WorkflowImportSettlement, string> = { replace: 'Replace', copy: 'Copy', skip: 'Skip' };

/** How one conflict is settled, with the copy name the settlement uses. */
interface Settlement { readonly settlement: WorkflowImportSettlement; readonly copyName: string }

/** The settlement a conflict starts on: the shared policy, not yet overridden. */
function defaultSettlement(entry: WorkflowImportEntry, policy: WorkflowImportSettlement): Settlement {
  return { settlement: policy, copyName: entry.copyName ?? entry.name };
}

/** The settlements a freshly read plan starts with. */
function initialSettlements(entries: readonly WorkflowImportEntry[], policy: WorkflowImportSettlement): Record<string, Settlement> {
  const result: Record<string, Settlement> = {};
  for (const entry of entries) {
    if (entry.blockReason === 'name-conflict') result[entry.name] = defaultSettlement(entry, policy);
  }
  return result;
}

/**
 * Why one row's own settlement cannot be applied, or null when it can.
 *
 * Only a settlement the person configured is a row problem. An entry the host
 * already reported as unreadable is not one: the import applies the boards it can
 * and reports that entry as failed, which is the behavior the product chose.
 */
function rowProblem(entry: WorkflowImportEntry, settlement: Settlement | undefined, existing: readonly string[], copies: readonly string[]): string | null {
  if (entry.blockReason !== 'name-conflict' || settlement === undefined) return null;
  if (settlement.settlement !== 'copy') return null;
  const trimmed = settlement.copyName.trim();
  if (trimmed.length === 0) return 'A copy needs a name.';
  const folded = boardNameKey(trimmed);
  if (existing.includes(folded)) return 'A board named "' + trimmed + '" already exists in this Hub.';
  if (copies.filter(name => name === folded).length > 1) return 'Another copy uses the name "' + trimmed + '".';
  return null;
}

/** The stages a replacement would strand, as one sentence. */
function orphanedHint(orphaned: WorkflowImportEntry['orphaned']): string {
  return orphaned.map(value => 'stage "' + value.columnId + '" holds ' + String(value.cards) + ' card' + (value.cards === 1 ? '' : 's')).join(' and ') + ', which the imported workflow does not define. Move those cards first.';
}

/** One row's destination as a sentence, naming the board it would overwrite. */
function describeEntry(entry: WorkflowImportEntry, settlement: Settlement | undefined, targetName: string | undefined): string {
  if (entry.blockReason === 'invalid-workflow') return 'cannot be read, and will be reported as failed';
  if (entry.blockReason !== 'name-conflict') return entry.destination === 'create' ? 'creates a new board' : entry.destination;
  if (settlement === undefined) return 'needs a choice';
  if (settlement.settlement === 'replace') return targetName === undefined ? 'replaces the existing board' : 'replaces "' + targetName + '"';
  if (settlement.settlement === 'skip') return 'is left unchanged';
  return 'creates a copy as "' + settlement.copyName + '"';
}

export function ImportBoardsDialog({ hub, api, files, run, onClose, onApplied }: {
  hub: HubState;
  api?: ClientApi;
  files: WorkflowFilePort;
  run: RunCommand;
  onClose: () => void;
  onApplied?: (snapshot: KanbanSnapshot) => void;
}) {
  const [archive, setArchive] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [plan, setPlan] = useState<WorkflowImportPlan | null>(null);
  const [policy, setPolicy] = useState<WorkflowImportSettlement>('copy');
  const [settlements, setSettlements] = useState<Record<string, Settlement>>({});
  // A row the person settled themselves stops following the shared policy; every
  // other conflict restates the policy when the person changes it.
  const [overridden, setOverridden] = useState<ReadonlySet<string>>(() => new Set());
  const [result, setResult] = useState<WorkflowImportResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Problem | null>(null);
  const existing = hub.boards.map(board => boardNameKey(board.name));
  const entries = plan?.entries ?? [];
  const conflicts = entries.filter(entry => entry.blockReason === 'name-conflict');
  const copyNames = conflicts
    .filter(entry => settlements[entry.name]?.settlement === 'copy')
    .map(entry => boardNameKey(settlements[entry.name]!.copyName));
  const problems = entries.flatMap(entry => {
    const reason = rowProblem(entry, settlements[entry.name], existing, copyNames);
    return reason === null ? [] : [reason];
  });
  // An applied plan is not applied again: the person chooses a file or closes, so a
  // second press cannot repeat a write the host has already committed.
  const canApply = plan !== null && archive !== null && !pending && api !== undefined && problems.length === 0 && result === null;

  async function choose(): Promise<void> {
    setError(null); setPlan(null); setResult(null); setArchive(null);
    let chosen;
    try { chosen = await files.choose(); }
    catch (failure) { setError(asProblem(failure)); return; }
    if (chosen === null) return;
    if (api?.readWorkflowImport === undefined) { setError({ code: 'TRANSFER_UNAVAILABLE', message: 'This host cannot read a workflow export.' }); return; }
    setFileName(chosen.fileName);
    setPending(true);
    try {
      const text = toBase64(chosen.bytes);
      const read = await api.readWorkflowImport({ hubId: hub.id, archive: text });
      setArchive(text);
      setPlan(read);
      setSettlements(initialSettlements(read.entries, policy));
      setOverridden(new Set());
    } catch (failure) { setError(asProblem(failure)); setFileName(null); }
    finally { setPending(false); }
  }

  /** Restate the shared policy on every conflict the person has not overridden. */
  function applyPolicy(next: WorkflowImportSettlement): void {
    setPolicy(next);
    if (plan === null) return;
    setSettlements(previous => {
      const merged: Record<string, Settlement> = {};
      for (const entry of plan.entries) {
        if (entry.blockReason !== 'name-conflict') continue;
        const current = previous[entry.name];
        merged[entry.name] = current !== undefined && overridden.has(entry.name) ? current : defaultSettlement(entry, next);
      }
      return merged;
    });
  }

  /** Settle one row, which stops it following the shared policy. */
  function settle(entry: WorkflowImportEntry, next: WorkflowImportSettlement, copyName?: string): void {
    setSettlements(previous => ({
      ...previous,
      [entry.name]: { settlement: next, copyName: copyName ?? previous[entry.name]?.copyName ?? entry.copyName ?? entry.name },
    }));
    setOverridden(previous => new Set(previous).add(entry.name));
  }

  async function apply(): Promise<void> {
    if (!canApply || archive === null || plan === null) return;
    setPending(true); setError(null); setResult(null);
    try {
      const decisions: WorkflowImportDecision[] = conflicts.map(entry => {
        const settlement = settlements[entry.name] ?? defaultSettlement(entry, policy);
        return { name: entry.name, settlement: settlement.settlement, ...(settlement.settlement === 'copy' ? { copyName: settlement.copyName.trim() } : {}), targetBoardId: entry.targetBoardId };
      });
      const snapshot = await run({ type: 'hub.workflows.import', hubId: hub.id, archive, decisions });
      onApplied?.(snapshot);
      setResult(snapshot.workflowImport ?? null);
    } catch (failure) { setError(asProblem(failure)); }
    finally { setPending(false); }
  }

  return <Modal title="Import workflows" onClose={onClose} busy={pending} size="settings">
    <div className="kb-form" aria-label="Import workflows">
      <div className="kb-row">
        <span className="kb-hint" role="status">{fileName ?? 'No file chosen.'}</span>
        <button type="button" className="kb-button" disabled={pending} onClick={() => void choose()}>{fileName === null ? 'Choose file…' : 'Choose another file…'}</button>
      </div>
      <p className="kb-hint">A workflow export is a compressed document of at most 4 MB.</p>
      {plan !== null && <>
        <p className="kb-hint" role="status">Exported from <strong>{plan.origin}</strong>, to be imported into <strong>{hub.name}</strong>: {entries.length === 1 ? '1 workflow' : String(entries.length) + ' workflows'}.</p>
        {conflicts.length > 0 && <div className="kb-field">
          <span>For every conflict, when a name already exists</span>
          <div className="kb-actions kb-policy-actions">
            {(['replace', 'copy', 'skip'] as const).map(value => <button key={value} type="button" className={policy === value ? 'kb-button kb-primary' : 'kb-button'} aria-pressed={policy === value} disabled={pending} onClick={() => applyPolicy(value)}>{POLICY_LABEL[value]}</button>)}
          </div>
        </div>}
        <ul className="kb-project-list kb-board-list">
          {entries.map(entry => {
            const settlement = settlements[entry.name];
            const reason = rowProblem(entry, settlement, existing, copyNames);
            return <li key={entry.name}>
              <strong>{entry.name}</strong>{' — '}<span>{describeEntry(entry, settlement, hub.boards.find(board => board.id === entry.targetBoardId)?.name)}</span>
              {entry.blockReason === 'name-conflict' && <span className="kb-badge">{overridden.has(entry.name) ? 'Custom choice' : 'Follows the policy'}</span>}
              {entry.blockReason === 'name-conflict' && <div className="kb-actions">
                {(['replace', 'copy', 'skip'] as const).map(value => <button key={value} type="button" className="kb-button" aria-pressed={settlement?.settlement === value} aria-label={value + ' ' + entry.name} disabled={pending} onClick={() => settle(entry, value)}>{ROW_LABEL[value]}</button>)}
              </div>}
              {entry.blockReason === 'name-conflict' && settlement?.settlement === 'copy' && <label className="kb-field kb-copy-name">Copy name
                <input className="kb-input" aria-label={'Copy name for ' + entry.name} value={settlement.copyName} disabled={pending} onChange={event => settle(entry, 'copy', event.target.value)} />
              </label>}
              {reason !== null && <p className="kb-problem" role="alert">{reason}</p>}
              {entry.droppedProjectKeys.length > 0 && <p className="kb-hint">Project scope drops {entry.droppedProjectKeys.join(', ')}{entry.scopeOpened ? ', and the board then accepts every project of this Hub' : ''}.</p>}
              {entry.realigned.length > 0 && <p className="kb-hint">Renames {entry.realigned.map(value => value.from + ' to ' + value.to).join(', ')}, keeping their cards.</p>}
              {entry.orphaned.length > 0 && settlement?.settlement === 'replace' && <p className="kb-hint">Cannot replace yet: {orphanedHint(entry.orphaned)}.</p>}
              {entry.externalScriptSources.length > 0 && <p className="kb-hint">Reads an external file: {entry.externalScriptSources.join(', ')}.</p>}
            </li>;
          })}
        </ul>
      </>}
      {result !== null && <div className="kb-notice" role="status">
        <p>Import finished.</p>
        <ul className="kb-batch-list">{result.outcomes.map(outcome => <li key={outcome.name + outcome.status}><strong>{outcome.name}</strong>{' — '}{outcome.status}{outcome.status === 'failed' && outcome.reason !== undefined ? ': ' + outcome.reason : ''}</li>)}</ul>
      </div>}
      <ErrorNotice problem={error} />
      <div className="kb-actions">
        <button type="button" className="kb-button" disabled={pending} onClick={onClose}>Close</button>
        <button type="button" className="kb-button kb-primary" disabled={!canApply} onClick={() => void apply()}>{pending ? 'Importing…' : 'Import'}</button>
      </div>
    </div>
  </Modal>;
}
