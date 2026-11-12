import { afterEach, describe, expect, it } from 'vitest';
import { BoardAdministration, type BoardSharingPort } from '../../src/host/board-administration.js';
import { HubRepository } from '../../src/host/hub-repository.js';
import { KanbanError } from '../../src/shared/errors.js';
import type { HubSharingView } from '../../src/shared/types.js';
import { MemoryHubStorage } from './helpers.js';

const NOW = '2026-11-08T00:00:00.000Z';
const FLOW = 'name: Custom\ninitial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n  - id: done\n    label: Done\n';

class FakeSharing implements BoardSharingPort {
  viewValue: HubSharingView | undefined;
  viewFailure: unknown;
  bound = new Set<string>();
  localChanges: string[] = [];
  removed: Array<{ hubId: string; boardId: string; scope: 'local' | 'team'; name: string }> = [];
  published: string[] = [];
  publishFailure: unknown;
  publishCheck: (() => void) | undefined;
  removeBoardFailure: unknown;

  view(): HubSharingView | undefined { if (this.viewFailure) throw this.viewFailure; return this.viewValue; }
  isBound(_hubId: string, boardId: string): boolean { return this.bound.has(boardId); }
  noteLocalChange(hubId: string): void { this.localChanges.push(hubId); }
  async publishBoard(_hubId: string, boardId: string): Promise<void> {
    this.publishCheck?.();
    this.published.push(boardId);
    if (this.publishFailure) throw this.publishFailure;
  }
  async publishAll(_hubId: string): Promise<void> {
    this.publishCheck?.();
    if (this.publishFailure) throw this.publishFailure;
  }
  async removeBoard(hubId: string, boardId: string, scope: 'local' | 'team', name: string): Promise<void> {
    this.removed.push({ hubId, boardId, scope, name });
    this.bound.delete(boardId);
    // Models HubSharingService.removeBoard, which notifies only for a team removal.
    if (scope === 'team') this.localChanges.push(hubId);
    if (this.removeBoardFailure) throw this.removeBoardFailure;
  }
}

function sharingView(overrides: Partial<HubSharingView> = {}): HubSharingView {
  return {
    status: 'published',
    provider: 'git',
    providerLabel: 'Git',
    supportsFiles: true,
    address: 'team/repo',
    intervalMinutes: 5,
    drafts: 0,
    updates: 0,
    conflicts: 0,
    syncing: false,
    boards: [],
    incoming: [],
    pendingRemovals: [],
    removed: [],
    blockers: [],
    ...overrides,
  };
}

const repositories: HubRepository[] = [];
afterEach(async () => {
  for (const repository of repositories.splice(0)) await repository.close();
});

async function setup(sharing?: FakeSharing, activity?: { inFlight: (hubId: string, boardId: string) => Promise<readonly string[]> }) {
  const storage = new MemoryHubStorage();
  let count = 0;
  const hubs = await HubRepository.open(storage, { id: () => 'test-' + (++count), now: () => NOW });
  repositories.push(hubs);
  const service = new BoardAdministration({ hubs, ...(sharing === undefined ? {} : { sharing }), ...(activity === undefined ? {} : { activity }) });
  return { hubs, service, storage, hubId: hubs.defaultHubId(), boardId: 'board' };
}

async function project(hubs: HubRepository, hubId: string): Promise<string> {
  const value = await hubs.hub(hubId).saveProject({ name: 'Project', projectPath: '/repos/project' });
  return value.id;
}

function expectCode(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error('Expected ' + code + '.');
}

describe('board administration reads', () => {
  it('returns the board and the Hub revision', async () => {
    const { service, hubId, boardId } = await setup();
    const value = service.read(boardId);
    expect(value).toMatchObject({ hubId, hubRevision: 0, board: { id: boardId, name: 'Kanban' } });
    expect(value.board.workflow.columns).toHaveLength(5);
  });

  it('rejects an unknown board or a board from another Hub', async () => {
    const { service } = await setup();
    expectCode(() => service.read('missing'), 'BOARD_NOT_FOUND');
    expectCode(() => service.read('board', 'other-hub'), 'HUB_NOT_FOUND');
  });
});

describe('board administration stage edits', () => {
  it('stores a stage edit and reports the local change on a bound board', async () => {
    const sharing = new FakeSharing();
    sharing.bound.add('board');
    const { service, hubId, boardId } = await setup(sharing);
    const value = await service.updateStage({ hubId, boardId, stageId: 'backlog', patch: { name: 'Queue' } });
    expect(value.board.workflow.columns[0]?.name).toBe('Queue');
    expect(sharing.localChanges).toEqual([hubId]);
    expect(sharing.published).toEqual([]);
  });

  it('refuses a rename while the activity port reports in-flight work', async () => {
    const { service, hubId, boardId } = await setup(undefined, { inFlight: async () => ['a running conversation'] });
    await expect(service.updateStage({ hubId, boardId, stageId: 'backlog', patch: { id: 'queue' } })).rejects.toMatchObject({ code: 'STAGE_RENAME_IN_FLIGHT' });
    expect(service.read(boardId).board.workflow.columns[0]?.id).toBe('backlog');
  });

  it('allows a rename when the activity port reports none', async () => {
    const { service, hubId, boardId } = await setup(undefined, { inFlight: async () => [] });
    const value = await service.updateStage({ hubId, boardId, stageId: 'backlog', patch: { id: 'queue' } });
    expect(value.board.workflow.columns[0]?.id).toBe('queue');
  });
});

describe('board administration create', () => {
  it('creates a board with the default workflow', async () => {
    const { service, hubId } = await setup();
    const value = await service.create({ hubId, name: 'Second' });
    expect(value.board).toMatchObject({ name: 'Second' });
    expect(value.board.workflow.columns.map(column => column.id)).toEqual(['backlog', 'plan', 'in_progress', 'in_review', 'done']);
    expect(value.hubRevision).toBe(1);
    expect(value.sharing).toEqual({ status: 'not-requested' });
  });

  it('creates a board with a supplied workflow', async () => {
    const { service, hubId } = await setup();
    const value = await service.create({ hubId, name: 'Custom', workflowYaml: FLOW });
    expect(value.board.workflowYaml).toBe(FLOW);
    expect(value.board.workflow.columns.map(column => column.id)).toEqual(['todo', 'done']);
  });

  it('rejects a duplicate board name without creating a board', async () => {
    const { hubs, service, hubId } = await setup();
    await expect(service.create({ hubId, name: 'Second' })).resolves.toBeDefined();
    await expect(service.create({ hubId, name: ' Second ' })).rejects.toMatchObject({ code: 'BOARD_NAME_CONFLICT' });
    expect(hubs.requireHub(hubId).boards).toHaveLength(2);
  });

  it('rejects an invalid workflow without creating a board', async () => {
    const { hubs, service, hubId } = await setup();
    await expect(service.create({ hubId, name: 'Broken', workflowYaml: 'columns: []' })).rejects.toMatchObject({ code: 'INVALID_WORKFLOW' });
    expect(hubs.requireHub(hubId).boards).toHaveLength(1);
  });
});

describe('board administration update', () => {
  it('renames a board without changing its workflow', async () => {
    const { service, boardId } = await setup();
    const before = service.read(boardId).board.workflowYaml;
    const value = await service.update({ boardId, name: 'Renamed' });
    expect(value.board.name).toBe('Renamed');
    expect(value.board.workflowYaml).toBe(before);
  });

  it('renames and replaces the workflow in one transaction', async () => {
    const { service, boardId } = await setup();
    const value = await service.update({ boardId, name: 'Renamed', workflowYaml: FLOW });
    expect(value.board.name).toBe('Renamed');
    expect(value.board.workflow.columns.map(column => column.id)).toEqual(['todo', 'done']);
  });

  it('rolls back the rename when the workflow is invalid', async () => {
    const { service, boardId } = await setup();
    await expect(service.update({ boardId, name: 'Renamed', workflowYaml: 'columns: []' })).rejects.toMatchObject({ code: 'INVALID_WORKFLOW' });
    expect(service.read(boardId).board.name).toBe('Kanban');
  });

  it('rejects an update without a name or workflow', async () => {
    const { service, boardId } = await setup();
    await expect(service.update({ boardId })).rejects.toMatchObject({ code: 'INVALID_EDIT' });
  });

  it('rejects a write for a Hub that does not exist', async () => {
    const { service, boardId } = await setup();
    await expect(service.update({ boardId, hubId: 'missing', name: 'No' })).rejects.toMatchObject({ code: 'HUB_NOT_FOUND' });
  });

  it('rejects a stale revision without changing the board', async () => {
    const { service, boardId } = await setup();
    await service.update({ boardId, name: 'First' });
    await expect(service.update({ boardId, name: 'Second', expectedRevision: 0 })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(service.read(boardId).board.name).toBe('First');
  });
});

describe('board administration workflow edits', () => {
  it('persists a valid partial edit', async () => {
    const { service, boardId } = await setup();
    const value = await service.editWorkflow({ boardId, edits: [{ old: '  - id: plan\n    label: Plan\n', new: '  - id: plan\n    label: Plan\n    on_enter_prompt: Plan first.\n' }] });
    expect(value.board.workflow.columns[1]?.onEnterPrompt).toBe('Plan first.');
  });

  it('leaves the board unchanged when an edit does not match', async () => {
    const { service, boardId } = await setup();
    const before = service.read(boardId).board;
    await expect(service.editWorkflow({ boardId, edits: [{ old: 'label: Missing', new: 'label: Other' }] })).rejects.toMatchObject({ code: 'WORKFLOW_EDIT_NOT_FOUND' });
    expect(service.read(boardId).board).toEqual(before);
  });

  it('leaves the board unchanged when an edit would orphan a task stage', async () => {
    const { hubs, service, hubId, boardId } = await setup();
    const projectId = await project(hubs, hubId);
    const task = await hubs.hub(hubId).createTask({ boardId, projectId, title: 'Task', description: '' });
    await hubs.hub(hubId).transact(draft => { draft.tasks.find(value => value.id === task.id)!.columnId = 'done'; });
    await expect(service.editWorkflow({ boardId, edits: [{ old: '  - id: done\n    label: Done\n', new: '' }] })).rejects.toMatchObject({ code: 'WORKFLOW_ORPHAN_COLUMNS' });
    expect(service.read(boardId).board.workflow.columns.map(column => column.id)).toContain('done');
  });

  it('rejects a stale revision without changing the workflow', async () => {
    const { service, boardId } = await setup();
    const before = service.read(boardId).board.workflowYaml;
    await service.update({ boardId, name: 'Renamed' });
    await expect(service.editWorkflow({ boardId, edits: [{ old: '    label: Done', new: '    label: Complete' }], expectedRevision: 0 })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(service.read(boardId).board.workflowYaml).toBe(before);
  });
});

describe('board administration removal', () => {
  it('requires explicit confirmation', async () => {
    const { service, boardId } = await setup();
    await expect(service.remove({ boardId, confirmed: false })).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
  });

  it('refuses a board that still contains tasks', async () => {
    const { hubs, service, hubId, boardId } = await setup();
    const projectId = await project(hubs, hubId);
    await hubs.hub(hubId).createTask({ boardId, projectId, title: 'Task', description: '' });
    await expect(service.remove({ boardId, confirmed: true })).rejects.toMatchObject({ code: 'BOARD_IN_USE' });
  });

  it('removes an empty unbound board', async () => {
    const { hubs, service, hubId, boardId } = await setup();
    const value = await service.remove({ boardId, confirmed: true });
    expect(value.board.id).toBe(boardId);
    expect(hubs.requireHub(hubId).boards).toHaveLength(0);
  });

  it('requires a scope for a bound board', async () => {
    const sharing = new FakeSharing();
    sharing.bound.add('board');
    const { service, boardId } = await setup(sharing);
    await expect(service.remove({ boardId, confirmed: true })).rejects.toMatchObject({ code: 'SHARING_SCOPE_REQUIRED' });
  });

  it('records a local-only removal without publishing', async () => {
    const sharing = new FakeSharing();
    sharing.bound.add('board');
    sharing.viewValue = sharingView();
    const { service, boardId } = await setup(sharing);
    const value = await service.remove({ boardId, confirmed: true, sharing: 'local' }, 'when-bound');
    expect(value.sharing).toEqual({ status: 'local-only' });
    expect(sharing.removed).toEqual([{ hubId: 'default', boardId, scope: 'local', name: 'Kanban' }]);
    expect(sharing.published).toEqual([]);
    expect(sharing.localChanges).toEqual([]);
  });

  it('records a team removal, which the sharing layer publishes as a removal event', async () => {
    const sharing = new FakeSharing();
    sharing.bound.add('board');
    sharing.viewValue = sharingView();
    const { service, boardId } = await setup(sharing);
    const value = await service.remove({ boardId, confirmed: true, sharing: 'team' }, 'when-bound');
    expect(value.sharing).toEqual({ status: 'published' });
    expect(sharing.removed[0]?.scope).toBe('team');
    // The sharing layer appends the removal event itself; no board write is published.
    expect(sharing.published).toEqual([]);
    expect(sharing.localChanges).toEqual(['default']);
  });

  it('keeps an unbound board removal local on a published Hub', async () => {
    const sharing = new FakeSharing();
    sharing.viewValue = sharingView();
    const { service, boardId } = await setup(sharing);
    const value = await service.remove({ boardId, confirmed: true }, 'when-bound');
    expect(value.sharing).toEqual({ status: 'local-only' });
    expect(sharing.published).toEqual([]);
    expect(sharing.localChanges).toEqual([]);
  });

  it('removes a team-owned board on a Drive binding', async () => {
    const sharing = new FakeSharing();
    sharing.bound.add('board');
    sharing.viewValue = sharingView({ provider: 'google-drive', providerLabel: 'Google Drive' });
    const { service, boardId } = await setup(sharing);
    const value = await service.remove({ boardId, confirmed: true, sharing: 'team' }, 'when-bound');
    expect(value.sharing).toEqual({ status: 'published' });
    expect(sharing.published).toEqual([]);
    expect(sharing.removed[0]?.scope).toBe('team');
  });

  it('never publishes a local-only removal', async () => {
    const sharing = new FakeSharing();
    sharing.bound.add('board');
    sharing.viewValue = sharingView({ provider: 'google-drive', providerLabel: 'Google Drive' });
    const { service, boardId } = await setup(sharing);
    const value = await service.remove({ boardId, confirmed: true, sharing: 'local' }, 'when-bound');
    expect(value.sharing).toEqual({ status: 'local-only' });
    expect(sharing.published).toEqual([]);
    expect(sharing.localChanges).toEqual([]);
  });

  it('removes a board for the team even when it is behind the team', async () => {
    const sharing = new FakeSharing();
    sharing.bound.add('board');
    sharing.viewValue = sharingView({ updates: 1, boards: [{ boardId: 'board', name: 'Kanban', state: 'updates-available', bound: true, draft: false }] });
    const { service, boardId } = await setup(sharing);
    const value = await service.remove({ boardId, confirmed: true, sharing: 'team' }, 'when-bound');
    // The removal event does not depend on what the board still owes the team.
    expect(value.sharing).toEqual({ status: 'published' });
    expect(value.board.id).toBe(boardId);
    expect(sharing.removed[0]?.scope).toBe('team');
  });

  it('reports a sharing bookkeeping failure after the board was removed', async () => {
    const sharing = new FakeSharing();
    sharing.bound.add('board');
    sharing.viewValue = sharingView();
    sharing.removeBoardFailure = new Error('Sharing store down.');
    const { hubs, service, boardId } = await setup(sharing);
    const value = await service.remove({ boardId, confirmed: true, sharing: 'team' }, 'when-bound');
    expect(value.board.id).toBe(boardId);
    expect(value.sharing).toMatchObject({ status: 'failed', error: { code: 'KANBAN_ERROR' } });
    expect(hubs.requireHub('default').boards).toHaveLength(0);
  });

  it('rejects a stale revision for a bound board without removing it', async () => {
    const sharing = new FakeSharing();
    sharing.bound.add('board');
    sharing.viewValue = sharingView();
    const { service, boardId } = await setup(sharing);
    await service.update({ boardId, name: 'First' });
    await expect(service.remove({ boardId, confirmed: true, sharing: 'local', expectedRevision: 0 })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(sharing.removed).toEqual([]);
  });
});

describe('board administration publishing policy', () => {
  it('reports an unbound Hub', async () => {
    const { service, hubId } = await setup();
    const value = await service.create({ hubId, name: 'Unbound' }, 'when-bound');
    expect(value.sharing).toEqual({ status: 'not-bound' });
  });

  it('reports a Hub awaiting connection review', async () => {
    const sharing = new FakeSharing();
    sharing.viewValue = sharingView({ status: 'preview' });
    const { service, hubId } = await setup(sharing);
    const value = await service.create({ hubId, name: 'Preview' }, 'when-bound');
    expect(value.sharing).toEqual({ status: 'preview' });
    expect(sharing.published).toEqual([]);
  });

  it('saves the local board before publishing', async () => {
    const sharing = new FakeSharing();
    sharing.viewValue = sharingView();
    const { hubs, service, hubId } = await setup(sharing);
    let seen: string[] = [];
    sharing.publishCheck = () => { seen = hubs.requireHub(hubId).boards.map(board => board.name); };
    await service.create({ hubId, name: 'Published' }, 'when-bound');
    expect(seen).toContain('Published');
  });

  it('publishes after create, update, and edit on an explicit binding', async () => {
    const sharing = new FakeSharing();
    sharing.viewValue = sharingView();
    const { service, hubId, boardId } = await setup(sharing);
    await service.create({ hubId, name: 'Second' }, 'when-bound');
    await service.update({ boardId, name: 'Renamed' }, 'when-bound');
    await service.editWorkflow({ boardId, edits: [{ old: '    label: Done', new: '    label: Complete' }] }, 'when-bound');
    // Each write publishes its own board: the created one, then the edited one twice.
    expect(sharing.published).toEqual([expect.any(String), boardId, boardId]);
  });

  it('blocks only the board that needs a review', async () => {
    const sharing = new FakeSharing();
    const { service, hubId, boardId } = await setup(sharing);
    // Another board's review does not stop this board from publishing.
    sharing.viewValue = sharingView({ provider: 'google-drive', providerLabel: 'Google Drive', conflicts: 1, boards: [{ boardId: 'other', name: 'Other', state: 'needs-review', bound: true, draft: false }] });
    await expect(service.create({ hubId, name: 'Conflicted' }, 'when-bound')).resolves.toMatchObject({ sharing: { status: 'published' } });
    expect(sharing.published).toHaveLength(1);
    sharing.viewValue = sharingView({ provider: 'google-drive', providerLabel: 'Google Drive', conflicts: 1, boards: [{ boardId, name: 'Kanban', state: 'needs-review', bound: true, draft: false }] });
    await expect(service.update({ boardId, name: 'Renamed' }, 'when-bound')).resolves.toMatchObject({ sharing: { status: 'blocked' } });
    expect(sharing.published).toHaveLength(1);
  });

  it('reports a blocked publish without rolling back the local write', async () => {
    const sharing = new FakeSharing();
    const { service, hubId, boardId } = await setup(sharing);
    sharing.viewValue = sharingView({ updates: 2, boards: [{ boardId: 'board', name: 'Kanban', state: 'updates-available', bound: true, draft: false }] });
    const value = await service.update({ boardId, name: 'Renamed' }, 'when-bound');
    expect(value.board.name).toBe('Renamed');
    expect(value.sharing).toMatchObject({ status: 'blocked' });
    expect(sharing.published).toEqual([]);
  });

  it('reports blockers and an unavailable storage as blocked', async () => {
    const sharing = new FakeSharing();
    const { service, hubId, boardId } = await setup(sharing);
    sharing.viewValue = sharingView({ blockers: [{ code: 'SHARING_BLOCKER', message: 'A blocker.' }] });
    await expect(service.update({ boardId, name: 'Two' }, 'when-bound')).resolves.toMatchObject({ sharing: { status: 'blocked', reason: 'A blocker.' } });
    sharing.viewValue = sharingView({ status: 'unavailable', error: { code: 'NETWORK', message: 'Offline.' } });
    await expect(service.update({ boardId, name: 'Three' }, 'when-bound')).resolves.toMatchObject({ sharing: { status: 'blocked', error: { code: 'NETWORK' } } });
  });

  it('reports a sharing view failure without rolling back the local write', async () => {
    const sharing = new FakeSharing();
    sharing.viewValue = sharingView();
    sharing.viewFailure = new Error('View unavailable.');
    const { service, hubId } = await setup(sharing);
    const value = await service.create({ hubId, name: 'Saved' }, 'when-bound');
    expect(value.board.name).toBe('Saved');
    expect(value.sharing).toMatchObject({ status: 'failed', error: { code: 'KANBAN_ERROR' } });
  });

  it('reports a publish refusal as blocked and a publish error as failed', async () => {
    const sharing = new FakeSharing();
    sharing.viewValue = sharingView();
    const { service, hubId } = await setup(sharing);
    sharing.publishFailure = new KanbanError('SHARING_PUBLISH_BLOCKED', 'Get the team updates first.');
    await expect(service.create({ hubId, name: 'Blocked' }, 'when-bound')).resolves.toMatchObject({ sharing: { status: 'blocked' } });
    sharing.publishFailure = new Error('Network down.');
    await expect(service.create({ hubId, name: 'Failed' }, 'when-bound')).resolves.toMatchObject({ sharing: { status: 'failed', error: { code: 'KANBAN_ERROR' } } });
  });

  it('keeps the UI command path on the explicit publishing policy', async () => {
    const sharing = new FakeSharing();
    sharing.viewValue = sharingView();
    const { service, hubId } = await setup(sharing);
    const value = await service.create({ hubId, name: 'Command' });
    expect(value.sharing).toEqual({ status: 'not-requested' });
    expect(sharing.published).toEqual([]);
  });
});
