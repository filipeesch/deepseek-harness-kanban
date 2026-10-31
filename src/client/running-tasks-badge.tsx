import React from 'react';
import type { ScopeActivity } from './scope-activity.js';

/**
 * The scope's running-task count: a pulsing ring in the host accent with its numeral.
 * The whole mark is one labeled image so the surrounding tab keeps a single accessible name,
 * and its title exposes the running task titles on hover.
 */
export function RunningTasksBadge({ activity }: { activity: ScopeActivity }) {
  if (activity.runningTasks === 0) return null;
  const summary = activity.runningTasks === 1 ? '1 task running' : activity.runningTasks + ' tasks running';
  const details = activity.runningTaskTitles.join(', ');
  return <span className="kb-tab-running" role="img" aria-label={summary} title={details ? summary + ': ' + details : summary}>
    <span className="kb-tab-running-ring" aria-hidden="true" />
    <span className="kb-tab-running-count">{activity.runningTasks}</span>
  </span>;
}
