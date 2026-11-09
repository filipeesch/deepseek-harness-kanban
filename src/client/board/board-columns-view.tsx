import React, { type ReactNode } from 'react';
import type { Column, Task, Workflow } from '../../shared/types.js';
import { CardMotionFrame } from '../card-motion/frame.js';
import { transitionAccess } from '../../domain/transitions.js';
import type { PlannedSlot } from '../board-columns.js';
import { EMPTY_STAGE_COPY } from '../board-copy.js';
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
}

/** The column board presentation: content-sized stages with their cards and drop affordances. */
export function BoardColumnsView({ plan, layoutKeys, resetKey, workflow, drag, renderCard, renderNewTaskButton }: BoardColumnsViewProps) {
  return <CardMotionFrame className="kb-columns" label="Workflow columns" layoutKeys={layoutKeys} resetKey={resetKey}>{plan.map(slot => <section key={slot.key} className={'kb-column-slot ' + (slot.group ? 'kb-column-group' : '')} aria-label={slot.group?.name}>{slot.group && <h2 className="kb-group-heading">{slot.group.name}</h2>}{slot.columns.map(({ column, tasks }) => {
    const restricted = Boolean(drag && drag.overColumnId === column.id && transitionAccess(workflow, drag.sourceColumnId, column.id) === 'restricted');
    return <section className={'kb-column' + (restricted ? ' kb-drop-restricted' : '')} key={column.id} aria-label={column.name + ' column'} data-column-id={column.id}><header className="kb-column-header"><h2>{column.name}</h2><span aria-label={tasks.length + ' tasks'}>{tasks.length}</span></header>{column.id === workflow.initialColumnId && renderNewTaskButton()}<div className="kb-card-list">{tasks.map(task => renderCard(task, column, workflow))}{drag?.overColumnId === column.id && <div className={'kb-drop-indicator' + (restricted ? ' kb-drop-indicator-restricted' : '')} style={{ top: drag.indicatorY }} aria-hidden="true" />}{tasks.length === 0 && <p className="kb-empty-column">{EMPTY_STAGE_COPY}</p>}</div></section>;
  })}</section>)}</CardMotionFrame>;
}
