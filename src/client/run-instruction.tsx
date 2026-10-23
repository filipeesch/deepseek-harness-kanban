import React, { useEffect } from 'react';
import type { Column, Command, Task } from '../shared/types.js';
import { PlayIcon } from './icons.js';
import { useAction, type RunCommand } from './ui.js';

/** The card action sends exactly the current stage instruction; the host revalidates it. */
export function runInstructionCommand(task: Task, column: Column): Extract<Command, { type: 'task.runInstruction' }> {
  return { type: 'task.runInstruction', taskId: task.id, columnId: column.id, expectedInstruction: column.onEnterPrompt ?? '' };
}

export function RunInstructionButton({ task, column, run }: { task: Task; column: Column; run: RunCommand }) {
  const action = useAction(run);
  useEffect(() => { action.clearError(); }, [task.id, column.id, column.onEnterPrompt]);
  if (!column.onEnterPrompt?.trim()) return null;
  if (task.instructionPending?.columnId !== column.id) return null;
  const label = 'Run ' + column.name + ' instruction';
  const blocked = Boolean(task.operation || task.pendingTransition);
  return <div className="kb-card-run">
    <button
      type="button"
      className="kb-button kb-icon-button kb-card-action"
      aria-label={label}
      title={label + ' in the first open conversation'}
      disabled={action.pending || blocked}
      onClick={event => { event.stopPropagation(); void action.execute(runInstructionCommand(task, column)); }}
      onPointerDown={event => event.stopPropagation()}
      onKeyDown={event => event.stopPropagation()}
    ><PlayIcon size={15} /></button>
    {action.error && <p className="kb-card-error" role="alert">{action.error.message}</p>}
  </div>;
}
