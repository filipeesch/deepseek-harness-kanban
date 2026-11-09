import type { Task, Workflow } from '../shared/types.js';
import { defaultDestination, transitionTargets } from '../domain/transitions.js';
import { recordedTransition, staleTransitionMessage } from '../domain/transition-route.js';

/** The product tool the model calls to record the transition it followed. */
const RECORD_TOOL = 'set_next_transition';

/** The task fields the briefing reads. */
export type BriefedTask = Pick<Task, 'columnId' | 'recordedTransition'>;

/**
 * The host-generated briefing appended to a stage instruction. It exists only
 * when the stage configures two or more targets, because that is the only case
 * with a choice to describe; with fewer targets the message keeps the authored
 * instruction alone.
 */
export function buildTransitionBriefing(workflow: Workflow, task: BriefedTask): string | undefined {
  const source = workflow.columns.find(column => column.id === task.columnId);
  if (source === undefined) return undefined;
  const targets = transitionTargets(workflow, task.columnId);
  if (targets.length < 2) return undefined;
  const lines = ['Workflow transitions from ' + source.name + ':'];
  for (const target of targets) {
    lines.push('- ' + target.column.name + (target.rule.when === undefined ? '' : ' — ' + target.rule.when));
  }
  lines.push('');
  const recorded = recordedTransition(workflow, task);
  if (recorded.kind === 'resolved') lines.push('Recorded transition: ' + recorded.column.name + '.');
  else if (recorded.kind === 'stale') lines.push('The recorded transition no longer applies: ' + staleTransitionMessage(workflow, task, recorded.reason) + ' Record another one, or the advance pauses.');
  else lines.push('No transition recorded.');
  const fallback = defaultDestination(workflow, task.columnId);
  lines.push('Record the transition this turn ends in with ' + RECORD_TOOL
    + (fallback === undefined ? '; with none recorded the task does not advance.' : '; with none recorded the advance uses ' + fallback.name + '.'));
  return lines.join('\n');
}
