import React from 'react';
import type { Column } from '../shared/types.js';
import type { TransitionDestination } from '../domain/transitions.js';
import { AdvanceStageIcon } from './icons.js';

export interface DrawerStageControlProps {
  id: string;
  destinations: readonly TransitionDestination[];
  currentColumnId: string;
  next?: TransitionDestination;
  /** Why a recorded transition no longer resolves; present instead of `next`. */
  staleNext?: string;
  movingTo: string | null;
  blocked: boolean;
  onMove: (column: Column) => void;
  onRefuse?: () => void;
}

function advanceLabel(next: TransitionDestination): string {
  return 'Move to ' + next.column.name + (next.access === 'restricted' ? ', requires confirmation' : '');
}

function refuseLabel(message: string): string {
  return 'Recorded transition unavailable: ' + message;
}

/** The workflow stage select and the one-click next-stage action. */
export function DrawerStageControl({ id, destinations, currentColumnId, next, staleNext, movingTo, blocked, onMove, onRefuse }: DrawerStageControlProps) {
  const disabled = blocked || movingTo !== null;
  const hintId = id + '-stage-hint';
  return <div className="kb-drawer-stage">
    <label className="kb-stage-control">
      <span className="kb-sr">Move task to</span>
      <select className="kb-input kb-stage-select" aria-label="Move task to" aria-describedby={hintId} value={movingTo ?? currentColumnId} disabled={disabled}
        onChange={event => {
          const destination = destinations.find(value => value.column.id === event.target.value);
          if (destination && destination.column.id !== currentColumnId) onMove(destination.column);
        }}>
        {destinations.map(({ column, access }) => <option key={column.id} value={column.id} className={access === 'restricted' ? 'kb-stage-option-restricted' : undefined} aria-label={access === 'restricted' ? column.name + ', requires confirmation' : undefined}>{column.name}</option>)}
      </select>
    </label>
    {next !== undefined && <button type="button" className="kb-button kb-icon-button kb-stage-advance" aria-label={advanceLabel(next)} title={advanceLabel(next)} disabled={disabled} onClick={() => onMove(next.column)}><AdvanceStageIcon size={15} /></button>}
    {staleNext !== undefined && <button type="button" className="kb-button kb-icon-button kb-stage-advance" aria-label={refuseLabel(staleNext)} title={refuseLabel(staleNext)} disabled={disabled} onClick={() => onRefuse?.()}><AdvanceStageIcon size={15} /></button>}
    <span className="kb-sr" id={hintId}>Stages that this workflow does not permit require confirmation before moving.</span>
  </div>;
}
