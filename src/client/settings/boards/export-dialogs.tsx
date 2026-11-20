import React, { useMemo, useState } from 'react';
import type { ClientApi, HubState, Problem, WorkflowExportAdvisory, WorkflowExportResult } from '../../../shared/types.js';
import { asProblem, ErrorNotice, Modal } from '../../ui.js';
import { fromBase64, type WorkflowFilePort } from './transfer-files.js';

/**
 * Export: choose any subset of the Hub's boards and receive one compressed document.
 *
 * The confirm action is unavailable while nothing is selected, because an empty
 * document is not a meaningful export. A board whose scripted stage reads an
 * external file is exported and reported as an advisory, since the document
 * carries the reference and not the file's bytes.
 */
export function ExportBoardsDialog({ hub, api, files, onClose }: {
  hub: HubState;
  api?: ClientApi;
  files: WorkflowFilePort;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(hub.boards.map(board => board.id)));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Problem | null>(null);
  const [advisories, setAdvisories] = useState<readonly WorkflowExportAdvisory[]>([]);
  const [done, setDone] = useState<WorkflowExportResult | null>(null);
  const allSelected = hub.boards.length > 0 && selected.size === hub.boards.length;
  const canExport = selected.size > 0 && !pending && api?.exportWorkflows !== undefined;
  const label = useMemo(() => selected.size === 1 ? '1 board selected' : String(selected.size) + ' boards selected', [selected]);

  function toggle(boardId: string): void {
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(boardId)) next.delete(boardId); else next.add(boardId);
      return next;
    });
    setDone(null);
    setAdvisories([]);
  }

  async function run(): Promise<void> {
    if (api?.exportWorkflows === undefined || selected.size === 0) return;
    setPending(true); setError(null); setDone(null); setAdvisories([]);
    try {
      const result = await api.exportWorkflows({ hubId: hub.id, boardIds: [...selected] });
      files.download({ fileName: result.fileName, bytes: fromBase64(result.archive) });
      setDone(result);
      setAdvisories(result.advisories);
    } catch (failure) { setError(asProblem(failure)); }
    finally { setPending(false); }
  }

  return <Modal title="Export workflows" onClose={onClose} busy={pending} size="settings">
    <div className="kb-form" aria-label="Export workflows">
      <p className="kb-hint">Choose the boards to include. They are downloaded as one compressed document.</p>
      <div className="kb-row">
        <span className="kb-hint" role="status">{hub.boards.length === 0 ? 'This Hub has no boards.' : label}</span>
        <button type="button" className="kb-button" disabled={pending || hub.boards.length === 0} onClick={() => setSelected(allSelected ? new Set() : new Set(hub.boards.map(board => board.id)))}>{allSelected ? 'Clear selection' : 'Select all'}</button>
      </div>
      <ul className="kb-project-list kb-board-list">
        {hub.boards.map(board => <li key={board.id}>
          <label className="kb-field kb-checkbox-row">
            <input type="checkbox" checked={selected.has(board.id)} disabled={pending} aria-label={'Include board ' + board.name} onChange={() => toggle(board.id)} />
            <strong>{board.name}</strong>
          </label>
        </li>)}
      </ul>
      {advisories.length > 0 && <div className="kb-notice" role="status">
        <p>The document was downloaded. These boards carry content it cannot transport:</p>
        <ul className="kb-batch-list">{advisories.map(advisory => <li key={advisory.boardName + advisory.detail}><strong>{advisory.boardName}</strong> — {advisory.detail}</li>)}</ul>
      </div>}
      {done !== null && <p className="kb-hint" role="status">{done.boardCount === 1 ? '1 board downloaded' : String(done.boardCount) + ' boards downloaded'} as <code>{done.fileName}</code>.</p>}
      <ErrorNotice problem={error} />
      <div className="kb-actions">
        <button type="button" className="kb-button" disabled={pending} onClick={onClose}>Close</button>
        <button type="button" className="kb-button kb-primary" disabled={!canExport} onClick={() => void run()}>{pending ? 'Exporting…' : 'Export'}</button>
      </div>
    </div>
  </Modal>;
}
