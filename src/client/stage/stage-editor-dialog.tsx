import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Attention, ClientApi, Column, Task, WorkflowAgent } from '../../shared/types.js';
import { ErrorNotice, Modal, Tabs, type RunCommand } from '../ui.js';
import { useScriptReview } from '../script-review-provider.js';
import { IdentitySection } from './identity-section.js';
import { AgentSection } from './agent-section.js';
import { InitialSection } from './initial-section.js';
import { InstructionSection } from './instruction-section.js';
import { ProgramSection } from './program-section.js';
import { InputsSection } from './inputs-section.js';
import { ExitsSection } from './exits-section.js';
import { DecisionSection } from './decision-section.js';
import { emptyDecisionDraft } from './decision-draft.js';
import { ApprovalSection } from './approval-section.js';
import { TransitionsSection } from './transitions-section.js';
import { StageSavedNotice } from './stage-saved-notice.js';
import { useStageEditor } from './use-stage-editor.js';
import { useStageReview } from './use-stage-review.js';
import { ProblemNotice } from './problem-notice.js';
import { scriptedDraft } from './scripted-draft.js';
import { stagePatch, transitionChoices, type StageEditorDraft } from './stage-editor-draft.js';
import { firstProblemTab, problemMessage, type StageProblem } from './stage-problem.js';
import { stageEditorTabs, stageTabLabel, stageTabOfField, type StageEditorTab } from './stage-tabs.js';

export interface StageEditorDialogProps {
  readonly hubId: string;
  readonly boardId: string;
  readonly revision: number;
  /** The workflow's initial stage, which owns the board's task creation action. */
  readonly initialStageId: string;
  readonly column: Column;
  readonly columns: readonly Column[];
  /** The board's declared agents, offered as the stage's conversation; absent offers the main one only. */
  readonly agents?: readonly WorkflowAgent[];
  readonly tasks: readonly Task[];
  readonly attention: Readonly<Record<string, Attention>>;
  readonly api: ClientApi;
  readonly run: RunCommand;
  /** The tab the opening surface works in; Stage when it names none. */
  readonly initialTab?: StageEditorTab;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}

/**
 * The one overlay that edits a stage, opened from either presentation's stage header.
 *
 * The shell owns the tabs, the draft, the save, and the approval state; each tab
 * contributes only the fields it owns. One width and one height hold across tabs, so
 * selecting another tab never resizes the overlay and only the panel scrolls.
 */
export function StageEditorDialog({ hubId, boardId, revision, initialStageId, column, columns, agents = [], tasks, attention, api, run, initialTab, onClose, onSaved }: StageEditorDialogProps) {
  const id = useId();
  const openReview = useScriptReview();
  const review = useStageReview({ api, boardId, initialStageId: column.id });
  // The stored-version query is read through a ref: saving a rename moves the stored
  // identifier, and an effect keyed to the query itself would supersede the very load
  // that decides whether the saved version still needs a review.
  const loadReview = useRef(review.load);
  loadReview.current = review.load;
  const [tab, setTab] = useState<StageEditorTab>(initialTab ?? 'stage');
  const [savedUnapproved, setSavedUnapproved] = useState(false);
  // The save callback is created with the editor, so the latest draft id is read
  // through a ref rather than breaking the hook's argument cycle.
  const draftRef = useRef<StageEditorDraft | null>(null);
  // An agent stage has no version to show; a save that turns it scripted queries the
  // stored version through handleSaved instead. A saved rename moves the query to
  // the identifier the board now stores.
  const storedHasProgram = column.scripted !== undefined;
  useEffect(() => { if (storedHasProgram) void loadReview.current(); }, [column.id, storedHasProgram]);
  const handleSaved = useCallback(() => {
    // The saved version is queried after the write, never assumed from the draft.
    const current = draftRef.current;
    const stageId = current?.id ?? column.id;
    review.setStoredStageId(stageId);
    // Only a save that stored a program can leave a version waiting; any other field
    // closes the editor as usual, even when the stored program is still unapproved.
    const storedProgram = current !== null && stagePatch(current, column).scripted !== undefined;
    if (current?.execution !== 'scripted' || !storedProgram) { onSaved(); return; }
    void (async () => {
      const value = await review.load(stageId);
      // A version that still needs review keeps the notice: review it, or close.
      if (value === null || value.approval === 'required') { setSavedUnapproved(true); return; }
      onSaved();
    })();
  }, [column.id, onSaved, review]);
  const editor = useStageEditor({ hubId, boardId, revision, column, columns, tasks, attention, run, onSaved: handleSaved });
  const { draft } = editor;
  draftRef.current = draft;
  const execution = draft.execution ?? 'agent';
  const scripted = execution === 'scripted';
  const tabs = stageEditorTabs(execution);
  // A requested tab that the stage has no content for falls back to Stage immediately,
  // so the editor never paints a tab row with no panel under it.
  const selected: StageEditorTab = tabs.includes(tab) ? tab : 'stage';
  // A stage that stops authoring a program loses the tabs that describe one; the
  // selected tab resolves that synchronously below, so no state has to be repaired.
  const approve = useCallback(async () => {
    await openReview({ boardId, stageId: review.storedStageId });
    const value = await review.load(review.storedStageId);
    if (value?.approval === 'approved') onSaved();
  }, [boardId, onSaved, openReview, review]);
  // Every problem a field has is shown, not only the first one the draft reports.
  const problem = (field: StageProblem['field']) => problemMessage(editor.problems, field);
  const refused = editor.attempted && editor.problems.length > 0;
  const blocked = editor.pending || !editor.changed;
  /** Save the draft, and take the author to the first tab that holds a problem. */
  const save = useCallback(async () => {
    const refused = await editor.save();
    if (refused.length === 0) return;
    const target = firstProblemTab(refused, tabs, stageTabOfField);
    if (target !== undefined) setTab(target);
  }, [editor, tabs]);
  if (savedUnapproved) {
    // The stored stage has a new revision. Editing this still-open dialog would
    // target the revision and identifier captured when it opened, so the post-save
    // state keeps only what the user can safely do next: review or close.
    return <StageSavedNotice
      name={draft.name}
      review={review.review}
      reviewError={review.reviewError}
      pending={editor.pending}
      onClose={onClose}
      onApprove={() => { void approve(); }}
    />;
  }
  const scriptedDraftNow = draft.scripted ?? scriptedDraft();
  const panels: ReadonlyArray<{ tab: StageEditorTab; render: () => React.ReactNode }> = [
    {
      tab: 'stage',
      render: () => <>
        <IdentitySection
          name={draft.name}
          description={draft.description}
          id={draft.id}
          disabled={editor.pending}
          renameBlock={editor.renameBlock}
          problem={problem}
          onName={value => editor.change('name', value)}
          onDescription={value => editor.change('description', value)}
          onId={value => editor.change('id', value)}
        />
        {execution === 'agent' && <AgentSection
          agents={agents}
          value={draft.agent}
          disabled={editor.pending}
          problem={problem}
          onChange={value => editor.change('agent', value)}
        />}
        <fieldset className="kb-fieldset">
          <legend>Behavior</legend>
          <label className="kb-field">Execution mode<select className="kb-input" aria-label="Execution mode" disabled={editor.pending} value={execution} onChange={event => editor.change('execution', event.target.value as 'agent' | 'scripted' | 'decision')}><option value="agent">Agent instruction or manual</option><option value="scripted">Scripted step</option><option value="decision">Decision step</option></select></label>
          <ProblemNotice message={problem('execution')} />
          <InitialSection
            isInitial={column.id === initialStageId}
            willBeInitial={draft.initial}
            disabled={editor.pending}
            onMakeInitial={() => editor.change('initial', true)}
          />
        </fieldset>
      </>,
    },
    {
      tab: 'execution',
      render: () => scripted
        ? <ProgramSection draft={scriptedDraftNow} problem={problem} disabled={editor.pending} active={selected === 'execution'} onSave={() => { void save(); }} onChange={value => editor.change('scripted', value)} />
        : <InstructionSection value={draft.onEnterPrompt} disabled={editor.pending} onChange={value => editor.change('onEnterPrompt', value)} />,
    },
    {
      tab: 'routing',
      render: () => scripted
        ? <ExitsSection draft={scriptedDraftNow} choices={transitionChoices(columns, column.id)} problem={problem} disabled={editor.pending} onChange={value => editor.change('scripted', value)} />
        : <TransitionsSection
            choices={transitionChoices(columns, column.id)}
            mode={draft.mode}
            transitions={editor.transitions}
            disabled={editor.pending}
            problem={problem('transitions')}
            onMode={value => editor.change('mode', value)}
            onChoose={editor.chooseDestination}
            onCondition={editor.changeCondition}
          />,
    },
    {
      tab: 'inputs',
      render: () => <InputsSection draft={scriptedDraftNow} problem={problem} disabled={editor.pending} onChange={value => editor.change('scripted', value)} />,
    },
    {
      tab: 'decision',
      render: () => <DecisionSection draft={draft.decision ?? emptyDecisionDraft()} choices={transitionChoices(columns, column.id)} problem={problem} disabled={editor.pending} onChange={value => editor.change('decision', value)} />,
    },
    {
      tab: 'approval',
      render: () => <ApprovalSection review={review.review} reviewError={review.reviewError} checked={review.reviewChecked} storedHasProgram={storedHasProgram} changed={editor.changed} pending={editor.pending} onApprove={() => { void approve(); }} />,
    },
  ];
  const available = panels.filter(panel => tabs.includes(panel.tab));
  const problemTabs = new Set(tabs.filter(value => editor.problems.some(entry => stageTabOfField(entry.field) === value)));
  const title = 'Edit stage';
  return <Modal title={title} onClose={onClose} busy={editor.pending} size="stage">
    <form className="kb-form kb-stage-form" aria-label={title} aria-busy={editor.pending} onSubmit={event => { if (event.target !== event.currentTarget) return; event.preventDefault(); void save(); }}>
      <div className="kb-stage-tabs">
        <Tabs label="Stage editor tabs" values={tabs.map(stageTabLabel)} selected={stageTabLabel(selected)} onSelect={label => { const next = tabs.find(value => stageTabLabel(value) === label); if (next !== undefined) setTab(next); }} id={id} problems={new Set([...problemTabs].map(stageTabLabel))} />
      </div>
      <div className="kb-stage-panels">
        {available.map(panel => <section
          key={panel.tab}
          className="kb-stage-panel"
          role="tabpanel"
          id={id + '-panel-' + stageTabLabel(panel.tab)}
          aria-labelledby={id + '-tab-' + stageTabLabel(panel.tab)}
          hidden={selected !== panel.tab}
        >{panel.render()}</section>)}
      </div>
      <div className="kb-stage-actions">
        <div className="kb-stage-status">
          {editor.warning !== null && <p className="kb-hint" role="status">{editor.warning}</p>}
          {refused && <p className="kb-hint kb-problem" role="alert">Fix the highlighted fields before saving.</p>}
          <ErrorNotice problem={editor.error} />
        </div>
        <div className="kb-actions">
          <button type="button" className="kb-button" disabled={editor.pending} onClick={onClose}>Cancel</button>
          <button className="kb-button kb-primary" disabled={blocked}>{editor.pending ? 'Saving…' : 'Save stage'}</button>
        </div>
      </div>
    </form>
  </Modal>;
}