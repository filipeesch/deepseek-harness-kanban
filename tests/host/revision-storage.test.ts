import { describe, expect, it } from 'vitest';
import { createRevisionStore, type RevisionTablePort } from '../../src/host/revision-storage.js';
import { BoardRevisions } from '../../src/host/revisions.js';
import type { EncodedRevisionLog } from '../../src/domain/revisions/log.js';

class MemoryTable implements RevisionTablePort {
  readonly records = new Map<string, EncodedRevisionLog>();
  failNextPut = false;
  get(key: string) { return this.records.get(key); }
  async put(key: string, value: EncodedRevisionLog) {
    if (this.failNextPut) { this.failNextPut = false; throw new Error('disk full'); }
    this.records.set(key, structuredClone(value));
  }
  async delete(key: string) { this.records.delete(key); }
  *entries() { for (const entry of this.records.entries()) yield entry; }
}

const FLOW = 'name: Flow\ninitial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n';
const DETERMINISTIC = 'name: Flow\ninitial_column: wait\ncolumns:\n  - id: wait\n    label: Wait\n    deterministic:\n      language: bash\n      code: exit 0\n      directory: project\n      exits: {passed: done}\n  - id: done\n    label: Done\n';
const NOW = '2026-11-11T09:00:00.000Z';

function revisions(table: MemoryTable) {
  return new BoardRevisions({ store: createRevisionStore(table), now: () => NOW });
}

describe('revision storage', () => {
  it('persists the encoded record and reopens it after a restart', async () => {
    const table = new MemoryTable();
    await revisions(table).record({ hubId: 'hub', boardId: 'board', previous: FLOW, next: FLOW.replace('label: Todo', 'label: To do'), actor: { kind: 'operator' }, origin: 'editor' });
    // A fresh service over the same records is what a restart builds.
    const reopened = revisions(table);
    const log = await reopened.read('board');
    expect(log?.commits).toHaveLength(1);
    expect(log?.commits[0]?.summary).toContain('changed');
    expect(await reopened.textAt('board', log!.commits[0]!.to)).toBe(FLOW.replace('label: Todo', 'label: To do'));
  });

  it('stores an executable board with the board log version its grammar needs', async () => {
    const table = new MemoryTable();
    await revisions(table).record({ hubId: 'hub', boardId: 'board', previous: null, next: DETERMINISTIC, actor: { kind: 'agent', sessionId: 'session' }, origin: 'tool' });
    const stored = table.records.get('board');
    // The board log is the journal's own append-only envelope, one event per line.
    expect(typeof stored?.board).toBe('string');
    expect(stored?.board).toContain('workflow.replaced');
    expect((await revisions(table).read('board'))?.commits[0]?.summary).toBe('Created the board workflow.');
  });

  it('reports a broken record instead of returning a partial log', async () => {
    const table = new MemoryTable();
    table.records.set('board', { version: 1, hubId: 'hub', boardId: 'board', dropped: 0, board: { version: 99 }, commits: [] } as unknown as EncodedRevisionLog);
    await expect(revisions(table).read('board')).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('reports a failed save and keeps the previous record', async () => {
    const table = new MemoryTable();
    const service = revisions(table);
    await service.record({ hubId: 'hub', boardId: 'board', previous: null, next: FLOW, actor: { kind: 'operator' }, origin: 'editor' });
    const before = table.records.get('board');
    table.failNextPut = true;
    await expect(service.record({ hubId: 'hub', boardId: 'board', previous: FLOW, next: FLOW.replace('label: Todo', 'label: Later'), actor: { kind: 'operator' }, origin: 'editor' })).rejects.toMatchObject({ code: 'STORAGE_SAVE_FAILED' });
    expect(table.records.get('board')).toEqual(before);
  });

  it('removes every log a Hub held', async () => {
    const table = new MemoryTable();
    const service = revisions(table);
    await service.record({ hubId: 'other', boardId: 'other-board', previous: null, next: FLOW, actor: { kind: 'operator' }, origin: 'editor' });
    await service.record({ hubId: 'hub', boardId: 'board', previous: null, next: FLOW, actor: { kind: 'operator' }, origin: 'editor' });
    await service.removeHub('hub');
    expect(table.records.has('board')).toBe(false);
    expect(table.records.has('other-board')).toBe(true);
  });

  it('answers only for the revisions the log still lists', async () => {
    const table = new MemoryTable();
    const service = revisions(table);
    await service.record({ hubId: 'hub', boardId: 'board', previous: FLOW, next: FLOW.replace('label: Todo', 'label: First'), actor: { kind: 'operator' }, origin: 'editor' });
    await service.record({ hubId: 'hub', boardId: 'board', previous: FLOW, next: FLOW.replace('label: Todo', 'label: Second'), actor: { kind: 'operator' }, origin: 'editor' });
    const log = await service.read('board');
    expect(await service.textAt('board', log!.commits[1]!.to)).toBe(FLOW.replace('label: Todo', 'label: Second'));
    // The snapshot boundary and any sequence that is not a listed revision are refused.
    expect(await service.textAt('board', log!.commits[log!.commits.length - 1]!.to + 1)).toBeUndefined();
    expect(await service.textAt('board', 0)).toBeUndefined();
  });
});
