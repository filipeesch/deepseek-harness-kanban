import React from 'react';
import type { Attention, Column, Task } from '../../shared/types.js';
import { ErrorNotice, Modal, type RunCommand } from '../ui.js';
import { IdentitySection } from './identity-section.js';
import { InitialSection } from './initial-section.js';
import { DeterministicSection } from './deterministic-section.js';
import { deterministicDraft } from './deterministic-draft.js';
import { InstructionSection } from './instruction-section.js';
import { transitionChoices, type StageEditorProblem } from './stage-editor-draft.js';
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
  readonly run: RunCommand;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}

/** The one overlay that edits a stage, opened from either presentation's stage header. */
export function StageEditorDialog({ hubId, boardId, revision, initialStageId, column, columns, tasks, attention, run, onClose, onSaved }: StageEditorDialogProps) {
  const editor = useStageEditor({ hubId, boardId, revision, column, columns, tasks, attention, run, onSaved });
  const { draft } = editor;
  // Every problem a field has is shown, not only the first one the draft reports.
  const problem = (field: StageEditorProblem['field']) => {
    const messages = editor.problems.filter(value => value.field === field).map(value => value.message);
    return messages.length === 0 ? undefined : messages.join(' ');
  };
  const blocked = editor.pending || !editor.changed;
  const refused = editor.attempted && editor.problems.length > 0;
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
      {draft.execution === 'deterministic' ? <DeterministicSection draft={draft.deterministic ?? deterministicDraft()} choices={transitionChoices(columns, column.id)} disabled={editor.pending} problem={problem} onChange={value => editor.change('deterministic', value)} /> : <>
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
