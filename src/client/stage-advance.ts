import type { TransitionDestination } from '../domain/transitions.js';

/** The next-stage action's accessible name, shared by the drawer and the card. */
export function advanceStageLabel(next: TransitionDestination): string {
  return 'Move to ' + next.column.name + (next.access === 'restricted' ? ', requires confirmation' : '');
}
