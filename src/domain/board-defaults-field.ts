import type { ModelSelection } from '../shared/types.js';
import { writeBoardAgentPresetField } from './board-agent-preset-field.js';
import { writeBoardMcpField } from './board-mcp-field.js';
import { writeBoardModelField } from './board-model-field.js';

/**
 * The board's MCP choice: every server stays visible, or an explicit selection
 * that MAY be empty to keep none. The distinction is the authored field itself:
 * keeping every server removes the root `mcp` list.
 */
export type BoardMcpSelection = { readonly mode: 'all' } | { readonly mode: 'selected'; readonly entries: readonly string[] };

/** The board defaults one Defaults save writes: a model route, an agent preset, and the MCP allowlist. */
export interface BoardDefaults {
  readonly model: ModelSelection | undefined;
  readonly preset: string | undefined;
  /** Absent leaves the authored field exactly as it is. */
  readonly mcp?: BoardMcpSelection;
}

/**
 * Write the board's default model, default agent preset, and MCP allowlist in one
 * authored document. Each root field is rewritten by its own range-preserving
 * writer, so a change to one never reformats or clears the others.
 */
export function writeBoardDefaultsField(text: string, defaults: BoardDefaults): string {
  const withModel = writeBoardModelField(text, defaults.model);
  const withPreset = writeBoardAgentPresetField(withModel, defaults.preset);
  if (defaults.mcp === undefined) return withPreset;
  return writeBoardMcpField(withPreset, defaults.mcp.mode === 'all' ? undefined : defaults.mcp.entries);
}
