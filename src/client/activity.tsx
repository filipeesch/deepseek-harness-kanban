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

/** One background chip line: the family label alone, or the total once families mix. */
export function backgroundIndicatorText(items: readonly BackgroundActivity[]): string {
  if (new Set(items.map(item => item.kind)).size <= 1) return backgroundSummary(items);
  return items.length + ' activities';
}

/** The count and the labels are both part of the indicator's accessible name. */
export function backgroundAccessibleName(items: readonly BackgroundActivity[]): string {
  const details = backgroundDetails(items);
  return 'Background activity: ' + backgroundIndicatorText(items) + (details ? '. ' + details : '');
}

export function WorkingBadge({ decorative = false }: { decorative?: boolean }) {
  return <span className="kb-working" aria-hidden={decorative ? true : undefined}><span className="kb-working-dot" aria-hidden="true" />Working</span>;
}

/** Persistent live region: mounted empty while idle, its text changes once when a turn starts. */
export function WorkingAnnouncement({ running, label }: { running: boolean; label?: string }) {
  return <span className="kb-sr" role="status" aria-live="polite" aria-atomic="true">{running ? 'Working' + (label ? ' on ' + label : '') : ''}</span>;
}

/** The drawer header's turn execution and background labels, with no live region of its own. */
export function TaskActivity({ attention }: { attention: Attention }) {
  const { running, background } = attention;
  const details = backgroundDetails(background);
  if (!running && background.length === 0) return null;
  return <div className="kb-execution kb-execution-drawer">
    {running && <WorkingBadge />}
    {background.length > 0 && <span className="kb-task-background" title={details}>Background: {details}</span>}
  </div>;
}
