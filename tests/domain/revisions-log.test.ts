import { describe, expect, it } from 'vitest';
import {
  appendRevision, createRevisionLog, decodeRevisionLog, describeChange, encodeRevisionLog, headPresetMode, headText, RETAINED_REVISIONS, revisionLogSchema, revisionOf, stateAtRevision, textAtRevision,
} from '../../src/domain/revisions/log.js';

const BASE = '# A comment\nname: Flow\ninitial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n    allowed_transitions: [done]\n  - id: done\n    label: Done\n';
const EDITED = BASE.replace('label: Todo', 'label: To do');

function logWith(...texts: readonly string[]) {
  let log = createRevisionLog({ hubId: 'hub', boardId: 'board', text: texts[0] ?? BASE, at: '2026-11-11T09:00:00.000Z' });
  texts.slice(1).forEach((text, index) => {
    log = appendRevision(log, { text, at: '2026-11-11T09:0' + index + ':00.000Z', actor: { kind: 'operator' }, origin: 'editor' });
  });
  return log;
}

describe('revision log', () => {
  it('reports the document it holds', () => {
    expect(headText(logWith())).toBe(BASE);
    // A checkpoint is not a revision a caller may read, list, compare, or restore.
    expect(textAtRevision(logWith(), 0)).toBeUndefined();
    expect(textAtRevision(logWith(), 1)).toBeUndefined();
  });

  it('appends one commit per accepted write and replays it character for character', () => {
    const log = logWith(BASE, EDITED);
    expect(log.commits).toHaveLength(1);
    expect(log.commits[0]).toMatchObject({ from: 1, to: 1, at: '2026-11-11T09:00:00.000Z', actor: { kind: 'operator' }, origin: 'editor' });
    expect(textAtRevision(log, revisionOf(log, 0))).toBe(EDITED);
    expect(textAtRevision(log, 2)).toBeUndefined();
  });

  it('records nothing when the document did not change', () => {
    expect(logWith(BASE, BASE).commits).toHaveLength(0);
  });

  it('reconstructs a whole-document replacement character for character', () => {
    const replaced = 'name: Other\ninitial_column: one\ncolumns:\n  - id: one\n    label: One\n';
    const log = logWith(BASE, replaced);
    expect(textAtRevision(log, revisionOf(log, 0))).toBe(replaced);
  });

  it('reports an unknown revision as unavailable', () => {
    const log = logWith(BASE, EDITED);
    expect(textAtRevision(log, 99)).toBeUndefined();
    expect(textAtRevision(log, -1)).toBeUndefined();
    expect(textAtRevision(log, 0)).toBeUndefined();
  });

  it('keeps only the retained number of revisions and counts the rest', () => {
    let log = createRevisionLog({ hubId: 'hub', boardId: 'board', text: BASE, at: '2026-11-11T00:00:00.000Z' });
    for (let index = 1; index <= RETAINED_REVISIONS + 5; index++) {
      log = appendRevision(log, { text: BASE.replace('label: Todo', 'label: Todo ' + index), at: '2026-11-11T00:00:00.000Z', actor: { kind: 'operator' }, origin: 'editor' });
    }
    expect(log.commits).toHaveLength(RETAINED_REVISIONS);
    expect(log.dropped).toBe(5);
    // Retained identities never change when older revisions fold: the first
    // retained commit keeps the position it had before the fold.
    expect(revisionOf(log, 0)).toBe(6);
    expect(textAtRevision(log, 6)).toBe(BASE.replace('label: Todo', 'label: Todo 6'));
    expect(textAtRevision(log, 1)).toBeUndefined();
  });

  it('describes what a revision changed', () => {
    expect(describeChange(BASE, EDITED)).toBe('changed 1 stage');
    expect(describeChange(BASE, BASE.replace('allowed_transitions: [done]', 'allowed_transitions: []'))).toBe('changed 1 stage');
    expect(describeChange(BASE, BASE.replace('initial_column: todo', 'initial_column: done'))).toBe('workflow settings changed');
    expect(describeChange(BASE, BASE.replace('label: Todo', 'label: Todo\n    position: {x: 1, y: 2}'))).toBe('changed 1 stage, layout changed');
  });

  it('retains metadata-only revisions, including legacy absence and exact bytes', () => {
    let log = createRevisionLog({ hubId: 'hub', boardId: 'board', text: BASE, at: 'now', presetMode: null });
    for (const presetMode of ['operator', 'host', null] as const) {
      log = appendRevision(log, { text: BASE, presetMode, at: 'now', actor: { kind: 'operator' }, origin: 'editor' });
    }
    expect(log.commits).toHaveLength(3);
    expect([1, 2, 3].map(revision => stateAtRevision(log, revision))).toEqual([
      { text: BASE, presetMode: 'operator' }, { text: BASE, presetMode: 'host' }, { text: BASE, presetMode: null },
    ]);
    const decoded = decodeRevisionLog(encodeRevisionLog(log))!;
    expect(stateAtRevision(decoded, 1)).toEqual({ text: BASE, presetMode: 'operator' });
    expect(headPresetMode(decoded)).toBeNull();
  });

  it('reads older formats as legacy absence, and rejects incomplete v3 metadata', () => {
    const old = encodeRevisionLog(logWith(BASE, EDITED));
    const { checkpointPresetMode: _checkpoint, ...rest } = old;
    const commits = old.commits.map(({ presetMode: _presetMode, ...commit }) => commit);
    for (const version of [1, 2]) {
      const decoded = decodeRevisionLog({ ...rest, version, commits })!;
      expect(stateAtRevision(decoded, 1)).toEqual({ text: EDITED, presetMode: null });
      expect(decodeRevisionLog(encodeRevisionLog(decoded))).toBeDefined();
    }
    expect(decodeRevisionLog({ ...rest, version: 3, commits })).toBeUndefined();
  });

  it('retains preset snapshots when metadata-only commits are pruned', () => {
    let log = createRevisionLog({ hubId: 'hub', boardId: 'board', text: BASE, at: 'now' });
    for (let i = 1; i <= RETAINED_REVISIONS + 5; i++) {
      log = appendRevision(log, { text: BASE, presetMode: i % 2 ? 'operator' : 'host', at: 'now', actor: { kind: 'operator' }, origin: 'editor' });
    }
    expect(log.dropped).toBe(5);
    expect(stateAtRevision(log, 6)).toEqual({ text: BASE, presetMode: 'host' });
    expect(stateAtRevision(decodeRevisionLog(encodeRevisionLog(log))!, 105)).toEqual({ text: BASE, presetMode: 'operator' });
  });

  it('round-trips through the stored form', () => {
    const log = logWith(BASE, EDITED);
    const decoded = revisionLogSchema.parse(encodeRevisionLog(log));
    expect(decoded.hubId).toBe('hub');
    expect(decoded.boardId).toBe('board');
    expect(decoded.commits).toHaveLength(1);
    expect(textAtRevision(decoded, revisionOf(decoded, 0))).toBe(EDITED);
    expect(decoded.baseline?.kind).toBe('created');
  });
});