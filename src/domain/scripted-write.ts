import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import type { ScriptedDefinition } from '../shared/scripted.js';
import { authoredScalar, textField, writeNestedSequenceItemField } from './yaml-map-fields.js';
import { invalidWorkflow } from './yaml-fields.js';

/**
 * The authored key that holds a stage's program, current spelling first.
 *
 * A workflow written before the rename authors the legacy spelling. Both are read,
 * and a write of that stage emits the current one.
 */
export const SCRIPTED_FIELD_KEYS = ['scripted', 'deterministic'] as const;

/** Which authored key holds one column's program, or undefined when it authors none. */
function authoredKeyOf(column: unknown): string | undefined {
  if (!isMap(column)) return undefined;
  for (const key of SCRIPTED_FIELD_KEYS) if (column.has(key)) return key;
  return undefined;
}

/** The spelling a workflow written before the rename authors. */
export const LEGACY_SCRIPTED_KEY = SCRIPTED_FIELD_KEYS[1];

/**
 * Rewrite one stage's authored program key to the current spelling, keeping the
 * authored value text.
 *
 * A write that names a stage converges it on the current spelling, so the legacy
 * one has an end; a stage no write names keeps exactly what its author wrote.
 */
export function migrateScriptedKey(text: string, stageId: string): string {
  const document = parseDocument(text);
  const columns = document.get('columns', true);
  if (!isSeq(columns)) return text;
  for (const column of columns.items) {
    if (!isMap(column) || column.get('id') !== stageId || !column.has(LEGACY_SCRIPTED_KEY)) continue;
    for (const pair of column.items as unknown as Array<{ key?: { value?: unknown; range?: readonly [number, number, number] } }>) {
      const key = pair.key;
      if (key?.value !== LEGACY_SCRIPTED_KEY || key.range === undefined) continue;
      return text.slice(0, key.range[0]) + SCRIPTED_FIELD_KEYS[0] + text.slice(key.range[1]);
    }
  }
  return text;
}

/** Which authored key holds one stage's program; the current spelling when it authors none yet. */
export function authoredScriptedKey(text: string, stageId: string): string {
  const document = parseDocument(text);
  const columns = document.get('columns', true);
  if (isSeq(columns)) {
    for (const column of columns.items) {
      if (isMap(column) && column.get('id') === stageId) return authoredKeyOf(column) ?? SCRIPTED_FIELD_KEYS[0];
    }
  }
  return SCRIPTED_FIELD_KEYS[0];
}

/** Change only differing executable fields, keeping untouched script/file quoting and comments. */
export function updateScriptedFields(text: string, stageId: string, before: ScriptedDefinition, after: ScriptedDefinition): string {
  let value = text;
  const key = authoredScriptedKey(text, stageId);
  for (const field of ['language', 'code', 'file', 'directory', 'env', 'params'] as const) {
    const previous = before[field];
    const next = after[field];
    if (JSON.stringify(previous) === JSON.stringify(next)) continue;
    value = writeNestedSequenceItemField({ text: value, sequenceKey: 'columns', idKey: 'id', id: stageId, path: [key], fieldKeys: [field], invalid: invalidWorkflow,
      render: (_existing, indent, key, flow) => next === undefined ? null : typeof next === 'string' ? textField(key, next, indent, flow) : key + ': ' + JSON.stringify(next),
    });
  }
  for (const name of new Set([...Object.keys(after.exits), ...Object.keys(before.exits)])) {
    if (before.exits[name] === after.exits[name]) continue;
    value = writeNestedSequenceItemField({ text: value, sequenceKey: 'columns', idKey: 'id', id: stageId, path: [key, 'exits'], fieldKeys: [name], invalid: invalidWorkflow,
      render: (_existing, _indent, key) => after.exits[name] === undefined ? null : key + ': ' + authoredScalar(after.exits[name]!),
    });
  }
  return value;
}

/** Rewrite only destination scalar spans, preserving executable source and comments. */
export function renameScriptedTargets(text: string, from: string, to: string): { text: string; replaced: number } {
  const document = parseDocument(text);
  const columns = document.get('columns', true);
  const edits: Array<{ start: number; end: number; value: string }> = [];
  if (isSeq(columns)) for (const column of columns.items) {
    if (!isMap(column)) continue;
    const authored = authoredKeyOf(column);
    if (authored === undefined) continue;
    const scripted = column.get(authored, true);
    if (!isMap(scripted)) continue;
    const exits = scripted.get('exits', true);
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