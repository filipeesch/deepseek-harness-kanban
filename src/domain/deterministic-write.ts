import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import type { DeterministicDefinition } from '../shared/deterministic.js';
import { authoredScalar, textField, writeNestedSequenceItemField } from './yaml-map-fields.js';
import { invalidWorkflow } from './yaml-fields.js';

/** Change only differing executable fields, keeping untouched script/file quoting and comments. */
export function updateDeterministicFields(text: string, stageId: string, before: DeterministicDefinition, after: DeterministicDefinition): string {
  let value = text;
  for (const field of ['language', 'code', 'file', 'directory', 'env', 'params'] as const) {
    const previous = before[field];
    const next = after[field];
    if (JSON.stringify(previous) === JSON.stringify(next)) continue;
    value = writeNestedSequenceItemField({ text: value, sequenceKey: 'columns', idKey: 'id', id: stageId, path: ['deterministic'], fieldKeys: [field], invalid: invalidWorkflow,
      render: (_existing, indent, key, flow) => next === undefined ? null : typeof next === 'string' ? textField(key, next, indent, flow) : key + ': ' + JSON.stringify(next),
    });
  }
  for (const name of new Set([...Object.keys(after.exits), ...Object.keys(before.exits)])) {
    if (before.exits[name] === after.exits[name]) continue;
    value = writeNestedSequenceItemField({ text: value, sequenceKey: 'columns', idKey: 'id', id: stageId, path: ['deterministic', 'exits'], fieldKeys: [name], invalid: invalidWorkflow,
      render: (_existing, _indent, key) => after.exits[name] === undefined ? null : key + ': ' + authoredScalar(after.exits[name]!),
    });
  }
  return value;
}

/** Rewrite only destination scalar spans, preserving executable source and comments. */
export function renameDeterministicTargets(text: string, from: string, to: string): { text: string; replaced: number } {
  const document = parseDocument(text);
  const columns = document.get('columns', true);
  const edits: Array<{ start: number; end: number; value: string }> = [];
  if (isSeq(columns)) for (const column of columns.items) {
    if (!isMap(column)) continue;
    const deterministic = column.get('deterministic', true);
    if (!isMap(deterministic)) continue;
    const exits = deterministic.get('exits', true);
    if (!isMap(exits)) continue;
    for (const pair of exits.items) {
      if (!isScalar(pair.value) || pair.value.value !== from || pair.value.range == null) continue;
      const original = text.slice(pair.value.range[0], pair.value.range[1]);
      const quoted = original.startsWith('"') ? JSON.stringify(to) : original.startsWith("'") ? "'" + to.replaceAll("'", "''") + "'" : authoredScalar(to);
      edits.push({ start: pair.value.range[0], end: pair.value.range[1], value: quoted });
    }
  }
  let value = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) value = value.slice(0, edit.start) + edit.value + value.slice(edit.end);
  return { text: value, replaced: edits.length };
}
