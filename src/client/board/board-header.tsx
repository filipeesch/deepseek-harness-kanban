import React, { type ReactNode } from 'react';
import type { Project } from '../../shared/types.js';
import { CheckSquareIcon, SettingsIcon, TrashIcon } from '../icons.js';

export interface BoardHeaderProps {
  /** The Hub and board navigation, composed by the board so this header stays presentational. */
  hubNav: ReactNode;
  /** The presentation switch, when the board offers one. */
  viewControl?: ReactNode;
  selectionMode: boolean;
  selectedCount: number;
  batchPending: boolean;
  search: string;
  projectFilter: string;
  projects: readonly Project[];
  canSelectCards: boolean;
  onSearch: (value: string) => void;
  onProjectFilter: (value: string) => void;
  onEnterSelection: () => void;
  onOpenConfiguration: () => void;
  onRequestDelete: () => void;
  onExitSelection: () => void;
}

/** The Kanban frame's header: identity, search, filters, selection, and the Hub navigation. */
export function BoardHeader({
  hubNav, viewControl, selectionMode, selectedCount, batchPending, search, projectFilter, projects, canSelectCards,
  onSearch, onProjectFilter, onEnterSelection, onOpenConfiguration, onRequestDelete, onExitSelection,
}: BoardHeaderProps) {
  return <header className="kb-header">
    <div className="kb-heading"><div><h1>Kanban</h1><p className="kb-hint">Hubs, boards, and workflows</p></div><div className="kb-toolbar">
    {!selectionMode ? <>
      <label className="kb-field kb-search"><span className="kb-sr">Search tasks</span><input className="kb-input" type="search" aria-label="Search tasks" placeholder="Search title or description" value={search} onChange={event => onSearch(event.target.value)} /></label>
      <label className="kb-field"><span className="kb-sr">Project filter</span><select className="kb-input" aria-label="Project filter" value={projectFilter} onChange={event => onProjectFilter(event.target.value)}><option value="">All projects</option>{projects.map(project => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
      {viewControl}
      <button type="button" className="kb-button kb-icon-button" disabled={!canSelectCards} aria-label="Select cards to delete" title="Select cards to delete" onClick={onEnterSelection}><CheckSquareIcon size={16} /></button>
      <button type="button" className="kb-button kb-icon-button" aria-label="Configuration" title="Configuration" onClick={onOpenConfiguration}><SettingsIcon size={16} /></button>
    </> : <>
      <span className="kb-selection-count" role="status">{selectedCount} selected</span>
      <button type="button" className="kb-button kb-danger" disabled={selectedCount === 0 || batchPending} onClick={onRequestDelete}><TrashIcon size={14} /> Delete {selectedCount || ''}</button>
      <button type="button" className="kb-button" disabled={batchPending} onClick={onExitSelection}>Cancel</button>
    </>}
  </div></div>
    {hubNav}
  </header>;
}
