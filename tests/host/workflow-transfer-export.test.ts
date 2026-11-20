import { describe, expect, it } from 'vitest';
import { HubRepository } from '../../src/host/hub-repository.js';
import { MemoryHubStorage } from './helpers.js';
import { decodeTransferDocument } from '../../src/host/workflow-transfer/archive.js';
import { exportBoards, exportDocument } from '../../src/host/workflow-transfer/export.js';
import { createBoard } from '../../src/domain/hub-schema.js';
import type { Board, HubState } from '../../src/shared/types.js';
import { parseWorkflow } from '../../src/domain/workflow.js';

const workflow = (columns: Array<{ id: string; key?: string }> = [{ id: 'todo' }]): string =>
  ['name: Delivery', 'columns:', ...columns.flatMap(column => ['  - id: ' + column.id, '    label: ' + column.id, ...(column.key === undefined ? [] : ['    key: ' + column.key])]), ''].join(String.fromCharCode(10));

async function openHub(boards: Array<Partial<Board> & { name: string }>, projects: string[] = []): Promise<{ hubs: HubRepository; hubId: string; storage: MemoryHubStorage }> {
  const storage = new MemoryHubStorage();
  const hubs = await HubRepository.open(storage);
  const created = await hubs.createHub('Team Hub');
  for (const key of projects) await hubs.hub(created.id).saveProject({ name: key.toUpperCase(), projectPath: '/repo/' + key, projectKey: key });
  for (const board of boards) {
    await hubs.hub(created.id).transact(draft => {
      const value = createBoard('board-' + board.name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-'), board.name, '2026-11-20T10:00:00.000Z', board.workflowYaml ?? workflow());
      Object.assign(value, board);
      draft.boards.push(value);
      return draft;
    });
  }
  return { hubs, hubId: created.id, storage };
}

describe('export', () => {
  it('exports exactly the chosen subset', async () => {
    const { hubs, hubId } = await openHub([{ name: 'One' }, { name: 'Two' }, { name: 'Three' }]);
    const chosen = hubs.requireHub(hubId).boards.filter(board => board.name !== 'Two').map(board => board.id);
    const result = exportBoards(hubs, { hubId, boardIds: chosen });
    expect(result.boardCount).toBe(2);
    const parsed = decodeTransferDocument(Buffer.from(result.archive, 'base64'));
    expect(parsed.boards.map(board => board.name)).toEqual(['One', 'Three']);
  });

  it('carries name, authored yaml, preset, scope, and identities', async () => {
    const { hubs, hubId } = await openHub([{ name: 'One', workflowYaml: workflow([{ id: 'todo', key: 'identity-todo' }]), defaultPresetMode: 'host', allowedProjectKeys: ['api'] }], ['api']);
    const board = hubs.requireHub(hubId).boards[0]!;
    const result = exportBoards(hubs, { hubId, boardIds: [board.id] });
    const parsed = decodeTransferDocument(Buffer.from(result.archive, 'base64'));
    expect(parsed.boards[0]).toMatchObject({ name: 'One', workflowYaml: board.workflowYaml, presetMode: 'host', projectKeys: ['api'], stageIdentities: { todo: 'identity-todo' } });
  });

  it('refuses an empty selection', async () => {
    const { hubs, hubId } = await openHub([{ name: 'One' }]);
    expect(() => exportBoards(hubs, { hubId, boardIds: [] })).toThrowError(/at least one board/i);
  });

  it('refuses a board that is not in the Hub', async () => {
    const { hubs, hubId } = await openHub([{ name: 'One' }]);
    expect(() => exportBoards(hubs, { hubId, boardIds: ['missing'] })).toThrowError(/does not exist/i);
  });

  it('reports an advisory for a scripted stage reading an external file', async () => {
    const withScript = ['name: Delivery', 'columns:', '  - id: todo', '    label: To do', '    scripted:', '      language: bash', '      file: ./scripts/run.sh', '      exits:', '        next: done', '  - id: done', '    label: Done', ''].join(String.fromCharCode(10));
    const { hubs, hubId } = await openHub([{ name: 'Scripted', workflowYaml: withScript }, { name: 'Plain' }]);
    const boards = hubs.requireHub(hubId).boards;
    const result = exportBoards(hubs, { hubId, boardIds: boards.map(board => board.id) });
    expect(result.advisories).toEqual([{ boardName: 'Scripted', reason: 'external-script-source', detail: 'To do reads ./scripts/run.sh' }]);
  });

  it('changes nothing in the Hub', async () => {
    const { hubs, hubId } = await openHub([{ name: 'One' }, { name: 'Two' }]);
    const before = structuredClone(hubs.requireHub(hubId));
    exportBoards(hubs, { hubId, boardIds: hubs.requireHub(hubId).boards.map(board => board.id) });
    const after = hubs.requireHub(hubId);
    expect(after.revision).toBe(before.revision);
    expect(after.boards.map(board => board.workflowYaml)).toEqual(before.boards.map(board => board.workflowYaml));
  });

  it('follows Hub order rather than the selection order', async () => {
    const { hubs, hubId } = await openHub([{ name: 'First' }, { name: 'Second' }]);
    const boards = hubs.requireHub(hubId).boards;
    const forward = exportBoards(hubs, { hubId, boardIds: boards.map(board => board.id) });
    const reversed = exportBoards(hubs, { hubId, boardIds: boards.map(board => board.id).reverse() });
    expect(reversed.archive).toBe(forward.archive);
  });

  it('builds the same document twice from an unchanged Hub', async () => {
    const { hubs, hubId } = await openHub([{ name: 'One' }]);
    const hub = hubs.requireHub(hubId) as HubState;
    const boardIds = hub.boards.map(board => board.id);
    expect(JSON.stringify(exportDocument(hub, boardIds))).toBe(JSON.stringify(exportDocument(hub, boardIds)));
  });

  it('names the file after the Hub and the date', async () => {
    const { hubs, hubId } = await openHub([{ name: 'One' }]);
    const result = exportBoards(hubs, { hubId, boardIds: hubs.requireHub(hubId).boards.map(board => board.id) }, new Date('2026-11-20T10:00:00.000Z'));
    expect(result.fileName).toBe('kanban-workflows-team-hub-2026-11-20.json.gz');
  });

  it('keeps the authored workflow text character for character', async () => {
    const commented = ['# a comment', 'name: Delivery', 'columns:', '  - id: todo', '    label: "To do"', ''].join(String.fromCharCode(10));
    const { hubs, hubId } = await openHub([{ name: 'One', workflowYaml: commented }]);
    const board = hubs.requireHub(hubId).boards[0]!;
    const result = exportBoards(hubs, { hubId, boardIds: [board.id] });
    expect(decodeTransferDocument(Buffer.from(result.archive, 'base64')).boards[0]!.workflowYaml).toBe(commented);
  });
});

void parseWorkflow;
