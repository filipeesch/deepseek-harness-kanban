import { useCallback, useState } from 'react';
import type { Attention, Column, Task } from '../../shared/types.js';
import type { RunCommand } from '../ui.js';
import { useWorkflowSave } from '../workflow-save.js';
import { draftChanged, draftProblems, duplicateNameWarning, stageDraft, stagePatch, stageRenameBlock, transitionChoices, type StageEditorDraft, type StageEditorProblem, type StageTransitionDraft } from './stage-editor-draft.js';

export interface StageEditorInput {
  readonly hubId: string;
  readonly boardId: string;
  readonly revision: number;
  readonly column: Column;
  readonly columns: readonly Column[];
  readonly tasks: readonly Task[];
  readonly attention: Readonly<Record<string, Attention>>;
  readonly run: RunCommand;
  readonly onSaved: () => void;
}

/** The stage editor's state: one draft, its problems, and the one save it may send. */
export function useStageEditor({ hubId, boardId, revision, column, columns, tasks, attention, run, onSaved }: StageEditorInput) {
  const [draft, setDraft] = useState<StageEditorDraft>(() => stageDraft(column));
  /** True once the user tried to save, so an invalid draft explains itself. */
  const [attempted, setAttempted] = useState(false);
  const action = useWorkflowSave(run);
  const otherIds = new Set(transitionChoices(columns, column.id).map(choice => choice.id));
  const problems: StageEditorProblem[] = draftProblems(draft, otherIds);
  const changed = draftChanged(draft, column);
  const warning = duplicateNameWarning(draft, columns, column.id);
  const renameBlock = stageRenameBlock(tasks, attention);

  const change = useCallback(<K extends keyof StageEditorDraft>(key: K, value: StageEditorDraft[K]) => {
    setDraft(current => ({ ...current, [key]: value }));
  }, []);

  const chooseDestination = useCallback((to: string, chosen: boolean) => {
    setDraft(current => ({
      ...current,
      transitions: chosen
        ? [...current.transitions, { to, when: '' }]
        : current.transitions.filter(transition => transition.to !== to),
    }));
  }, []);

  const changeCondition = useCallback((to: string, when: string) => {
    setDraft(current => ({ ...current, transitions: current.transitions.map(transition => transition.to === to ? { ...transition, when } : transition) }));
  }, []);

  const save = useCallback(async () => {
    setAttempted(true);
    if (action.pending || problems.length > 0 || !changed) return;
    const result = await action.save({ type: 'board.stage.update', hubId, boardId, stageId: column.id, patch: stagePatch(draft, column), expectedRevision: revision });
    if (result !== null) onSaved();
  }, [action, changed, column, draft, hubId, boardId, onSaved, problems.length, revision]);

  const transitions: readonly StageTransitionDraft[] = draft.transitions;
  return { draft, change, chooseDestination, changeCondition, transitions, problems, attempted, changed, warning, renameBlock, pending: action.pending, error: action.error, save };
}
