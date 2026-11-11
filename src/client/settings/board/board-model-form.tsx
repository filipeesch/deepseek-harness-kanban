import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Board, ClientApi, HubState, ModelCatalog, ModelSelection, Problem } from '../../../shared/types.js';
import { writeBoardModelField } from '../../../domain/board-model-field.js';
import { modelIsAvailable, modelSelectionKey } from '../../../domain/model-preference.js';
import { asProblem, ErrorNotice, type RunCommand } from '../../ui.js';
import { ModelPickerField } from '../model-picker-field.js';

export interface BoardModelFormProps {
  hub: HubState;
  board: Board;
  run: RunCommand;
  api?: ClientApi;
  /**
   * The workflow document as it is **saved**. This form writes one root key into
   * that document and nowhere else, so it must never be handed another surface's
   * unsaved draft: it would commit edits the person never asked to save here.
   */
  yaml: string;
  /** The board revision that saved document carries, so a concurrent edit is refused. */
  baseRevision: number;
  /**
   * Whether the workflow editor holds unsaved edits. While it does, this form waits:
   * both surfaces write the same document, and only one of them can win a revision.
   */
  workflowEditing?: boolean;
}

/**
 * The model every new conversation of this board starts on. The choice is one
 * root key of the workflow document, so it travels with the board the rest of
 * the workflow does — comments, formatting, and a teammate's concurrent edit all
 * stay in the hands of the ordinary workflow save, which is the command this
 * form uses. Nothing is written when the document cannot be parsed.
 */
export function BoardModelForm({ hub, board, run, api, yaml, baseRevision, workflowEditing = false }: BoardModelFormProps) {
  const stored = board.workflow.model;
  /** The stored selection whole, so a saved effort-only change elsewhere lands here too. */
  const storedKey = modelSelectionKey(stored);
  const [selection, setSelection] = useState<ModelSelection | undefined>(stored);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<Problem | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Problem | null>(null);
  // Only the newest read may write the catalog: two Reload clicks in a row must not
  // let the slower answer overwrite the fresher one.
  const request = useRef(0);
  const loadCatalog = useCallback((): void => {
    if (api === undefined) return;
    const token = ++request.current;
    void api.modelCatalog(true).then(
      value => { if (request.current === token) { setCatalog(value); setCatalogError(null); } },
      failure => { if (request.current === token) { setCatalog(null); setCatalogError(asProblem(failure)); } },
    );
  }, [api]);
  useEffect(() => { setSelection(board.workflow.model); }, [storedKey]);
  useEffect(() => { loadCatalog(); }, [loadCatalog]);
  const dirty = modelSelectionKey(selection) !== storedKey;
  const missing = stored !== undefined && catalog !== null && !modelIsAvailable(catalog, stored);

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true); setError(null);
    try {
      await run({ type: 'board.workflow.save', hubId: hub.id, boardId: board.id, yaml: writeBoardModelField(yaml, selection), expectedRevision: baseRevision });
    } catch (failure) { setError(asProblem(failure)); }
    finally { setPending(false); }
  }

  const fallback = catalog?.default;
  return <form className="kb-form" aria-label="Board default model" onSubmit={event => { void save(event); }}>
    <h3>Default model</h3>
    <p className="kb-hint">Every new conversation on this board starts on this model. Choosing the host default leaves the choice to DSH.</p>
    <ModelPickerField value={selection} catalog={catalog} disabled={pending} onChange={setSelection} {...(api === undefined ? {} : { refresh: loadCatalog })} />
    {catalogError !== null && <p className="kb-hint" role="status">The model catalog is unavailable: {catalogError.message} The board's stored model, when present, is kept.</p>}
    {missing && <p className="kb-hint" role="status">The board's model, {stored.provider} · {stored.model}, is not offered by this host. New conversations on this board start on {fallback === undefined ? 'the host default model' : fallback.provider + ' · ' + fallback.model} instead; conversations already open keep theirs, and the stored choice is kept.</p>}
    {workflowEditing && <p className="kb-hint" role="status">Save or discard the workflow edits in the workflow editor before changing the default model.</p>}
    <div className="kb-actions">
      <button className="kb-button kb-primary" disabled={pending || !dirty || workflowEditing}>{pending ? 'Saving…' : 'Save model'}</button>
      {!pending && !dirty && !workflowEditing && <span className="kb-hint">No changes to save.</span>}
    </div>
    <ErrorNotice problem={error} />
  </form>;
}
