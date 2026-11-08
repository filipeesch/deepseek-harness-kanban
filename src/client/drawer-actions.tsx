import React, { type Ref } from 'react';
import type { AutoModeView } from './auto-mode.js';
import { AutoModeControl } from './auto-mode.js';
import { CloseIcon, TrashIcon } from './icons.js';

export interface DrawerActionsProps {
  autoMode?: AutoModeView;
  autoModePending?: boolean;
  onToggleAutoMode?: (enabled: boolean) => void;
  blocked: boolean;
  onDelete: () => void;
  onClose: () => void;
  closeRef?: Ref<HTMLButtonElement>;
}

/** The header's automatic-mode, delete, and close controls. */
export function DrawerActions({ autoMode, autoModePending = false, onToggleAutoMode, blocked, onDelete, onClose, closeRef }: DrawerActionsProps) {
  return <div className="kb-drawer-header-actions">
    {autoMode !== undefined && onToggleAutoMode !== undefined && <AutoModeControl view={autoMode} variant="header" pending={autoModePending} onToggle={onToggleAutoMode} />}
    <button type="button" className="kb-button kb-icon-button kb-danger" aria-label="Delete task" title="Delete task" disabled={blocked} onClick={onDelete}><TrashIcon size={16} /></button>
    <button ref={closeRef} type="button" className="kb-button kb-icon-button" aria-label="Close task details" title="Close task details" onClick={onClose}><CloseIcon size={16} /></button>
  </div>;
}
