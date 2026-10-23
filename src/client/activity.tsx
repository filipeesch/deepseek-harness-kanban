import React from 'react';
import type { Attention, BackgroundActivity, BackgroundKind } from '../shared/types.js';

const UNITS: Record<BackgroundKind, readonly [string, string]> = {
  job: ['job', 'jobs'],
  subagent: ['subagent', 'subagents'],
  schedule: ['schedule', 'schedules'],
};
const KIND_ORDER: readonly BackgroundKind[] = ['job', 'subagent', 'schedule'];

/** Count copy derived from the activity families, e.g. "1 job · 2 subagents". */
export function backgroundSummary(items: readonly BackgroundActivity[]): string {
  return KIND_ORDER.flatMap(kind => {
    const count = items.filter(item => item.kind === kind).length;
    if (count === 0) return [];
    const [singular, plural] = UNITS[kind];
    return [count + ' ' + (count === 1 ? singular : plural)];
  }).join(' · ');
}

/** The labels of the unsettled activities, e.g. "Run tests · Research". */
export function backgroundDetails(items: readonly BackgroundActivity[]): string {
  return items.map(item => item.label).join(' · ');
}

/** Card chip copy; a background-only card names the state it is describing. */
export function backgroundChipText(items: readonly BackgroundActivity[], standalone: boolean): string {
  return (standalone ? 'Background: ' : '') + backgroundSummary(items);
}

/** The count and the labels are both part of the indicator's accessible name. */
export function backgroundAccessibleName(items: readonly BackgroundActivity[]): string {
  const details = backgroundDetails(items);
  return 'Background activity: ' + backgroundSummary(items) + (details ? '. ' + details : '');
}

function WorkingBadge({ decorative = false }: { decorative?: boolean }) {
  return <span className="kb-working" aria-hidden={decorative ? true : undefined}><span className="kb-working-dot" aria-hidden="true" />Working</span>;
}

/** Persistent live region: mounted empty while idle, its text changes once when a turn starts. */
function WorkingAnnouncement({ running, label }: { running: boolean; label?: string }) {
  return <span className="kb-sr" role="status" aria-live="polite" aria-atomic="true">{running ? 'Working' + (label ? ' on ' + label : '') : ''}</span>;
}

export interface TaskActivityProps { attention: Attention; variant: 'card' | 'drawer'; label?: string }

/** The task's turn execution and background activity, shared by the card and the drawer header. */
export function TaskActivity({ attention, variant, label }: TaskActivityProps) {
  const { running, background } = attention;
  const details = backgroundDetails(background);
  if (variant === 'drawer') {
    if (!running && background.length === 0) return null;
    return <div className="kb-execution kb-execution-drawer">
      {running && <WorkingBadge />}
      {background.length > 0 && <span className="kb-task-background" title={details}>Background: {details}</span>}
    </div>;
  }
  return <>
    <WorkingAnnouncement running={running} label={label} />
    {running && <WorkingBadge decorative />}
    {background.length > 0 && (
      <span
        className="kb-background"
        role="note"
        tabIndex={0}
        title={details}
        aria-label={backgroundAccessibleName(background)}
        onClick={event => event.stopPropagation()}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }}
      >
        {backgroundChipText(background, false)}
      </span>
    )}
  </>;
}
