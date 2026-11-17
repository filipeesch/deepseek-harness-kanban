import type { Board } from '../shared/types.js';

export const WORKFLOW_OPERATOR_PRESET = 'kanban-workflow-operator';

/** Authored YAML wins; legacy absence deliberately remains the host default. */
export function effectiveBoardPreset(board: Pick<Board, 'workflow' | 'defaultPresetMode'>): { preset?: string; origin: 'authored' | 'implicit-operator' | 'explicit-host' | 'legacy-host' } {
  if (board.workflow.agentPreset !== undefined) return { preset: board.workflow.agentPreset, origin: 'authored' };
  if (board.defaultPresetMode === 'operator') return { preset: WORKFLOW_OPERATOR_PRESET, origin: 'implicit-operator' };
  return { origin: board.defaultPresetMode === 'host' ? 'explicit-host' : 'legacy-host' };
}
