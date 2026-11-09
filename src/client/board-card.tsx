import React, { memo } from 'react';
import type { Attention, Column, Task, Workflow } from '../shared/types.js';
import { TaskCard } from './task-card.js';
import { autoModeView } from './auto-mode.js';
import { nextStage } from '../domain/transitions.js';
import type { AutoRunController, AutoRunInput } from './auto-run.js';

export interface BoardCardProps {
  task: Task;
  column: Column;
  projectName: string;
  attention: Attention;
  workflow: Workflow;
  selectionMode: boolean;
  selected: boolean;
  autoRun: AutoRunController;
  autoModePending: boolean;
  onToggleAutoMode: (taskId: string, enabled: boolean) => void;
  onOpen: (taskId: string) => void;
  onToggleSelect: (taskId: string) => void;
  onBeginDrag: (event: React.PointerEvent<HTMLElement>, taskId: string, columnId: string) => void;
  shouldSuppressClick: () => boolean;
  onMoveTask?: (task: Task, column: Column) => Promise<unknown> | void;
  advancePending?: boolean;
  onRun?: (input: AutoRunInput) => void;
}

/**
 * One memoized board card. Every prop is either a stable reference or a scalar, so an
 * attention-only publication that leaves this task unchanged does not re-render it.
 * The auto-mode view and the next stage are derived here instead of being passed as
 * fresh objects.
 */
export const BoardCard = memo(function BoardCard({
  task, column, projectName, attention, workflow, selectionMode, selected, autoRun, autoModePending,
  onToggleAutoMode, onOpen, onToggleSelect, onBeginDrag, shouldSuppressClick, onMoveTask, advancePending = false, onRun,
}: BoardCardProps) {
  return <TaskCard
    task={task}
    column={column}
    projectName={projectName}
    attention={attention}
    autoMode={autoModeView(task, workflow, attention.pending)}
    selectionMode={selectionMode}
    selected={selected}
    autoRun={autoRun}
    autoModePending={autoModePending}
    onToggleAutoMode={onToggleAutoMode}
    onOpen={onOpen}
    onToggleSelect={onToggleSelect}
    onBeginDrag={onBeginDrag}
    shouldSuppressClick={shouldSuppressClick}
    next={nextStage(workflow, task.columnId)}
    {...(onMoveTask === undefined ? {} : { onMove: (column: Column) => onMoveTask(task, column) })}
    advancePending={advancePending}
    {...(onRun === undefined ? {} : { onRun })}
  />;
});
