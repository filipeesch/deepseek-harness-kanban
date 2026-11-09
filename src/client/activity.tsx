import React from 'react';
import type { BackgroundActivity } from '../shared/types.js';

/** The labels of the unsettled activities, e.g. "Run tests · Research". */
export function backgroundDetails(items: readonly BackgroundActivity[]): string {
  return items.map(item => item.label).join(' · ');
}

/** Persistent live region: mounted empty while idle, its text changes once when a turn starts. */
export function WorkingAnnouncement({ running, label }: { running: boolean; label?: string }) {
  return <span className="kb-sr" role="status" aria-live="polite" aria-atomic="true">{running ? 'Working' + (label ? ' on ' + label : '') : ''}</span>;
}
