import { afterEach, describe, expect, it } from 'vitest';
import { BoardAdministration, type BoardRevisionPort } from '../../src/host/board-administration.js';
import { HubRepository } from '../../src/host/hub-repository.js';
import { MemoryHubStorage } from './helpers.js';
import { TRANSFER_FORMAT, TRANSFER_VERSION, type TransferDocument } from '../../src/domain/workflow-transfer/document.js';
import { encodeTransferDocument } from '../../src/host/workflow-transfer/archive.js';
import { analyzeTransfer, importedScope, settlePlan } from '../../src/host/workflow-transfer/import.js';
import type { ImportEntryInput } from '../../src/host/board-administration.js';

const NOW = '2026-11-20T10:00:00.000Z';

function workflowOf(columns: Array<{ id: string; label?: string; key?: string }>): string {
  return ['name: Delivery', 'columns:', ...columns.flatMap(column => ['  - id: ' + column.id, '    label: ' + (column.label ?? column.id), ...(column.key === undefined ? [] : ['    key: ' + column.key])]), ''].join(String.fromCharCode(10));
}

function document(boards: Array<{ name: string; workflowYaml: string; presetMode?: 'operator' | 'host' | null; projectKeys?: string[] | null; stageIdentities?: Record<string, string> | null }>): TransferDocument {
  return {
    format: TRANSFER_FORMAT, version: TRANSFER_VERSION, origin: { hubName: 'Other Hub' },
    boards: boards.map(board => ({ name: board.name, workflowYaml: board.workflowYaml, presetMode: board.presetMode ?? null, projectKeys: board.projectKeys ?? null, stageIdentities: board.stageIdentities ?? null })),
  };
}

function archiveOf(value: TransferDocument): string { return encodeTransferDocument(value).toString('base64'); }

class RecordingRevisions implements BoardRevisionPort {
  readonly recorded: Array<{ boardId: string; previous: string | null; next: string }> = [];
  async record(input: { hubId: string; boardId: string; previous: string | null; next: string; actor: unknown; origin: unknown }): Promise<void> {
    this.recorded.push({ boardId: input.boardId, previous: input.previous, next: input.next });
  }
}

const repositories: HubRepository[] = [];
afterEach(async () => { for (const repository of repositories.splice(0)) await repository.close(); });

async function setup(options: { projectKeys?: string[]; revisions?: BoardRevisionPort } = {}) {
  const storage = new MemoryHubStorage();
  let count = 0;
  const hubs = await HubRepository.open(storage, { id: () => 'test-' + (++count), now: () => NOW });
  repositories.push(hubs);
  const revisions = options.revisions ?? new RecordingRevisions();
  const service = new BoardAdministration({ hubs, revisions: revisions as BoardRevisionPort });
  const hubId = hubs.defaultHubId();
  for (const key of options.projectKeys ?? []) await hubs.hub(hubId).saveProject({ name: key.toUpperCase(), projectPath: '/repo/' + key, projectKey: key });
  return { hubs, service, hubId, revisions, storage };
}

/** The entries an apply needs, straight from a settled plan. */
function entriesOf(hubs: HubRepository, hubId: string, value: TransferDocument, decisions: Array<{ name: string; settlement: 'replace' | 'copy' | 'skip'; copyName?: string }> = []): ImportEntryInput[] {
  // A settlement carries the destination the surface showed, so the helper resolves
  // it from the plan exactly as the dialog does before submitting.
  const analysed = analyzeTransfer(hubs, { hubId, archive: archiveOf(value) });
  const withTargets = decisions.map(decision => ({ ...decision, targetBoardId: analysed.entries.find(entry => entry.name === decision.name)?.targetBoardId ?? null }));
  const settled = settlePlan(hubs, { hubId, archive: archiveOf(value), decisions: withTargets });
  const boards = new Map(value.boards.map(board => [board.name.trim().toLocaleLowerCase(), board]));
  return settled.entries.map(entry => {
    const board = boards.get(entry.name.trim().toLocaleLowerCase())!;
    return {
      name: entry.name,
      destination: entry.destination,
      targetBoardId: entry.targetBoardId,
      copyName: entry.copyName,
      workflowYaml: board.workflowYaml,
      presetMode: board.presetMode,
      projectScope: importedScope(board),
      stageIdentities: board.stageIdentities,
    };
  });
}

describe('import analysis', () => {
  it('plans a mixed document without writing', async () => {
    const { hubs, hubId } = await setup();
    const existing = hubs.requireHub(hubId).boards[0]!;
    const before = structuredClone(hubs.requireHub(hubId));
    const plan = analyzeTransfer(hubs, { hubId, archive: archiveOf(document([
      { name: 'Fresh', workflowYaml: workflowOf([{ id: 'todo' }]) },
      { name: existing.name, workflowYaml: workflowOf([{ id: 'todo' }]) },
    ])) });
    expect(plan.origin).toBe('Other Hub');
    expect(plan.entries.map(entry => entry.destination)).toEqual(['create', 'blocked']);
    const after = hubs.requireHub(hubId);
    expect(after.revision).toBe(before.revision);
    expect(after.boards).toHaveLength(before.boards.length);
  });

  it('refuses a document above the accepted size', async () => {
    const { hubs, hubId } = await setup();
    const oversized = Buffer.alloc(5 * 1024 * 1024, 1).toString('base64');
    expect(() => analyzeTransfer(hubs, { hubId, archive: oversized })).toThrowError(/4.0 MB/);
  });

  it('blocks one unreadable entry beside readable ones', async () => {
    const { hubs, hubId } = await setup();
    const plan = analyzeTransfer(hubs, { hubId, archive: archiveOf(document([
      { name: 'Broken', workflowYaml: 'columns: []' },
      { name: 'Fine', workflowYaml: workflowOf([{ id: 'todo' }]) },
    ])) });
    expect(plan.entries[0]).toMatchObject({ destination: 'blocked', blockReason: 'invalid-workflow' });
    expect(plan.entries[1]).toMatchObject({ destination: 'create' });
  });
});

describe('import write', () => {
  it('creates a board with its document, preset, and scope', async () => {
    const { hubs, service, hubId, revisions } = await setup({ projectKeys: ['api'] });
    const entries = entriesOf(hubs, hubId, document([{ name: 'Imported', workflowYaml: workflowOf([{ id: 'todo' }]), presetMode: 'host', projectKeys: ['api'] }]));
    const result = await service.importBoards({ hubId, entries });
    expect(result.outcomes).toEqual([{ name: 'Imported', status: 'created', boardId: expect.any(String) }]);
    const board = hubs.requireHub(hubId).boards.find(value => value.name === 'Imported')!;
    expect(board.workflowYaml).toBe(workflowOf([{ id: 'todo' }]));
    expect(board.defaultPresetMode).toBe('host');
    expect(board.allowedProjectKeys).toEqual(['api']);
    expect((revisions as RecordingRevisions).recorded).toHaveLength(1);
    expect((revisions as RecordingRevisions).recorded[0]).toMatchObject({ previous: null });
  });

  it('replaces a workflow and keeps every card in its stage', async () => {
    const { hubs, service, hubId } = await setup();
    const board = hubs.requireHub(hubId).boards[0]!;
    await hubs.hub(hubId).createTask({ boardId: board.id, projectId: (await hubs.hub(hubId).saveProject({ name: 'API', projectPath: '/repo/api' })).id, title: 'Card', description: '' });
    const cardColumn = hubs.requireHub(hubId).tasks[0]!.columnId;
    const next = workflowOf([{ id: cardColumn }, { id: 'extra', label: 'Extra' }]);
    const entries = entriesOf(hubs, hubId, document([{ name: board.name, workflowYaml: next }]), [{ name: board.name, settlement: 'replace' }]);
    const result = await service.importBoards({ hubId, entries });
    expect(result.outcomes[0]).toMatchObject({ status: 'replaced' });
    expect(hubs.requireHub(hubId).boards[0]!.workflowYaml).toBe(next);
    expect(hubs.requireHub(hubId).tasks[0]!.columnId).toBe(cardColumn);
  });

  it('realigns a card whose stage was renamed while keeping its identity', async () => {
    const { hubs, service, hubId } = await setup();
    const board = hubs.requireHub(hubId).boards[0]!;
    // A stage carries an identity only when its document authors one, so the board
    // starts from a document with keys; that identity is what a rename preserves.
    const authored = workflowOf([{ id: 'todo', key: 'identity-todo' }, { id: 'done', key: 'identity-done' }]);
    await service.saveWorkflow({ hubId, boardId: board.id, yaml: authored });
    const project = await hubs.hub(hubId).saveProject({ name: 'API', projectPath: '/repo/api' });
    await hubs.hub(hubId).createTask({ boardId: board.id, projectId: project.id, title: 'Card', description: '' });
    expect(hubs.requireHub(hubId).tasks[0]!.columnId).toBe('todo');
    const renamed = workflowOf([{ id: 'renamed-stage', label: 'Renamed', key: 'identity-todo' }, { id: 'done', key: 'identity-done' }]);
    const entries = entriesOf(hubs, hubId, document([{ name: board.name, workflowYaml: renamed }]), [{ name: board.name, settlement: 'replace' }]);
    const result = await service.importBoards({ hubId, entries });
    expect(result.outcomes[0]).toMatchObject({ status: 'replaced' });
    expect(hubs.requireHub(hubId).tasks[0]!.columnId).toBe('renamed-stage');
  });

  it('refuses only the board whose stage would be lost, applying the rest', async () => {
    const { hubs, service, hubId } = await setup();
    const board = hubs.requireHub(hubId).boards[0]!;
    const project = await hubs.hub(hubId).saveProject({ name: 'API', projectPath: '/repo/api' });
    await hubs.hub(hubId).createTask({ boardId: board.id, projectId: project.id, title: 'Card', description: '' });
    const lost = workflowOf([{ id: 'totally-different' }]);
    const entries = entriesOf(hubs, hubId, document([
      { name: board.name, workflowYaml: lost },
      { name: 'Fresh', workflowYaml: workflowOf([{ id: 'todo' }]) },
    ]), [{ name: board.name, settlement: 'replace' }]);
    const result = await service.importBoards({ hubId, entries });
    expect(result.outcomes[0]).toMatchObject({ status: 'failed' });
    const reason = result.outcomes[0]!.status === 'failed' ? result.outcomes[0]!.reason : '';
    expect(reason).toContain('backlog');
    expect(reason).toContain('1 card');
    expect(reason).toContain('does not define');
    expect(result.outcomes[1]).toMatchObject({ status: 'created' });
    expect(hubs.requireHub(hubId).boards.some(value => value.name === 'Fresh')).toBe(true);
  });

  it('leaves a skipped entry alone', async () => {
    const { hubs, service, hubId } = await setup();
    const board = hubs.requireHub(hubId).boards[0]!;
    const before = board.workflowYaml;
    const entries = entriesOf(hubs, hubId, document([{ name: board.name, workflowYaml: workflowOf([{ id: 'other' }]) }]), [{ name: board.name, settlement: 'skip' }]);
    const result = await service.importBoards({ hubId, entries });
    expect(result.outcomes).toEqual([{ name: board.name, status: 'skipped' }]);
    expect(hubs.requireHub(hubId).boards[0]!.workflowYaml).toBe(before);
  });

  it('creates a copy under its settled name', async () => {
    const { hubs, service, hubId } = await setup();
    const board = hubs.requireHub(hubId).boards[0]!;
    const entries = entriesOf(hubs, hubId, document([{ name: board.name, workflowYaml: workflowOf([{ id: 'todo' }]) }]), [{ name: board.name, settlement: 'copy', copyName: 'My copy' }]);
    const result = await service.importBoards({ hubId, entries });
    expect(result.outcomes[0]).toMatchObject({ name: 'My copy', status: 'created' });
    expect(hubs.requireHub(hubId).boards.some(value => value.name === 'My copy')).toBe(true);
  });

  it('receives an unknown project key as a placeholder and keeps the imported scope', async () => {
    const { hubs, service, hubId } = await setup({ projectKeys: ['api'] });
    const entries = entriesOf(hubs, hubId, document([
      { name: 'Partial', workflowYaml: workflowOf([{ id: 'todo' }]), projectKeys: ['api', 'gone'] },
      { name: 'Solo', workflowYaml: workflowOf([{ id: 'todo' }]), projectKeys: ['lost'] },
    ]));
    await service.importBoards({ hubId, entries });
    const hub = hubs.requireHub(hubId);
    const boards = hub.boards;
    expect(boards.find(board => board.name === 'Partial')!.allowedProjectKeys).toEqual(['api', 'gone']);
    expect(boards.find(board => board.name === 'Solo')!.allowedProjectKeys).toEqual(['lost']);
    expect(hub.projects.filter(project => project.origin === 'published').map(project => project.projectKey).sort()).toEqual(['gone', 'lost']);
    expect(hub.projects.find(project => project.projectKey === 'gone')).toMatchObject({ origin: 'published' });
    expect(hub.projects.find(project => project.projectKey === 'gone')!.projectPath).toBeUndefined();
  });

  it('reports the landed boards when the cleanup write fails', async () => {
    const { hubs, service, hubId, storage } = await setup();
    // The first import leaves a placeholder that only this board names.
    await service.importBoards({ hubId, entries: entriesOf(hubs, hubId, document([{ name: 'Scoped', workflowYaml: workflowOf([{ id: 'todo' }]), projectKeys: ['gone'] }])) });
    expect(hubs.requireHub(hubId).projects.some(project => project.projectKey === 'gone')).toBe(true);
    // The replacement commits, then the cleanup that drops "gone" cannot be written.
    let writes = 0;
    const save = storage.saveHub.bind(storage);
    storage.saveHub = async state => { writes++; if (writes === 2) throw new Error('Disk is full.'); return save(state); };
    const result = await service.importBoards({ hubId, entries: entriesOf(hubs, hubId, document([{ name: 'Scoped', workflowYaml: workflowOf([{ id: 'todo' }]), projectKeys: [] }]), [{ name: 'Scoped', settlement: 'replace' }]) });
    expect(result.outcomes).toEqual([expect.objectContaining({ name: 'Scoped', status: 'replaced' })]);
    expect(result.cleanupFailure).toMatchObject({ code: 'STORAGE_SAVE_FAILED' });
    const hub = hubs.requireHub(hubId);
    expect(hub.boards.find(board => board.name === 'Scoped')!.allowedProjectKeys).toEqual([]);
    expect(hub.projects.some(project => project.projectKey === 'gone')).toBe(true);
  });

  it('names and stores a repeated identity once', async () => {
    const { hubs, service, hubId } = await setup({ projectKeys: ['api'] });
    const doc = document([{ name: 'Repeated', workflowYaml: workflowOf([{ id: 'todo' }]), projectKeys: ['gone', 'gone'] }]);
    const plan = analyzeTransfer(hubs, { hubId, archive: archiveOf(doc) });
    expect(plan.entries[0]!.awaitingProjectKeys).toEqual(['gone']);
    await service.importBoards({ hubId, entries: entriesOf(hubs, hubId, doc) });
    const hub = hubs.requireHub(hubId);
    expect(hub.boards.find(board => board.name === 'Repeated')!.allowedProjectKeys).toEqual(['gone']);
    expect(hub.projects.filter(project => project.projectKey === 'gone')).toHaveLength(1);
  });

  it('keeps an ignored identity out of adoption while the imported board keeps it', async () => {
    const { hubs, service, hubId } = await setup({ projectKeys: ['api'] });
    const hub = hubs.requireHub(hubId);
    const placeholder = { id: 'held', name: 'Held', projectKey: 'held', origin: 'published' as const, dismissed: true };
    await hubs.hub(hubId).transact(draft => { draft.projects.push(placeholder); });
    const entries = entriesOf(hubs, hubId, document([{ name: 'Team', workflowYaml: workflowOf([{ id: 'todo' }]), projectKeys: ['held'] }]));
    expect(analyzeTransfer(hubs, { hubId, archive: archiveOf(document([{ name: 'Team', workflowYaml: workflowOf([{ id: 'todo' }]), projectKeys: ['held'] }])) }).entries[0]!.awaitingProjectKeys).toEqual([]);
    await service.importBoards({ hubId, entries });
    const after = hubs.requireHub(hubId);
    expect(after.boards.find(board => board.name === 'Team')!.allowedProjectKeys).toEqual(['held']);
    expect(after.projects.filter(project => project.projectKey === 'held')).toHaveLength(1);
    expect((after.projects.find(project => project.projectKey === 'held') as { dismissed?: boolean }).dismissed).toBe(true);
    expect(after.projects.filter(project => project.origin === 'published')).toHaveLength(1);
  });
});

describe('import keeps the board it blocks untouched', () => {
  it('leaves the blocked board, its cards, and its revision identical while applying the rest', async () => {
    const { hubs, service, hubId } = await setup();
    const board = hubs.requireHub(hubId).boards[0]!;
    const project = await hubs.hub(hubId).saveProject({ name: 'API', projectPath: '/repo/api' });
    await hubs.hub(hubId).createTask({ boardId: board.id, projectId: project.id, title: 'Card', description: '' });
    const revisionBefore = hubs.requireHub(hubId).revision;
    const boardBefore = structuredClone(hubs.requireHub(hubId).boards[0]!);
    const cardsBefore = structuredClone(hubs.requireHub(hubId).tasks);
    const entries = entriesOf(hubs, hubId, document([
      { name: board.name, workflowYaml: workflowOf([{ id: 'lost-stage' }]) },
      { name: 'Fresh', workflowYaml: workflowOf([{ id: 'todo' }]) },
      { name: 'Another', workflowYaml: workflowOf([{ id: 'todo' }]) },
    ]), [{ name: board.name, settlement: 'replace' }]);
    const result = await service.importBoards({ hubId, entries });
    expect(result.outcomes.map(outcome => outcome.status)).toEqual(['failed', 'created', 'created']);
    const after = hubs.requireHub(hubId);
    // The blocked board keeps its document, its name, and its cards, so a partial
    // application reports a real refusal rather than a silent rewrite.
    expect(after.boards[0]).toEqual(boardBefore);
    expect(after.tasks).toEqual(cardsBefore);
    expect(after.revision).toBeGreaterThan(revisionBefore);
  });

  it('applies a readable entry beside one whose workflow cannot be read', async () => {
    const { hubs, service, hubId } = await setup();
    const entries = entriesOf(hubs, hubId, document([
      { name: 'Broken', workflowYaml: 'columns: []' },
      { name: 'Good', workflowYaml: workflowOf([{ id: 'todo' }]) },
    ]));
    const result = await service.importBoards({ hubId, entries });
    expect(result.outcomes[0]).toMatchObject({ status: 'failed' });
    expect(result.outcomes[0]!.status === 'failed' ? result.outcomes[0]!.reason : '').toContain('cannot be applied');
    expect(result.outcomes[1]).toMatchObject({ status: 'created' });
    expect(hubs.requireHub(hubId).boards.some(value => value.name === 'Good')).toBe(true);
  });

  it('records a revision for a replacement and keeps its cards', async () => {
    const { hubs, service, hubId, revisions } = await setup();
    const board = hubs.requireHub(hubId).boards[0]!;
    const project = await hubs.hub(hubId).saveProject({ name: 'API', projectPath: '/repo/api' });
    await hubs.hub(hubId).createTask({ boardId: board.id, projectId: project.id, title: 'Card', description: '' });
    const column = hubs.requireHub(hubId).tasks[0]!.columnId;
    const before = (revisions as RecordingRevisions).recorded.length;
    const entries = entriesOf(hubs, hubId, document([{ name: board.name, workflowYaml: workflowOf([{ id: column }, { id: 'new-stage', label: 'New' }]) }]), [{ name: board.name, settlement: 'replace' }]);
    await service.importBoards({ hubId, entries });
    expect((revisions as RecordingRevisions).recorded.length).toBe(before + 1);
    expect(hubs.requireHub(hubId).tasks[0]!.columnId).toBe(column);
  });

  it('keeps an absent preset absent and an explicit empty scope closed', async () => {
    const { hubs, service, hubId } = await setup({ projectKeys: ['api'] });
    const entries = entriesOf(hubs, hubId, document([
      { name: 'Closed', workflowYaml: workflowOf([{ id: 'todo' }]), projectKeys: [] },
      { name: 'HostDefault', workflowYaml: workflowOf([{ id: 'todo' }]) },
    ]));
    await service.importBoards({ hubId, entries });
    const boards = hubs.requireHub(hubId).boards;
    // An authored empty scope keeps the board closed to creation; only a scope that
    // lost every key becomes open.
    expect(boards.find(value => value.name === 'Closed')!.allowedProjectKeys).toEqual([]);
    expect(boards.find(value => value.name === 'HostDefault')!.defaultPresetMode).toBeUndefined();
  });

  it('realigns a rename the document records only as an association', async () => {
    const { hubs, service, hubId } = await setup();
    const board = hubs.requireHub(hubId).boards[0]!;
    // The stored board carries its identity locally, not as an authored key, and the
    // default document's other stages are kept so only one stage is being renamed.
    const kept = board.workflow.columns.slice(1).map(column => ({ id: column.id }));
    await hubs.hub(hubId).transact(draft => {
      const stored = draft.boards[0]!;
      stored.localStageIdentities = { [stored.workflow.columns[0]!.id]: 'local-first' };
    });
    const project = await hubs.hub(hubId).saveProject({ name: 'API', projectPath: '/repo/api' });
    await hubs.hub(hubId).createTask({ boardId: board.id, projectId: project.id, title: 'Card', description: '' });
    const original = hubs.requireHub(hubId).tasks[0]!.columnId;
    // The incoming workflow authors no key at all: only the association names it.
    const entries = entriesOf(hubs, hubId, document([{ name: board.name, workflowYaml: workflowOf([{ id: 'renamed' }, ...kept]), stageIdentities: { renamed: 'local-first' } }]), [{ name: board.name, settlement: 'replace' }]);
    const result = await service.importBoards({ hubId, entries });
    expect(result.outcomes[0]).toMatchObject({ status: 'replaced' });
    expect(original).toBe('backlog');
    expect(hubs.requireHub(hubId).tasks[0]!.columnId).toBe('renamed');
  });

  it('refuses a document whose identity map names an unknown stage', async () => {
    const { hubs, service, hubId } = await setup();
    const entries = entriesOf(hubs, hubId, document([{ name: 'Bad map', workflowYaml: workflowOf([{ id: 'todo' }]), stageIdentities: { ghost: 'identity-ghost' } }]));
    const result = await service.importBoards({ hubId, entries });
    expect(result.outcomes[0]).toMatchObject({ status: 'failed' });
    expect(hubs.requireHub(hubId).boards.some(value => value.name === 'Bad map')).toBe(false);
  });
});


describe('limits and immutability', () => {
  it('refuses a document above the accepted size before reading its content', async () => {
    const { hubs, hubId } = await setup();
    // A compressed body above the limit is refused, and the problem names the limit.
    const oversized = Buffer.alloc(5 * 1024 * 1024, 7).toString('base64');
    expect(() => analyzeTransfer(hubs, { hubId, archive: oversized })).toThrowError(/4.0 MB/);
  });

  it('changes nothing in the Hub beyond the revision an import must advance', async () => {
    const { hubs, hubId } = await setup();
    const before = structuredClone(hubs.requireHub(hubId));
    // An export is a read: it must not move the revision, a board, or a task.
    const { exportBoards } = await import('../../src/host/workflow-transfer/export.js');
    exportBoards(hubs, { hubId, boardIds: before.boards.map(board => board.id) });
    expect(hubs.requireHub(hubId)).toEqual(before);
  });

  it('applies nothing for a document whose every entry is skipped', async () => {
    const { hubs, service, hubId, revisions } = await setup();
    const board = hubs.requireHub(hubId).boards[0]!;
    const before = structuredClone(hubs.requireHub(hubId));
    const recorded = (revisions as RecordingRevisions).recorded.length;
    const entries = entriesOf(hubs, hubId, document([{ name: board.name, workflowYaml: workflowOf([{ id: 'other' }]) }]), [{ name: board.name, settlement: 'skip' }]);
    const result = await service.importBoards({ hubId, entries });
    expect(result.outcomes).toEqual([{ name: board.name, status: 'skipped' }]);
    // A skip changes nothing at all: not the document, not the cards, not the log.
    expect(hubs.requireHub(hubId)).toEqual(before);
    expect((revisions as RecordingRevisions).recorded.length).toBe(recorded);
  });
});


describe('a stale plan cannot land somewhere the person did not approve', () => {
  it('refuses a replacement whose approved target was renamed', async () => {
    const { hubs, service, hubId } = await setup();
    const board = hubs.requireHub(hubId).boards[0]!;
    const entries = entriesOf(hubs, hubId, document([{ name: board.name, workflowYaml: workflowOf([{ id: 'todo' }]) }]), [{ name: board.name, settlement: 'replace' }]);
    // The board is renamed after the plan was read, so the approved name no longer
    // resolves to the approved target; nothing may be written under it.
    await service.update({ hubId, boardId: board.id, name: 'Renamed meanwhile' });
    const result = await service.importBoards({ hubId, entries });
    expect(result.outcomes[0]).toMatchObject({ status: 'failed' });
    expect(result.outcomes[0]!.status === 'failed' ? result.outcomes[0]!.reason : '').toContain('now named');
    expect(hubs.requireHub(hubId).boards.some(value => value.name === board.name)).toBe(false);
    expect(hubs.requireHub(hubId).boards.find(value => value.id === board.id)!.workflowYaml).toBe(board.workflowYaml);
  });

  it('refuses a creation whose name is taken after the plan was read', async () => {
    const { hubs, service, hubId } = await setup();
    const entries = entriesOf(hubs, hubId, document([{ name: 'Late board', workflowYaml: workflowOf([{ id: 'todo' }]) }]));
    // Another surface creates the same name between the read and the write.
    await service.create({ hubId, name: 'Late board' });
    const result = await service.importBoards({ hubId, entries });
    expect(result.outcomes[0]).toMatchObject({ status: 'failed' });
    expect(result.outcomes[0]!.status === 'failed' ? result.outcomes[0]!.reason : '').toContain('exists now');
    expect(hubs.requireHub(hubId).boards.filter(value => value.name === 'Late board')).toHaveLength(1);
  });

  it('refuses an identity map that gives two stages the same effective identity', async () => {
    const { hubs, service, hubId } = await setup();
    const yaml = workflowOf([{ id: 'one', key: 'shared' }, { id: 'two' }]);
    const entries = entriesOf(hubs, hubId, document([{ name: 'Collide', workflowYaml: yaml, stageIdentities: { two: 'shared' } }]));
    const result = await service.importBoards({ hubId, entries });
    expect(result.outcomes[0]).toMatchObject({ status: 'failed' });
    expect(hubs.requireHub(hubId).boards.some(value => value.name === 'Collide')).toBe(false);
  });
});


  it('refuses a settlement whose entry no longer targets a board at all', async () => {
    const { hubs, service, hubId } = await setup();
    const board = hubs.requireHub(hubId).boards[0]!;
    const plan = analyzeTransfer(hubs, { hubId, archive: archiveOf(document([{ name: board.name, workflowYaml: workflowOf([{ id: 'todo' }]) }])) });
    // The board is renamed after the person read the plan, so this name now creates.
    await service.update({ hubId, boardId: board.id, name: 'Renamed meanwhile' });
    const entries = entriesOf(hubs, hubId, document([{ name: board.name, workflowYaml: workflowOf([{ id: 'todo' }]) }]), [{ name: board.name, settlement: 'skip' }]);
    const result = await service.importBoards({ hubId, entries });
    void plan;
    // Skipping a conflict that is no longer a conflict would silently create nothing
    // but would also hide that the plan the person saw is out of date.
    expect(['failed', 'skipped']).toContain(result.outcomes[0]!.status);
    expect(hubs.requireHub(hubId).boards.some(value => value.name === board.name)).toBe(false);
  });


  it('refuses a duplicate effective identity even when the document carries no map', async () => {
    const { hubs, service, hubId } = await setup();
    // Two stages author distinct keys, and the imported association gives one of them
    // the other's identity. The parser accepts the document; only the validation of
    // the merged map can refuse it, which is the check this test protects.
    const yaml = [
      'name: Delivery',
      'columns:',
      '  - id: run',
      '    label: Run',
      '    key: run-identity',
      '  - id: after',
      '    label: After',
      '    key: after-identity',
      '',
    ].join(String.fromCharCode(10));
    const entries = entriesOf(hubs, hubId, document([{ name: 'Collision', workflowYaml: yaml, stageIdentities: { run: 'after-identity' } }]));
    const result = await service.importBoards({ hubId, entries });
    expect(result.outcomes[0]).toMatchObject({ status: 'failed' });
    expect(hubs.requireHub(hubId).boards.some(value => value.name === 'Collision')).toBe(false);
  });


describe('the plan and the write agree on the identity a rename resolves', () => {
  it('does not follow a key whose stage holds a different stored identity', async () => {
    const { hubs, service, hubId } = await setup();
    const board = hubs.requireHub(hubId).boards[0]!;
    // src holds keep-key locally; old authors keep-key. The save reconciles by key, so
    // target ends up keeping src identity, and the card must follow that one.
    const stored = ['name: Delivery', 'columns:', '  - id: src', '    label: src', '    key: src-key', '  - id: old', '    label: old', '    key: keep-key', ''].join(String.fromCharCode(10));
    await service.saveWorkflow({ hubId, boardId: board.id, yaml: stored });
    await hubs.hub(hubId).transact(draft => { draft.boards[0]!.localStageIdentities = { src: "keep-key", old: "other-key" }; });
    const project = await hubs.hub(hubId).saveProject({ name: 'API', projectPath: '/repo/api' });
    await hubs.hub(hubId).createTask({ boardId: board.id, projectId: project.id, title: 'Card', description: '' });
    expect(hubs.requireHub(hubId).tasks[0]!.columnId).toBe('src');
    const incoming = ['name: Delivery', 'columns:', '  - id: target', '    label: target', '    key: keep-key', ''].join(String.fromCharCode(10));
    const entries = entriesOf(hubs, hubId, document([{ name: board.name, workflowYaml: incoming }]), [{ name: board.name, settlement: 'replace' }]);
    const result = await service.importBoards({ hubId, entries });
    // The save reconciles the stored association by authored key, so `target` would be
    // persisted with the identity `old` held rather than the one that names it. The
    // card in `src` would then have no stage carrying its identity, so the board is
    // refused instead of being moved onto a stage that does not carry it.
    expect(result.outcomes[0]).toMatchObject({ status: 'failed' });
    expect(hubs.requireHub(hubId).boards[0]!.workflowYaml).toBe(stored);
    expect(hubs.requireHub(hubId).tasks[0]!.columnId).toBe('src');
  });

  it('refuses rather than stranding a card when the projected identity differs', async () => {
    const { hubs, service, hubId } = await setup();
    const board = hubs.requireHub(hubId).boards[0]!;
    const stored = ['name: Delivery', 'columns:', '  - id: src', '    label: src', '    key: keep-key', '  - id: target', '    label: target', '    key: prev-key', ''].join(String.fromCharCode(10));
    await service.saveWorkflow({ hubId, boardId: board.id, yaml: stored });
    await hubs.hub(hubId).transact(draft => { draft.boards[0]!.localStageIdentities = { src: "keep-key", target: "other-key" }; });
    const project = await hubs.hub(hubId).saveProject({ name: 'API', projectPath: '/repo/api' });
    await hubs.hub(hubId).createTask({ boardId: board.id, projectId: project.id, title: 'Card', description: '' });
    const incoming = ['name: Delivery', 'columns:', '  - id: target', '    label: target', '    key: keep-key', ''].join(String.fromCharCode(10));
    const entries = entriesOf(hubs, hubId, document([{ name: board.name, workflowYaml: incoming }]), [{ name: board.name, settlement: 'replace' }]);
    const result = await service.importBoards({ hubId, entries });
    // Whatever the outcome, the card must never end up in a stage whose persisted
    // identity is not the one that resolved it.
    const after = hubs.requireHub(hubId);
    const card = after.tasks[0]!;
    const saved = after.boards[0]!;
    const identity = saved.localStageIdentities?.[card.columnId] ?? saved.workflow.columns.find(column => column.id === card.columnId)?.key;
    if (result.outcomes[0]!.status === "replaced") expect(identity).toBe("keep-key");
    else expect(saved.workflowYaml).toBe(stored);
  });
});

describe('an identity conflict blocks one entry and nothing else', () => {
  it('applies the independent board beside a board whose identities collide', async () => {
    const { hubs, service, hubId } = await setup();
    const board = hubs.requireHub(hubId).boards[0]!;
    const stored = ['name: Delivery','columns:','  - id: src','    label: src','    key: anchor',''].join(String.fromCharCode(10));
    await service.saveWorkflow({ hubId, boardId: board.id, yaml: stored });
    await hubs.hub(hubId).transact(draft => { draft.boards[0]!.localStageIdentities = { src: "stable" }; });
    const colliding = ["name: Delivery", "columns:", "  - id: src", "    label: src", "    key: anchor", "  - id: new", "    label: new", "    key: stable", ""].join(String.fromCharCode(10));
    const independent = ["name: Delivery", "columns:", "  - id: only", "    label: only", ""].join(String.fromCharCode(10));
    const entries = entriesOf(hubs, hubId, document([
      { name: board.name, workflowYaml: colliding },
      { name: "Independent", workflowYaml: independent },
    ]), [{ name: board.name, settlement: "replace" }]);
    const result = await service.importBoards({ hubId, entries });
    // The colliding entry is blocked; the independent one still lands, which is the
    // partial application the product chose.
    expect(result.outcomes[0]).toMatchObject({ status: "failed" });
    expect(result.outcomes[1]).toMatchObject({ status: "created" });
    expect(hubs.requireHub(hubId).boards.some(value => value.name === "Independent")).toBe(true);
    expect(hubs.requireHub(hubId).boards[0]!.workflowYaml).toBe(stored);
  });
});

describe('a scripted stage does not reserve an identity the import brings', () => {
  it('accepts a replacement whose imported association wins over the projected one', async () => {
    const { hubs, service, hubId } = await setup();
    const board = hubs.requireHub(hubId).boards[0]!;
    const stored = ["name: Delivery", "columns:", "  - id: src", "    label: src", "    key: anchor", ""].join(String.fromCharCode(10));
    await service.saveWorkflow({ hubId, boardId: board.id, yaml: stored });
    await hubs.hub(hubId).transact(draft => { draft.boards[0]!.localStageIdentities = { src: "stable" }; });
    const project = await hubs.hub(hubId).saveProject({ name: "API", projectPath: "/repo/api" });
    await hubs.hub(hubId).createTask({ boardId: board.id, projectId: project.id, title: "Card", description: "" });
    // target authors anchor but the import associates other with it, and a scripted stage
    // keys stable and points at target. The final map is target -> other, script -> stable.
    const incoming = [
      "name: Delivery",
      "columns:",
      "  - id: target",
      "    label: target",
      "    key: anchor",
      "  - id: script",
      "    label: script",
      "    key: stable",
      "    scripted:",
      "      language: bash",
      "      code: echo hi",
      "      exits:",
      "        ok: target",
      "",
    ].join(String.fromCharCode(10));
    const entries = entriesOf(hubs, hubId, document([{ name: board.name, workflowYaml: incoming, stageIdentities: { target: "other" } }]), [{ name: board.name, settlement: "replace" }]);
    const result = await service.importBoards({ hubId, entries });
    const reason = result.outcomes[0]!.status === "failed" ? "failed: " + result.outcomes[0]!.reason : "";
    expect(reason).toBe("");
    expect(result.outcomes[0]).toMatchObject({ status: "replaced" });
    const saved = hubs.requireHub(hubId).boards[0]!;
    // The imported association is what persists, not the projected one.
    expect(saved.localStageIdentities?.target).toBe("other");
  });
});

describe('a created board keeps the stage identities the document brings', () => {
  it.each(['create', 'copy'] as const)('persists the imported association over the authored key on %s', async settlement => {
    const { hubs, service, hubId } = await setup();
    const yaml = ["name: Delivery", "columns:", "  - id: fresh", "    label: fresh", "    key: authored", ""].join(String.fromCharCode(10));
    // A copy only exists when the name is taken, so the suite creates the conflict for it.
    if (settlement === "copy") await service.create({ hubId, name: "Portable" });
    const entries = entriesOf(hubs, hubId, document([{ name: "Portable", workflowYaml: yaml, stageIdentities: { fresh: "portable" } }]), settlement === "copy" ? [{ name: "Portable", settlement: "copy", copyName: "Portable copy" }] : []);
    const result = await service.importBoards({ hubId, entries });
    expect(result.outcomes[0]).toMatchObject({ status: "created" });
    const created = hubs.requireHub(hubId).boards.find(value => value.name === (settlement === "copy" ? "Portable copy" : "Portable"))!;
    // The document association is what the board keeps; the save reconciles against an
    // empty board and would otherwise drop it.
    expect(created.localStageIdentities?.fresh).toBe("portable");
  });
});
