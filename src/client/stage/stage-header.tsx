import React from 'react';
import { PencilIcon, PlusIcon } from '../icons.js';
import { NEW_TASK_LABEL } from '../board-copy.js';

export interface StageHeaderProps {
  readonly label: string;
  readonly cardCount: number;
  /** Presentation-owned modifiers, such as the diagram's drag and lock classes. */
  readonly className?: string;
  /** The diagram's layout lock; it gates the diagram's edit action and never the board's. */
  readonly locked?: boolean;
  /** True for the stage the board creates tasks in; the creation action appears only there. */
  readonly creatable?: boolean;
  readonly onCreateTask?: () => void;
  /** Opens the stage editor. The board owns that dialog; this header only asks for it. */
  readonly onEditStage?: () => void;
  /**
   * True while the diagram's layout lock is on. Editing a stage authors the same policy
   * the diagram's structural edits do, so the diagram keeps it behind the lock; the board
   * has no lock and always presents the action.
   */
  readonly editDisabled?: boolean;
  /** The diagram's stage-drag start; a harness without dragging leaves it out. */
  readonly onPointerDown?: (event: React.PointerEvent<HTMLElement>) => void;
}

/**
 * A stage's title, its creation action, its card count, and its edit action.
 *
 * Shared by both presentations so the two headers cannot drift apart. The edit
 * action never starts a stage move, so it stops the pointer event the way creation
 * does. The diagram disables it while its layout lock is on, because an edit changes
 * the same transition policy the diagram's structural gestures do.
 */
export function StageHeader({ label, cardCount, className, locked, creatable, onCreateTask, onEditStage, editDisabled, onPointerDown }: StageHeaderProps) {
  const classes = 'kb-column-header' + (className === undefined ? '' : ' ' + className);
  const editLabel = 'Edit stage ' + label;
  // The reason a disabled action cannot act belongs in its tooltip, not in the name it
  // shares with every other stage action.
  const editTitle = editDisabled === true ? 'Unlock layout editing to edit ' + label : editLabel;
  return <header className={classes} data-locked={locked === true ? 'true' : undefined} onPointerDown={onPointerDown}>
    <h2>{label}</h2>
    {/* One group, so presenting an action never shifts the title or the card count. */}
    <div className="kb-flow-stage-actions">
      {creatable && <button
        type="button"
        className="kb-button kb-icon-button kb-flow-stage-create nodrag nopan"
        disabled={onCreateTask === undefined}
        aria-label={NEW_TASK_LABEL}
        title={NEW_TASK_LABEL}
        onPointerDown={event => { event.stopPropagation(); }}
        onClick={event => { event.stopPropagation(); onCreateTask?.(); }}
      ><PlusIcon size={14} /></button>}
      <span aria-label={cardCount + ' cards'}>{cardCount}</span>
      {onEditStage !== undefined && <button
        type="button"
        className="kb-button kb-icon-button kb-flow-stage-edit nodrag nopan"
        aria-label={editLabel}
        title={editTitle}
        disabled={editDisabled === true}
        onPointerDown={event => { event.stopPropagation(); }}
        onClick={event => { event.stopPropagation(); if (editDisabled !== true) onEditStage(); }}
      ><PencilIcon size={14} /></button>}
    </div>
  </header>;
}
