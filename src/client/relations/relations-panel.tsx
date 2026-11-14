import React from 'react';
import type { BoardRelation } from '../../shared/types.js';
import { buildRelationRows } from './relations-view.js';

export interface RelationsPanelProps {
  /** The task whose relations the section presents. */
  taskId: string;
  /** The board the task belongs to, so a same-board relation does not repeat the board name. */
  taskBoardId: string;
  /** Every relation the board view resolved, including the ones of other cards. */
  relations: readonly BoardRelation[];
}

/**
 * The Relations section: the cards this task is linked to, read-only. Creating or
 * removing a relation is a tool action, so the section offers no control.
 */
export function RelationsPanel({ taskId, taskBoardId, relations }: RelationsPanelProps) {
  const rows = buildRelationRows({ taskId, taskBoardId, relations });
  if (rows.length === 0) return <p className="kb-hint" role="status">No relations for this task yet.</p>;
  return <ul className="kb-relations" aria-label="Task relations">
    {rows.map(row => <li key={row.key} className="kb-relations-row">
      <span className="kb-relations-label">{row.label}</span>
      <span className="kb-relations-meta">
        {row.stage === undefined ? null : <span className="kb-relations-stage">{row.stage}</span>}
        {row.board === undefined ? null : <span className="kb-relations-board">{row.board}</span>}
      </span>
    </li>)}
  </ul>;
}
