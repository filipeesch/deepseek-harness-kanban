import React, { memo } from 'react';
import type { Attention, Column, Task, Workflow } from '../shared/types.js';
import { TaskCard } from './task-card.js';
import { autoModeView } from './auto-mode.js';
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
  onRun?: (input: AutoRunInput) => void;
}

/**
 * One memoized board card. Every prop is either a stable reference or a scalar, so an
 * attention-only publication that leaves this task unchanged does not re-render it.
 * The auto-mode view is derived here instead of being passed as a fresh object.
 */
export const BoardCard = memo(function BoardCard({
  task, column, projectName, attention, workflow, selectionMode, selected, autoRun, autoModePending,
  onToggleAutoMode, onOpen, onToggleSelect, onBeginDrag, shouldSuppressClick, onRun,
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
    {...(onRun === undefined ? {} : { onRun })}
  />;
});
