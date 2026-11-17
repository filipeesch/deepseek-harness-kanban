import { useId } from 'react';
import { Modal } from '../ui.js';
import type { ExecutionPreparationController, PreparationState } from './controller.js';

export interface ExecutionPreparationDialogProps {
  state: PreparationState;
  controller: ExecutionPreparationController;
}

function titleOf(state: PreparationState): string {
  return state.phase === 'blocked' ? 'Resolve the worktree binding first' : 'Create a worktree?';
}

/**
 * The one preparation dialog: the worktree question, or the explanation of a
 * binding that is not ready. It closes as soon as it is answered, so it never
 * holds the card while the worktree and the first conversation are prepared.
 */
export function ExecutionPreparationDialog({ state, controller }: ExecutionPreparationDialogProps) {
  const summary = useId();
  const close = () => controller.cancel();
  const identity = <p className="kb-preparation-identity"><strong>{state.taskTitle}</strong><span className="kb-hint">{state.stageName}</span></p>;

  return <Modal title={titleOf(state)} onClose={close} initialFocus="cancel" describedBy={summary}>
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
        <div className="kb-actions">
          <button type="button" className="kb-button" data-kb-initial-focus onClick={close}>Cancel</button>
          <button type="button" className="kb-button" onClick={() => controller.answerWorktree(false)}>Continue in base project</button>
          <button type="button" className="kb-button kb-primary" onClick={() => controller.answerWorktree(true)}>Create worktree</button>
        </div>
      </>}
    </div>
  </Modal>;
}
