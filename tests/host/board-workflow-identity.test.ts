import { describe, expect, it } from 'vitest';
import { defaultHubState } from '../../src/domain/hub-schema.js';
import { HubRepository } from '../../src/host/hub-repository.js';
import { MemoryHubStorage } from './helpers.js';

const NOW = '2026-01-01T00:00:00.000Z';
const NL = String.fromCharCode(10);
const KEYED = ['name: Flow', 'initial_column: backlog', 'columns:', '  - id: backlog', '    key: s1', '    label: Backlog', '  - id: done', '    key: s2', '    label: Done', ''].join(NL);

async function fixture() {
  const storage = new MemoryHubStorage();
  storage.hubs.set('hub', defaultHubState('hub', 'Hub', 'board', 'Board', NOW));
  const hubs = await HubRepository.open(storage, { id: () => 'generated', now: () => NOW });
  await hubs.hub('hub').saveBoardWorkflow('board', KEYED);
  return { hubs, close: () => hubs.close() };
}

function keys(hubs: HubRepository): Array<string | undefined> {
  return hubs.requireHub('hub').boards[0]!.workflow.columns.map(column => column.key);
}

describe('board workflow identity survives every write path', () => {
  it('keeps the identity of every stage across a whole-workflow save', async () => {
    const f = await fixture();
    const replaced = KEYED.replace('    label: Backlog', '    label: Inbox');
    await f.hubs.hub('hub').saveBoardWorkflow('board', replaced);
    expect(keys(f.hubs)).toEqual(['s1', 's2']);
    expect(f.hubs.requireHub('hub').boards[0]!.workflow.columns[0]?.name).toBe('Inbox');
    await f.close();
  });

  it('keeps the identity of every stage across a literal workflow edit', async () => {
    const f = await fixture();
    await f.hubs.hub('hub').editBoardWorkflow('board', [{ old: '    label: Done', new: '    label: Finished' }]);
    expect(keys(f.hubs)).toEqual(['s1', 's2']);
    expect(f.hubs.requireHub('hub').boards[0]!.workflow.columns[1]?.name).toBe('Finished');
    await f.close();
  });

  it('keeps the identity of a stage renamed through a whole-workflow save', async () => {
    const f = await fixture();
    await f.hubs.hub('hub').saveBoardWorkflow('board', KEYED.split(NL).map(line => (line === '  - id: backlog' ? '  - id: inbox' : line === 'initial_column: backlog' ? 'initial_column: inbox' : line)).join(NL));
    expect(keys(f.hubs)).toEqual(['s1', 's2']);
    expect(f.hubs.requireHub('hub').boards[0]!.workflow.columns[0]?.id).toBe('inbox');
    await f.close();
  });
});
