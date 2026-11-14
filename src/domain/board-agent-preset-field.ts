import { authoredScalar, writeRootField } from './yaml-map-fields.js';
import { parseWorkflow } from './workflow.js';
import { KanbanError } from '../shared/errors.js';

/** The authored root key that carries the board's default agent preset. */
const PRESET_KEY = 'agent_preset';

function invalid(message: string): never {
  throw new KanbanError('INVALID_WORKFLOW', message);
}

function presetField(preset: string, indent: string, _key: string, _flow: boolean): string | null {
  return PRESET_KEY + ': ' + authoredScalar(preset);
}

/**
 * Write or clear the board's default agent preset in an authored workflow
 * document. Only the `agent_preset` scalar is rewritten, by text range, so
 * comments, key order, quoting, and every other authored character survive.
 * Passing `undefined` removes the field, which returns the board to the host
 * default preset. The result is parsed before it is returned, so a caller can
 * never persist a document the board would refuse.
 */
export function writeBoardAgentPresetField(text: string, preset: string | undefined): string {
  const wanted = preset === undefined || !preset.trim() ? undefined : preset.trim();
  const next = writeRootField({
    text,
    fieldKeys: [PRESET_KEY],
    render: (_existing, indent, key, flow) => (wanted === undefined ? null : presetField(wanted, indent, key, flow)),
    invalid,
  });
  parseWorkflow(next);
  return next;
}
