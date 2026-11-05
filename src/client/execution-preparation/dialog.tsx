import { useEffect, useId, useState } from 'react';
import { Modal, ProblemNotice } from '../ui.js';
import type { ExecutionPreparationController, PreparationState } from './controller.js';
import { NativeModelSeat, type PreparationSeat } from './model-seat.js';

export interface ExecutionPreparationDialogProps {
  state: PreparationState;
  controller: ExecutionPreparationController;
  seat?: PreparationSeat;
}

function titleOf(state: PreparationState): string {
  switch (state.phase) {
    case 'blocked': return 'Resolve the worktree binding first';
    case 'worktree': return 'Prepare the first execution';
    case 'provisioning': return 'Preparing the first execution';
    case 'model': return 'Choose the conversation model';
    default: return 'The preparation needs attention';
  }
}

/** The one preparation dialog: worktree question, provisioning, and the native model stage. */
export function ExecutionPreparationDialog({ state, controller, seat }: ExecutionPreparationDialogProps) {
  const summary = useId();
  const [selecting, setSelecting] = useState(false);
  useEffect(() => { if (state.phase !== 'model') setSelecting(false); }, [state.phase]);
  const busy = state.phase === 'provisioning';
  const close = () => controller.cancel();
  const identity = <p className="kb-preparation-identity"><strong>{state.taskTitle}</strong><span className="kb-hint">{state.stageName}</span></p>;

  return <Modal title={titleOf(state)} onClose={close} busy={busy} initialFocus="cancel" describedBy={summary}>
    <div className="kb-preparation">
      {state.phase === 'blocked' && <>
        {identity}
        <p id={summary}>This task has a worktree binding that is not ready. Resolve it in the Git section before starting the first execution. The execution will not start and the card will remain in its current stage.</p>
        <div className="kb-actions">
          <button type="button" className="kb-button" data-kb-initial-focus onClick={close}>Close</button>
        </div>
      </>}

      {state.phase === 'worktree' && <>
        {identity}
        <p id={summary}>{state.kind === 'run'
          ? 'Running the stage instruction starts the task\'s first execution. Create an isolated worktree for it, or continue in the base project.'
          : 'Moving this card to ' + state.stageName + ' starts the task\'s first execution. Create an isolated worktree for it, or continue in the base project.'}</p>
        <p>Create a worktree for this task?</p>
        {state.pending && <p className="kb-hint" role="status">Resolving the worktree defaults…</p>}
        {!state.pending && state.destinationMissing && <p className="kb-hint" role="note">No worktree destination can be derived. Configure a worktree base path before creating a worktree.</p>}
        <ProblemNotice problem={state.error} title="The worktree defaults need attention" />
        <div className="kb-actions">
          <button type="button" className="kb-button" data-kb-initial-focus disabled={busy} onClick={close}>Cancel</button>
          {state.failedStep === 'defaults' && <button type="button" className="kb-button" disabled={state.pending} onClick={() => controller.retry()}>Retry defaults</button>}
          <button type="button" className="kb-button" disabled={busy} onClick={() => controller.answerWorktree(false)}>Continue in base project</button>
          <button type="button" className="kb-button kb-primary" disabled={busy || state.pending || state.destinationMissing || state.draft === null} onClick={() => controller.answerWorktree(true)}>Create worktree</button>
        </div>
      </>}

      {state.phase === 'provisioning' && <>
        {identity}
        <p id={summary} role="status">{state.sessionId === null ? 'Preparing the task…' : 'Preparing the conversation…'}</p>
        <p className="kb-hint">This may take a moment. {state.kind === 'run' ? 'The instruction is sent once the task is ready.' : 'The card moves once the task is ready.'}</p>
      </>}

      {state.phase === 'error' && <>
        {identity}
        <p id={summary}>The first execution could not be prepared.</p>
        <ProblemNotice problem={state.error} title="The first execution could not be prepared" />
        <div className="kb-actions">
          <button type="button" className="kb-button" data-kb-initial-focus onClick={close}>Close</button>
          <button type="button" className="kb-button kb-primary" disabled={state.pending} onClick={() => controller.retry()}>Try again</button>
        </div>
      </>}

      {state.phase === 'model' && <>
        {identity}
        <p id={summary}>The first conversation is ready. Choose the model it should use for {state.kind === 'move' ? 'the move to ' + state.stageName : 'this instruction'}.</p>
        {seat !== undefined && state.sessionId !== null
          ? <NativeModelSeat seat={seat} sessionId={state.sessionId} onSelectingChange={setSelecting} />
          : <p className="kb-hint" role="status">The native model selector is unavailable. This conversation will use the default model.</p>}
        <div className="kb-actions">
          <button type="button" className="kb-button" data-kb-initial-focus disabled={busy} onClick={close}>Cancel</button>
          <button type="button" className="kb-button kb-primary" disabled={selecting} onClick={() => controller.confirmModel()}>{selecting ? 'Applying…' : 'Start execution'}</button>
        </div>
      </>}
    </div>
  </Modal>;
}
