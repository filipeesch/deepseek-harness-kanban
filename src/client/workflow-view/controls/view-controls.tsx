import React from 'react';
import { FitViewIcon, LockIcon, OrganizeIcon, RedoIcon, UndoIcon, UnlockIcon, ZoomInIcon, ZoomOutIcon } from '../../icons.js';
import { TooltipButton } from './tooltip.js';

export interface ViewControlsProps {
  readonly locked: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onFit: () => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onOrganize: () => void;
  readonly onToggleLock: () => void;
}

/**
 * The diagram's one control stack: navigation, layout history, and the layout
 * lock, in that order. Presentational only; the view owns every callback.
 */
export function ViewControls({ locked, canUndo, canRedo, onZoomIn, onZoomOut, onFit, onUndo, onRedo, onOrganize, onToggleLock }: ViewControlsProps) {
  return <div className="kb-flow-controls" role="group" aria-label="Diagram controls">
    <TooltipButton label="Zoom in" onClick={onZoomIn}><ZoomInIcon size={16} /></TooltipButton>
    <TooltipButton label="Zoom out" onClick={onZoomOut}><ZoomOutIcon size={16} /></TooltipButton>
    <TooltipButton label="Fit to view" onClick={onFit}><FitViewIcon size={16} /></TooltipButton>
    <span className="kb-flow-control-divider" aria-hidden="true" />
    <TooltipButton label="Undo layout change" disabled={!canUndo || locked} onClick={onUndo}><UndoIcon size={16} /></TooltipButton>
    <TooltipButton label="Redo layout change" disabled={!canRedo || locked} onClick={onRedo}><RedoIcon size={16} /></TooltipButton>
    <TooltipButton label="Organize stages" disabled={locked} onClick={onOrganize}><OrganizeIcon size={16} /></TooltipButton>
    <span className="kb-flow-control-divider" aria-hidden="true" />
    <TooltipButton label={locked ? 'Unlock layout editing' : 'Lock layout editing'} pressed={locked} onClick={onToggleLock}>{locked ? <LockIcon size={16} /> : <UnlockIcon size={16} />}</TooltipButton>
  </div>;
}
