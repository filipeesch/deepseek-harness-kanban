import type { BoardState, ClientApi, Command, HubState, HubTask, KanbanSnapshot, KanbanState } from '../../src/shared/types.js';
import { taskTitleSlug, worktreePathForBranch } from '../../src/shared/worktree-name.js';

export interface HarnessApi {
  api: ClientApi;
  snapshot(): TestSnapshot;
  commands(): readonly Command[];
}
export type TestSnapshot = KanbanSnapshot & { state: KanbanState & Omit<BoardState, 'settings'> & { settings: any } };

export interface HarnessOptions { attention?: boolean; hubs?: number }

const now = '2026-10-21T00:00:00Z';

function task(id: string, title: string, columnId: string, position: number): HubTask {
  return { id, boardId: 'board', projectId: 'p', title, description: 'Harness task', columnId, position, sessionIds: ['s-' + id], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null, createdAt: '', updatedAt: '' };
}

export function createHarnessApi(options: HarnessOptions = {}): HarnessApi {
  const tasks: HubTask[] = [
    ...Array.from({ length: 12 }, (_, index) => task('long-' + index, 'Long column task ' + index, 'explore', index)),
    task('short', 'Short task', 'propose', 40),
    task('other', 'Other task', 'apply', 41),
    deleteTarget(),
    failedDelete(),
    failedDeleteReturn(),
  ];
  const attention: KanbanSnapshot['attention'] = options.attention ? {
    'long-0': { running: true, background: [], unread: false, awaitingReply: false, failed: false },
    'long-1': { running: false, background: [{ kind: 'job', label: 'Run tests' }], unread: false, awaitingReply: false, failed: false },
    'long-2': { running: true, background: [{ kind: 'subagent', label: 'Research' }], unread: false, awaitingReply: false, failed: false },
  } : {};
  const hub: HubState = {
    id: 'hub', name: 'Harness Hub', revision: 1,
    projects: [{ id: 'p', name: 'Project', projectPath: '/repo', gitRootPath: '/repo', defaultBranch: 'main' }],
    boards: [{ id: 'board', name: 'Harness board', workflowYaml: workflowYaml(), workflow: { name: 'Harness flow', initialColumnId: 'explore', columns: [{ id: 'explore', name: 'Explore' }, { id: 'propose', name: 'Propose' }, { id: 'apply', name: 'Apply' }], groups: [{ id: 'planning', name: 'Planning', columnIds: ['explore', 'propose'] }] }, createdAt: now, updatedAt: now }],
    tasks, notes: [], createdAt: now, updatedAt: now,
  };
  const settings = { revision: 1, worktreeBasePath: '/worktrees' };
  const raw: KanbanSnapshot = { sequence: 1, attention, state: { hubs: [hub], settings } };
  let value = withLegacy(raw);
  if ((options.hubs ?? 1) > 1) value.state.hubs.push({ id: 'hub-2', name: 'Second Hub', revision: 0, projects: [], boards: [], tasks: [], notes: [], createdAt: now, updatedAt: now });
  const listeners = new Set<(snapshot: TestSnapshot) => void>();
  const commands: Command[] = [];
  const publish = () => { value = withLegacy(clone(value)); value.sequence++; for (const listener of listeners) listener(withLegacy(clone(value))); return withLegacy(clone(value)); };
  const api: ClientApi = {
    snapshot: async () => withLegacy(clone(value)),
    command: async (command: Command) => {
      commands.push(structuredClone(command));
      const firstHub = value.state.hubs[0]!; const firstBoard = firstHub.boards[0]!;
      let receipt: KanbanSnapshot['commandReceipt'];
      if (command.type === 'board.workflow.save') { const hub = value.state.hubs.find(item => item.id === command.hubId); const board = hub?.boards.find(item => item.id === command.boardId); if (board) { board.workflowYaml = command.yaml; if (hub) hub.revision += 1; } }
      if (command.type === 'workflow.save') { firstBoard.workflowYaml = command.yaml; firstHub.revision += 1; }
      if (command.type === 'worktree.create') { const task = firstHub.tasks.find(item => item.id === command.taskId); if (task) { task.worktree = { path: command.path, branch: command.branchName, owned: true, status: 'ready' }; task.effectiveCwd = command.path; } }
      if (command.type === 'board.create') { const hub = value.state.hubs.find(item => item.id === command.hubId); if (hub) { const board = { id: 'board-' + (commands.length + 1), name: command.name, workflowYaml: workflowYaml(), workflow: structuredClone(firstBoard.workflow), createdAt: now, updatedAt: now }; hub.boards.push(board); receipt = { kind: 'board', id: board.id }; } }
      if (command.type === 'hub.create') { const created: HubState = { id: 'hub-' + (commands.length + 1), name: command.name, revision: 0, projects: [], boards: [], tasks: [], notes: [], createdAt: now, updatedAt: now }; value.state.hubs.push(created); receipt = { kind: 'hub', id: created.id }; }
      const snapshot = publish();
      return receipt ? { ...snapshot, commandReceipt: receipt } : snapshot;
    },
    branches: async () => ['main', 'feature'],
    worktreeDefault: async taskId => { const task = value.state.hubs[0]!.tasks.find(item => item.id === taskId); const branchName = taskTitleSlug(task?.title ?? 'task'); return { branchName, path: worktreePathForBranch(value.state.settings.worktreeBasePath, branchName) }; },
    inferProject: async pathValue => ({ projectPath: pathValue, gitRootPath: pathValue }),
    subscribe: listener => { const wrapped = (snapshot: TestSnapshot) => listener(snapshot); listeners.add(wrapped); return () => listeners.delete(wrapped); },
  };
  return { api, snapshot: () => withLegacy(clone(value)), commands: () => structuredClone(commands) };
}

export function workflowYaml(): string {
  return ['name: Harness flow', 'initial_column: explore', 'columns:', '  - id: explore', '    label: Explore', '  - id: propose', '    label: Propose', '  - id: apply', '    label: Apply', 'groups:', '  - id: planning', '    label: Planning', '    columns: [explore, propose]', ''].join(String.fromCharCode(10));
}

function clone(value: KanbanSnapshot): KanbanSnapshot { const normalized = withLegacy(value); return structuredClone({ sequence: normalized.sequence, attention: normalized.attention, state: { hubs: normalized.state.hubs, settings: normalized.state.settings ?? { revision: 0 } } }); }
function withLegacy(snapshot: KanbanSnapshot): TestSnapshot {
  const state = { hubs: snapshot.state.hubs } as KanbanState & Omit<BoardState, 'settings'> & { settings: any };
  let settingsValue = structuredClone(snapshot.state.settings);
  const rawState = snapshot.state as unknown as Record<string, unknown>;
  const firstHub = state.hubs[0]; const firstBoard = firstHub?.boards[0];
  if (firstHub && firstBoard) {
    if (Object.prototype.hasOwnProperty.call(rawState, 'tasks') && Array.isArray(rawState.tasks)) firstHub.tasks = rawState.tasks as HubState['tasks'];
    if (Object.prototype.hasOwnProperty.call(rawState, 'projects') && Array.isArray(rawState.projects)) firstHub.projects = rawState.projects as HubState['projects'];
    if (Object.prototype.hasOwnProperty.call(rawState, 'notes') && Array.isArray(rawState.notes)) firstHub.notes = rawState.notes as HubState['notes'];
    if (Object.prototype.hasOwnProperty.call(rawState, 'revision') && typeof rawState.revision === 'number') firstHub.revision = rawState.revision;
    if (Object.prototype.hasOwnProperty.call(rawState, 'workflowYaml') && typeof rawState.workflowYaml === 'string') firstBoard.workflowYaml = rawState.workflowYaml;
    if (Object.prototype.hasOwnProperty.call(rawState, 'workflow') && rawState.workflow) firstBoard.workflow = rawState.workflow as BoardState['workflow'];
  }
  const hub = () => state.hubs[0]!; const board = () => hub().boards[0]!;
  Object.defineProperties(state, {
    schemaVersion: { get: () => 2, configurable: true },
    revision: { get: () => hub().revision, set: (value: number) => { hub().revision = value; }, configurable: true },
    workflowYaml: { get: () => board().workflowYaml, set: (value: string) => { board().workflowYaml = value; }, configurable: true },
    workflow: { get: () => board().workflow, set: (value: BoardState['workflow']) => { board().workflow = value; }, configurable: true },
    projects: { get: () => hub().projects, set: (value: BoardState['projects']) => { hub().projects = value; }, configurable: true },
    tasks: { get: () => hub().tasks, set: (value: BoardState['tasks']) => { hub().tasks = value as HubState['tasks']; }, configurable: true },
    notes: { get: () => hub().notes, set: (value: BoardState['notes']) => { hub().notes = value; }, configurable: true },
    settings: { get: () => settingsValue, set: (value: Partial<KanbanState['settings']> & { worktreeBasePath?: string } | undefined) => { if (!value) { settingsValue = { revision: settingsValue.revision }; return; } settingsValue = ('revision' in value ? { revision: value.revision ?? 0, ...(value.worktreeBasePath ? { worktreeBasePath: value.worktreeBasePath } : {}) } : { ...settingsValue, ...value }) as KanbanState['settings']; }, configurable: true },
  });
  return { ...snapshot, state };
}

function deleteTarget(): HubTask {
  return { ...task('delete-target', 'Delete target', 'propose', 42), sessionIds: ['s-delete-target-1', 's-delete-target-2'], effectiveCwd: '/worktrees/delete-target', worktree: { path: '/worktrees/delete-target', branch: 'delete-target', owned: true, status: 'ready' }, unclaimedWorktrees: [{ path: '/manual/delete-checkout', branch: 'manual', error: { code: 'DETACHED', message: 'Detached checkout.' } }] };
}
function failedDeleteReturn(): HubTask {
  const value = failedDelete();
  return { ...value, id: 'failed-delete-return', title: 'Failed return', position: 44, sessionIds: ['s-failed-delete-return'], operation: { ...value.operation!, id: 'failed-delete-return-op', archivedSessionIds: [], error: { code: 'SHARED_WORKTREE', message: 'Another DSH conversation is using this checkout.', details: { sessionId: 'child', path: '/worktrees/failed-delete', failedPhase: 'preflight' } } } };
}
function failedDelete(): HubTask {
  return { ...task('failed-delete', 'Failed delete', 'apply', 43), effectiveCwd: '/worktrees/failed-delete', worktree: { path: '/worktrees/failed-delete', branch: 'failed-delete', owned: true, status: 'ready' }, operation: { id: 'failed-delete-op', request: { kind: 'delete', discardChanges: false, expectedWorktreePath: '/worktrees/failed-delete' }, phase: 'failed', targetPath: '/worktrees/failed-delete', previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: ['s-failed-delete'], gitCompleted: true, createdAt: 'now', error: { code: 'SHARED_WORKTREE', message: 'Another DSH conversation is using this checkout.', details: { sessionId: 'child', path: '/worktrees/failed-delete', failedPhase: 'archiving' } } } };
}
