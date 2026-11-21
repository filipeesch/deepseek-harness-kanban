import type { Column } from '../shared/types.js';

/** What a stage is: a decision gate, a scripted program, an agent instruction, or neither. */
export type StageKind = 'decision' | 'scripted' | 'agent-instruction' | 'no-instruction';

/** How a stage routes a task: owned by a gate or a script, or by its authored transition list. */
export type RoutingPolicy = 'decision' | 'scripted' | 'unrestricted' | 'empty' | 'configured';

/** Who owns the routing out of a stage: its gate, its script, or the stage itself. */
export type RoutingOwner = 'decision' | 'scripted' | 'stage';

type Classified = Pick<Column, 'decision' | 'scripted' | 'onEnterPrompt' | 'allowedTransitions'>;

/**
 * The one classification every surface reports. A blank entry instruction is no
 * instruction, so a stage whose only text is whitespace is not agentic.
 */
export function stageKind(column: Pick<Classified, 'decision' | 'scripted' | 'onEnterPrompt'>): StageKind {
  if (column.decision !== undefined) return 'decision';
  if (column.scripted !== undefined) return 'scripted';
  return column.onEnterPrompt?.trim() ? 'agent-instruction' : 'no-instruction';
}

/**
 * The routing policy of a stage. A stage that authors no transition list is
 * unrestricted, an explicitly empty list permits no destination, and a gate or a
 * script owns its routing whatever list the stage also carries.
 */
export function routingPolicy(column: Pick<Classified, 'decision' | 'scripted' | 'allowedTransitions'>): RoutingPolicy {
  if (column.decision !== undefined) return 'decision';
  if (column.scripted !== undefined) return 'scripted';
  if (column.allowedTransitions === undefined) return 'unrestricted';
  return column.allowedTransitions.length === 0 ? 'empty' : 'configured';
}

/** The owner of the routing out of a stage; an ordinary stage owns its own. */
export function routingOwner(column: Pick<Classified, 'decision' | 'scripted'> | undefined): RoutingOwner {
  if (column?.scripted !== undefined) return 'scripted';
  if (column?.decision !== undefined) return 'decision';
  return 'stage';
}
