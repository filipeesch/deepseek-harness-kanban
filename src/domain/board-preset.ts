import type { Board, Workflow } from '../shared/types.js';
import { authoredMainAgent } from './agents.js';

export const WORKFLOW_OPERATOR_PRESET = 'kanban-workflow-operator';

/**
 * The effective preset of the board's main conversation. The authored main agent wins:
 * an entry without a preset is an explicit host default, and an entry with one names
 * that preset. A document that authors no main agent keeps the legacy resolution, where
 * the authored root scalar wins and legacy absence deliberately remains the host default.
 */
export function effectiveBoardPreset(board: Pick<Board, 'workflow' | 'defaultPresetMode'>): { preset?: string; origin: 'authored' | 'implicit-operator' | 'explicit-host' | 'legacy-host' } {
  const main = authoredMainAgent(board.workflow);
  if (main !== undefined) return main.preset === undefined ? { origin: 'explicit-host' } : { preset: main.preset, origin: 'authored' };
  if (board.workflow.agentPreset !== undefined) return { preset: board.workflow.agentPreset, origin: 'authored' };
  if (board.defaultPresetMode === 'operator') return { preset: WORKFLOW_OPERATOR_PRESET, origin: 'implicit-operator' };
  return { origin: board.defaultPresetMode === 'host' ? 'explicit-host' : 'legacy-host' };
}

/**
 * The effective model of the board's main conversation: the main agent's model, and
 * then the legacy root mapping a document without agents still authors.
 */
export function effectiveBoardModel(workflow: Pick<Workflow, 'agents' | 'model'>): Workflow['model'] {
  return authoredMainAgent(workflow)?.model ?? workflow.model;
}
