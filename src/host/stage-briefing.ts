import type { Task, Workflow } from '../shared/types.js';
import { defaultDestination, transitionTargets } from '../domain/transitions.js';
import { recordedTransition, staleTransitionMessage } from '../domain/transition-route.js';
import { AGENT_TRANSITION_REASON_LIMIT } from '../domain/transition-reason.js';

/** The product tool the model calls to declare the transition it followed. */
const RECORD_TOOL = 'set_next_transition';
const TARGET_PARAM = 'column_id';
const REASON_PARAM = 'reason';

/** The task fields the briefing reads. */
export type BriefedTask = Pick<Task, 'columnId' | 'recordedTransition'>;

/**
 * The host-generated briefing appended to a stage instruction. It exists only
 * when the stage configures two or more targets, because that is the only case
 * with a choice to describe; with fewer targets the message keeps the authored
 * instruction alone. The targets and their conditions are the orientation block's
 * to state, so the briefing keeps only what is about the choice: the recorded
 * transition, the target that applies without one, and how a declaration works.
 */
export function buildTransitionBriefing(workflow: Workflow, task: BriefedTask): string | undefined {
  const source = workflow.columns.find(column => column.id === task.columnId);
  if (source === undefined) return undefined;
  const targets = transitionTargets(workflow, task.columnId);
  if (targets.length < 2) return undefined;
  const lines = ['Workflow transitions from ' + source.name + ' (its exits are listed in the stage orientation):', ''];
  const recorded = recordedTransition(workflow, task);
  if (recorded.kind === 'resolved') lines.push('Recorded transition: ' + recorded.column.name + '.');
  else if (recorded.kind === 'stale') lines.push('The recorded transition no longer applies: ' + staleTransitionMessage(workflow, task, recorded.reason) + ' An advance using it pauses.');
  else lines.push('No transition recorded.');
  const fallback = defaultDestination(workflow, task.columnId);
  lines.push('A transition can be declared with ' + RECORD_TOOL + ', passing ' + TARGET_PARAM + ' and ' + REASON_PARAM + ' (the reason is at most ' + AGENT_TRANSITION_REASON_LIMIT + ' characters). '
    + 'A declared transition requires a reason and can advance the task after a completed turn. '
    + (fallback === undefined ? 'Without a declaration there is no configured default.' : 'Without a declaration, an independently enabled automatic advance uses ' + fallback.name + '.'));
  return lines.join('\n');
}
