import type { ModelSelection } from '../shared/types.js';
import { KanbanError } from '../shared/errors.js';
import { authoredScalar, writeRootField } from './yaml-map-fields.js';
import { parseWorkflow } from './workflow.js';

/** The authored root key that carries the board's default model. */
const MODEL_KEY = 'model';
const EFFORT_KEY = 'reasoning_effort';

function invalid(message: string): never {
  throw new KanbanError('INVALID_WORKFLOW', message);
}

/** The authored entries of the mapping, in the order the writer emits them. */
function entries(selection: ModelSelection): Array<readonly [string, string]> {
  return [
    ['provider', selection.provider],
    ['model', selection.model],
    ...(selection.reasoningEffort === undefined ? [] : [[EFFORT_KEY, selection.reasoningEffort] as const]),
  ];
}

/**
 * Render the root mapping, or `null` to remove it. A flow document cannot hold a
 * block mapping, so it keeps the inline style the author used for the document.
 */
function modelField(selection: ModelSelection | undefined, indent: string, flow: boolean): string | null {
  if (selection === undefined) return null;
  const pairs = entries(selection).map(([key, value]) => key + ': ' + authoredScalar(value));
  if (flow) return MODEL_KEY + ': {' + pairs.join(', ') + '}';
  return MODEL_KEY + ':\n' + pairs.map(pair => indent + '  ' + pair).join('\n');
}

/**
 * Write or clear the board's default model in an authored workflow document.
 * Only the `model` mapping is rewritten, by text range, so comments, key order,
 * quoting, and every other authored character survive. Passing `undefined`
 * removes the mapping, which returns the board to the deployment default. The
 * result is parsed before it is returned, so a caller can never persist a
 * document the board would refuse.
 */
export function writeBoardModelField(text: string, selection: ModelSelection | undefined): string {
  const wanted = selection === undefined || !selection.provider.trim() || !selection.model.trim()
    ? undefined
    : {
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort === undefined || !selection.reasoningEffort.trim()
        ? {}
        : { reasoningEffort: selection.reasoningEffort }),
    };
  const next = writeRootField({
    text,
    fieldKeys: [MODEL_KEY],
    render: (_existing, indent, _key, flow) => modelField(wanted, indent, flow),
    invalid,
  });
  parseWorkflow(next);
  return next;
}
