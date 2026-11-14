import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Attention, ClientApi, Column, Task } from '../../shared/types.js';
import type { DeterministicStageReview } from '../../shared/deterministic.js';
import { ErrorNotice, Modal, type RunCommand } from '../ui.js';
import { useScriptReview } from '../script-review-provider.js';
import { IdentitySection } from './identity-section.js';
import { InitialSection } from './initial-section.js';
import { DeterministicSection } from './deterministic-section.js';
import { deterministicDraft } from './deterministic-draft.js';
import { InstructionSection } from './instruction-section.js';
import { transitionChoices, type StageEditorDraft, type StageEditorProblem } from './stage-editor-draft.js';
import { TransitionsSection } from './transitions-section.js';
import { useStageEditor } from './use-stage-editor.js';

export interface StageEditorDialogProps {
  readonly hubId: string;
  readonly boardId: string;
  readonly revision: number;
  /** The workflow's initial stage, which owns the board's task creation action. */
  readonly initialStageId: string;
  readonly column: Column;
  readonly columns: readonly Column[];
  readonly tasks: readonly Task[];
  readonly attention: Readonly<Record<string, Attention>>;
  readonly api: ClientApi;
  readonly run: RunCommand;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}

/** The one overlay that edits a stage, opened from either presentation's stage header. */
export function StageEditorDialog({ hubId, boardId, revision, initialStageId, column, columns, tasks, attention, api, run, onClose, onSaved }: StageEditorDialogProps) {
  const openReview = useScriptReview();
  const [review, setReview] = useState<DeterministicStageReview | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewChecked, setReviewChecked] = useState(false);
  const [storedStageId, setStoredStageId] = useState(column.id);
  const [savedUnapproved, setSavedUnapproved] = useState(false);
  const reviewRequest = useRef(0);
  const reviewStage = useCallback(async (stageId = storedStageId): Promise<DeterministicStageReview | null> => {
    if (!api.deterministicReview) return null;
    const requestId = ++reviewRequest.current;
    setReviewError(null);
    try {
      const value = await api.deterministicReview({ boardId, stageId });
      if (requestId !== reviewRequest.current) return null;
      setReview(value);
      return value;
    } catch (error) {
      if (requestId !== reviewRequest.current) return null;
      setReview(null); setReviewError(error instanceof Error ? error.message : 'The stored version could not be read.'); return null;
    }
    finally { if (requestId === reviewRequest.current) setReviewChecked(true); }
  }, [api, boardId, storedStageId]);
  // An agent stage has no version to show; a save that turns it deterministic
  // queries the stored version through handleSaved instead. A saved rename moves
  // the query to the identifier the board now stores.
  useEffect(() => { if (column.deterministic !== undefined) void reviewStage(); }, [reviewStage, column.deterministic]);
  // The save callback is created with the editor, so the latest draft id is read
  // through a ref rather than breaking the hook's argument cycle.
  const draftRef = useRef<StageEditorDraft | null>(null);
  const handleSaved = useCallback(() => {
    // The saved version is queried after the write, never assumed from the draft.
    const current = draftRef.current;
    const stageId = current?.id ?? column.id;
    setStoredStageId(stageId);
    if (current?.execution !== 'deterministic') { onSaved(); return; }
    void (async () => {
      const value = await reviewStage(stageId);
      // A successful save whose version cannot be read is still a saved,
      // unapproved version: keep the dialog open and surface the gap.
      if (value === null || value.approval === 'required') { setSavedUnapproved(true); return; }
      onSaved();
    })();
  }, [column.id, onSaved, reviewStage]);
  const editor = useStageEditor({ hubId, boardId, revision, column, columns, tasks, attention, run, onSaved: handleSaved });
  const { draft } = editor;
  draftRef.current = draft;
  // Editing the draft after a save invalidates the "saved but unapproved" prompt;
  // the next approval applies to the stored version, not the edited draft.
  const draftSignature = JSON.stringify(draft);
  useEffect(() => { setSavedUnapproved(false); }, [draftSignature]);
  const approve = useCallback(async () => {
    await openReview({ boardId, stageId: storedStageId });
    const value = await reviewStage(storedStageId);
    if (value?.approval === 'approved') onSaved();
  }, [boardId, storedStageId, onSaved, openReview, reviewStage]);
  // Every problem a field has is shown, not only the first one the draft reports.
  const problem = (field: StageEditorProblem['field']) => {
    const messages = editor.problems.filter(value => value.field === field).map(value => value.message);
    return messages.length === 0 ? undefined : messages.join(' ');
  };
  const blocked = editor.pending || !editor.changed;
  const refused = editor.attempted && editor.problems.length > 0;
  const deterministic = draft.execution === 'deterministic';
  if (savedUnapproved) {
    // The stored stage has a new revision. Editing this still-open dialog would
    // target the revision and identifier captured when it opened, so the post-save
    // state keeps only what the user can safely do next: review or close.
    return <Modal title="Stage saved" onClose={onClose}>
      <div className="kb-form">
        <p>The stage “{draft.name}” was saved.</p>
        <p className="kb-hint" role="status">This executable version is not approved yet. Cards that enter the stage will wait for it.</p>
        {review?.version.directoryDependent === true && <p className="kb-hint">The primary source is read from each execution directory, so a version resolved elsewhere may need its own approval.{review.version.representative === undefined ? '' : ' Resolved in ' + review.version.representative.projectName + ' (' + review.version.representative.directory + ').'}</p>}
        {review === null && <p className="kb-hint kb-problem" role="alert">The stored version could not be read here{reviewError === null ? '.' : ': ' + reviewError} Close and reopen the stage to review it.</p>}
        <div className="kb-actions">
          <button type="button" className="kb-button" onClick={onClose}>Close</button>
          {review !== null && <button type="button" className="kb-button kb-primary" onClick={() => { void approve(); }}>Review and approve script</button>}
        </div>
      </div>
    </Modal>;
  }
  const title = 'Edit stage';
  return <Modal title={title} onClose={onClose} busy={editor.pending}>
    <form className="kb-form kb-stage-editor" aria-label={title} aria-busy={editor.pending} onSubmit={event => { if (event.target !== event.currentTarget) return; event.preventDefault(); void editor.save(); }}>
      <IdentitySection
        name={draft.name}
        id={draft.id}
        disabled={editor.pending}
        renameBlock={editor.renameBlock}
        problem={problem}
        onName={value => editor.change('name', value)}
        onId={value => editor.change('id', value)}
      />
      <label className="kb-field">Execution mode<select className="kb-input" aria-label="Execution mode" disabled={editor.pending} value={draft.execution ?? 'agent'} onChange={event => editor.change('execution', event.target.value as 'agent' | 'deterministic')}><option value="agent">Agent instruction or manual</option><option value="deterministic">Deterministic script</option></select></label>
      {problem('execution') && <p className="kb-hint kb-problem" role="alert">{problem('execution')}</p>}
      {deterministic ? <DeterministicSection draft={draft.deterministic ?? deterministicDraft()} choices={transitionChoices(columns, column.id)} disabled={editor.pending} problem={problem} onChange={value => editor.change('deterministic', value)} /> : <>
      <InstructionSection value={draft.onEnterPrompt} disabled={editor.pending} onChange={value => editor.change('onEnterPrompt', value)} />
      <TransitionsSection
        choices={transitionChoices(columns, column.id)}
        mode={draft.mode}
        transitions={editor.transitions}
        disabled={editor.pending}
        problem={problem('transitions')}
        onMode={value => editor.change('mode', value)}
        onChoose={editor.chooseDestination}
        onCondition={editor.changeCondition}
      />
      </>}
      <InitialSection
        isInitial={column.id === initialStageId}
        willBeInitial={draft.initial}
        disabled={editor.pending}
        onMakeInitial={() => editor.change('initial', true)}
      />
      {(column.deterministic !== undefined || review !== null) && <div className="kb-script-approval" role="status">
        <p className="kb-hint">Stored script version: {review === null ? (reviewChecked ? 'unavailable' : 'checking…') : review.approval === 'approved' ? 'approved' : 'not approved'}.</p>
        {review?.version.directoryDependent === true && <p className="kb-hint">The primary source is read from each execution directory, so a version resolved elsewhere may need its own approval.{review.version.representative === undefined ? '' : ' Resolved in ' + review.version.representative.projectName + ' (' + review.version.representative.directory + ').'}</p>}
        {draft.execution === 'deterministic' && editor.changed && <p className="kb-hint">The draft is not approved. Save it, then review the stored version.</p>}
        {review !== null && review.approval === 'required' && <button type="button" className="kb-button" disabled={editor.pending || editor.changed} onClick={() => { void approve(); }}>Review and approve script</button>}
      </div>}
      {editor.warning !== null && <p className="kb-hint" role="status">{editor.warning}</p>}
      {refused && <p className="kb-hint kb-problem" role="alert">Fix the highlighted fields before saving.</p>}
      <ErrorNotice problem={editor.error} />
      <div className="kb-actions">
        <button type="button" className="kb-button" disabled={editor.pending} onClick={onClose}>Cancel</button>
        <button className="kb-button kb-primary" disabled={blocked}>{editor.pending ? 'Saving…' : 'Save stage'}</button>
      </div>
    </form>
  </Modal>;
}
