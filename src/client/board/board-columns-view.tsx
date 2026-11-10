import React, { type ReactNode } from 'react';
import type { Column, Task, Workflow } from '../../shared/types.js';
import { CardMotionFrame } from '../card-motion/frame.js';
import { transitionAccess } from '../../domain/transitions.js';
import type { PlannedSlot } from '../board-columns.js';
import { EMPTY_STAGE_COPY } from '../board-copy.js';
import { StageHeader } from '../stage/stage-header.js';
import type { CardDragState } from '../useCardDrag.js';

export interface BoardColumnsViewProps {
  plan: readonly PlannedSlot[];
  layoutKeys: readonly string[];
  resetKey: string;
  workflow: Workflow;
  drag: CardDragState | null;
  renderCard: (task: Task, column: Column, workflow: Workflow) => ReactNode;
  /** The initial column's creation action, presented by the board's creation instance. */
  renderNewTaskButton: () => ReactNode;
  /** Opens the board's stage editor; absent leaves the columns without the action. */
  onEditStage?: (stageId: string) => void;
}

/** One column: its header, its creation action, its cards, and its drop affordance. */
function BoardColumn({ column, tasks, workflow, drag, renderCard, renderNewTaskButton, onEditStage }: {
  readonly column: Column;
  readonly tasks: readonly Task[];
  readonly workflow: Workflow;
  readonly drag: CardDragState | null;
  readonly renderCard: (task: Task, column: Column, workflow: Workflow) => ReactNode;
  readonly renderNewTaskButton: () => ReactNode;
  readonly onEditStage?: (stageId: string) => void;
}) {
  const restricted = Boolean(drag && drag.overColumnId === column.id && transitionAccess(workflow, drag.sourceColumnId, column.id) === 'restricted');
  return <section className={'kb-column' + (restricted ? ' kb-drop-restricted' : '')} aria-label={column.name + ' column'} data-column-id={column.id}>
    <StageHeader
      label={column.name}
      cardCount={tasks.length}
      {...(onEditStage === undefined ? {} : { onEditStage: () => onEditStage(column.id) })}
    />
    {/* The board's creation instance keeps its own button below the header, as before. */}
    {column.id === workflow.initialColumnId && renderNewTaskButton()}
    <div className="kb-card-list">
      {tasks.map(task => renderCard(task, column, workflow))}
      {drag?.overColumnId === column.id && <div className={'kb-drop-indicator' + (restricted ? ' kb-drop-indicator-restricted' : '')} style={{ top: drag.indicatorY }} aria-hidden="true" />}
      {tasks.length === 0 && <p className="kb-empty-column">{EMPTY_STAGE_COPY}</p>}
    </div>
  </section>;
}

/** The column board presentation: content-sized stages with their cards and drop affordances. */
export function BoardColumnsView({ plan, layoutKeys, resetKey, workflow, drag, renderCard, renderNewTaskButton, onEditStage }: BoardColumnsViewProps) {
  return <CardMotionFrame className="kb-columns" label="Workflow columns" layoutKeys={layoutKeys} resetKey={resetKey}>
    {plan.map(slot => <section key={slot.key} className={'kb-column-slot ' + (slot.group ? 'kb-column-group' : '')} aria-label={slot.group?.name}>
      {slot.group && <h2 className="kb-group-heading">{slot.group.name}</h2>}
      {slot.columns.map(({ column, tasks }) => <BoardColumn
        key={column.id}
        column={column}
        tasks={tasks}
        workflow={workflow}
        drag={drag}
        renderCard={renderCard}
        renderNewTaskButton={renderNewTaskButton}
        {...(onEditStage === undefined ? {} : { onEditStage })}
      />)}
    </section>)}
  </CardMotionFrame>;
}
