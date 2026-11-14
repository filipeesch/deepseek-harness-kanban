import type { ModelSelection } from '../shared/types.js';
import { writeBoardAgentPresetField } from './board-agent-preset-field.js';
import { writeBoardModelField } from './board-model-field.js';

/** The board defaults one Defaults save writes: a model route and an agent preset. */
export interface BoardDefaults {
  readonly model: ModelSelection | undefined;
  readonly preset: string | undefined;
}

/**
 * Write the board's default model and default agent preset in one authored
 * document. Each root field is rewritten by its own range-preserving writer, so
 * a change to one never reformats or clears the other.
 */
export function writeBoardDefaultsField(text: string, defaults: BoardDefaults): string {
  return writeBoardAgentPresetField(writeBoardModelField(text, defaults.model), defaults.preset);
}
