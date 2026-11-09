import React, { useRef } from 'react';
import type { Project } from '../../shared/types.js';
import { CloseIcon, FilterClearIcon, FilterIcon } from '../icons.js';
import { Popover, type PopoverHandle } from '../popover.js';

export interface BoardFilterControlProps {
  search: string;
  projectFilter: string;
  projects: readonly Project[];
  onSearch: (value: string) => void;
  onProjectFilter: (value: string) => void;
}

/** Which filters are on, in the order the accessible name lists them. */
function activeFilters(search: string, projectFilter: string): string[] {
  const active: string[] = [];
  if (search.trim() !== '') active.push('search text');
  if (projectFilter !== '') active.push('project');
  return active;
}

/**
 * The single entry point for task filtering: a funnel trigger opening a popover that
 * holds both inputs. Filtering is live and the popover stays open while it is used, so
 * a person can narrow the board and watch it respond.
 */
export function BoardFilterControl({ search, projectFilter, projects, onSearch, onProjectFilter }: BoardFilterControlProps) {
  const popover = useRef<PopoverHandle>(null);
  const active = activeFilters(search, projectFilter);
  const selected = projects.find(project => project.id === projectFilter);
  const name = active.length === 0 ? 'Filter tasks' : 'Filter tasks, filtering by ' + active.join(' and ');

  function clear() {
    onSearch('');
    onProjectFilter('');
    popover.current?.close(true);
  }

  return <Popover
    ref={popover}
    label="Filter tasks"
    triggerClassName="kb-button kb-icon-button kb-control kb-filter-trigger"
    triggerLabel={name}
    popoverClassName="kb-filter-popover"
    initialFocusSelector=".kb-filter-popover input[type=search]"
    trigger={<>{active.length >= 2
      ? <span className="kb-filter-badge" aria-hidden="true">{active.length}</span>
      : active.length === 1 ? <span className="kb-filter-dot" aria-hidden="true" /> : null}
      <FilterIcon size={16} /></>}
  >
    <label className="kb-field"><span className="kb-sr">Search tasks</span>
      <input className="kb-input" type="search" aria-label="Search tasks" placeholder="Search title or description" value={search} onChange={event => onSearch(event.target.value)} />
    </label>
    <label className="kb-field"><span className="kb-sr">Project filter</span>
      <select
        className="kb-input"
        aria-label="Project filter"
        value={projectFilter}
        title={selected?.name ?? 'All projects'}
        onChange={event => onProjectFilter(event.target.value)}
      ><option value="">All projects</option>{projects.map(project => <option value={project.id} key={project.id}>{project.name}</option>)}</select>
    </label>
    <div className="kb-filter-footer">
      <button type="button" className="kb-button kb-icon-button kb-control" aria-label="Clear filters" title="Clear filters" onClick={clear}><FilterClearIcon size={14} /></button>
      <button type="button" className="kb-button kb-icon-button kb-control" aria-label="Close filters" title="Close filters" onClick={() => popover.current?.close(true)}><CloseIcon size={14} /></button>
    </div>
  </Popover>;
}
