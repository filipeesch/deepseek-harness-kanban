import React, { type ReactNode } from 'react';
import type { Project } from '../../shared/types.js';
import { CheckSquareIcon, MarkAllReadIcon, SettingsIcon, TrashIcon } from '../icons.js';
import { BoardFilterControl } from './board-filter-control.js';

export interface BoardHeaderProps {
  /** The Hub tab row, composed by the board so this header stays presentational. */
  hubTabs: ReactNode;
  /** The board tab row of the active Hub. */
  boardTabs: ReactNode;
  /** The presentation switch, when the board offers one. */
  viewControl?: ReactNode;
  selectionMode: boolean;
  selectedCount: number;
  batchPending: boolean;
  search: string;
  projectFilter: string;
  projects: readonly Project[];
  canSelectCards: boolean;
  /** Changes with the Hub and board, so navigating closes the filter popover. */
  filterScope: string;
  /** True while the active board has an unread or failed settled turn to clear. */
  canMarkAllRead: boolean;
  /** Acknowledges every settled turn on the active board. */
  onMarkAllRead: () => void;
  onSearch: (value: string) => void;
  onProjectFilter: (value: string) => void;
  onEnterSelection: () => void;
  onOpenConfiguration: () => void;
  onRequestDelete: () => void;
  onExitSelection: () => void;
}

/** The Kanban frame's header: identity, the Hub row and toolbar on one line, then the board row. */
export function BoardHeader({
  hubTabs, boardTabs, viewControl, selectionMode, selectedCount, batchPending, search, projectFilter, projects, canSelectCards,
  filterScope, canMarkAllRead, onMarkAllRead, onSearch, onProjectFilter, onEnterSelection, onOpenConfiguration, onRequestDelete, onExitSelection,
}: BoardHeaderProps) {
  return <header className="kb-header">
    <h1>Kanban</h1>
    {hubTabs}
    <div className="kb-toolbar">
      {!selectionMode ? <>
        <BoardFilterControl
          key={filterScope}
          search={search}
          projectFilter={projectFilter}
          projects={projects}
          onSearch={onSearch}
          onProjectFilter={onProjectFilter}
        />
        {viewControl}
        <button type="button" className="kb-button kb-icon-button kb-control" disabled={!canMarkAllRead} aria-label="Mark all cards as read" title="Mark all cards as read" onClick={onMarkAllRead}><MarkAllReadIcon size={16} /></button>
        <button type="button" className="kb-button kb-icon-button kb-control" disabled={!canSelectCards} aria-label="Select cards to delete" title="Select cards to delete" onClick={onEnterSelection}><CheckSquareIcon size={16} /></button>
        <button type="button" className="kb-button kb-icon-button kb-control" aria-label="Configuration" title="Configuration" onClick={onOpenConfiguration}><SettingsIcon size={16} /></button>
      </> : <>
        <span className="kb-selection-count" role="status">{selectedCount} selected</span>
        <button type="button" className="kb-button kb-danger" disabled={selectedCount === 0 || batchPending} onClick={onRequestDelete}><TrashIcon size={14} /> Delete {selectedCount || ''}</button>
        <button type="button" className="kb-button" disabled={batchPending} onClick={onExitSelection}>Cancel</button>
      </>}
    </div>
    {boardTabs}
  </header>;
}
