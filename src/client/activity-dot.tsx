import React from 'react';
import type { Attention } from '../shared/types.js';
import { backgroundDetails } from './activity.js';

/** The activity facts the drawer's single dot stands for. */
export type ActivityFacts = Pick<Attention, 'running' | 'background'> & { script?: boolean };

/** The facts in a stable order: agent execution first, then background labels. */
export function activityFacts({ running, background, script }: ActivityFacts): string[] {
  const facts: string[] = [];
  if (running) facts.push('Agent running');
  if (script) facts.push('Deterministic script running');
  const details = backgroundDetails(background);
  if (details) facts.push('Background activity: ' + details);
  return facts;
}

/** A section tab's accessible name: the label alone when idle, with the activity facts otherwise. */
export function sectionTabName(label: string, activity: ActivityFacts): string {
  const facts = activityFacts(activity);
  return facts.length === 0 ? label : label + ', ' + facts.join('. ');
}

/**
 * The decorative dot on the Conversations tab. The owning tab carries the
 * accessible name, so the dot has no label of its own and no live region.
 */
export function ActivityDot({ running, background, script }: ActivityFacts) {
  if (!running && !script && background.length === 0) return null;
  return <span className="kb-activity-dot" aria-hidden="true" />;
}
