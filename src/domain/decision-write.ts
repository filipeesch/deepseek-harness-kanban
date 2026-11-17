import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import type { DecisionDefinition } from '../shared/types.js';
import { authoredScalar, textField } from './yaml-map-fields.js';

/**
 * Render the whole authored decision field, one option per sequence item.
 *
 * The field is written as one authored value: every edit of the configuration
 * rewrites it, and the caller keeps every other character of the document. A flow
 * mapping cannot hold a block, so a flow column receives a single-line mapping.
 */
export function renderDecisionField(key: string, definition: DecisionDefinition, indent: string, flow: boolean): string {
  if (flow) return key + ': ' + JSON.stringify(definition);
  const child = indent + '  ';
  const lines = [key + ':', child + textField('question', definition.question, child, false)];
  if (definition.context !== undefined) lines.push(child + textField('context', definition.context, child, false));
  lines.push(child + 'options:');
  for (const option of definition.options) {
    lines.push(indent + '    - id: ' + authoredScalar(option.id));
    lines.push(indent + '      title: ' + authoredScalar(option.title));
    if (option.description !== undefined) lines.push(indent + '      description: ' + authoredScalar(option.description));
    lines.push(indent + '      to: ' + authoredScalar(option.to));
  }
  return lines.join('\n');
}

/** Rewrite only the option destination scalars that name a renamed stage. */
export function renameDecisionTargets(text: string, from: string, to: string): { text: string; replaced: number } {
  const document = parseDocument(text);
  const columns = document.get('columns', true);
  const edits: Array<{ start: number; end: number; value: string }> = [];
  if (isSeq(columns)) for (const column of columns.items) {
    if (!isMap(column)) continue;
    const decision = column.get('decision', true);
    if (!isMap(decision)) continue;
    const options = decision.get('options', true);
    if (!isSeq(options)) continue;
    for (const option of options.items) {
      if (!isMap(option)) continue;
      const pair = (option.items as unknown as Array<{ key: unknown; value: unknown }>).find(item => isScalar(item.key) && item.key.value === 'to');
      const value = pair?.value;
      if (!isScalar(value) || value.value !== from || value.range == null) continue;
      const original = text.slice(value.range[0], value.range[1]);
      const quoted = original.startsWith('"') ? JSON.stringify(to) : original.startsWith("'") ? "'" + to.replaceAll("'", "''") + "'" : authoredScalar(to);
      edits.push({ start: value.range[0], end: value.range[1], value: quoted });
    }
  }
  let value = text;
  for (const edit of edits.sort((left, right) => right.start - left.start)) value = value.slice(0, edit.start) + edit.value + value.slice(edit.end);
  return { text: value, replaced: edits.length };
}
