import { vi } from 'vitest';
import type { BoardState, ClientApi, Command, HubState, HubTask, KanbanSnapshot, KanbanState } from '../../src/shared/types.js';
import { taskTitleSlug, worktreePathForBranch } from '../../src/shared/worktree-name.js';
import { applyInitialEntry, applyMove, applyRunInstruction, createEnteredAtSource } from '../support/in-memory-board.js';

const FIXTURE_WORKFLOW_YAML = ['name: Delivery', 'initial_column: intake', 'columns:', '  - id: intake', '    label: Intake', '    allowed_transitions: [doing, review]', '  - id: doing', '    label: Doing', '  - id: review', '    label: Review', '    on_enter_prompt: |', '      Review **carefully**.', 'groups:', '  - id: plan', '    label: Planning', '    columns: [intake, review]', ''].join(String.fromCharCode(10));
export type TestSnapshot = KanbanSnapshot & { state: KanbanState & Omit<BoardState, 'settings'> & { settings: any } };
const workflow = { name: 'Delivery', initialColumnId: 'intake', columns: [{ id: 'intake', name: 'Intake', allowedTransitions: ['doing', 'review'] }, { id: 'doing', name: 'Doing' }, { id: 'review', name: 'Review', onEnterPrompt: 'Review **carefully**.' }], groups: [{ id: 'plan', name: 'Planning', columnIds: ['intake', 'review'] }] };
const now = '2026-10-21T12:00:00Z';

export function task(id: string, title: string, projectId: string, columnId: string): HubTask {
  return { id, boardId: 'board-1', title, description: 'Task description', projectId, columnId, position: 1, sessionIds: id === 't1' ? ['s1', 's2'] : ['s-beta'], closedSessionIds: [], effectiveCwd: projectId === 'p1' ? '/repo/apps/api' : '/web', worktree: null, operation: null, createdAt: '2026-10-21T12:00:00Z', updatedAt: '2026-10-21T12:00:00Z' };
}

function rawFixture(): KanbanSnapshot {
  const hub: HubState = {
    id: 'hub-1', name: 'My Hub', revision: 1,
    projects: [{ id: 'p1', name: 'API', projectPath: '/repo/apps/api', gitRootPath: '/repo', defaultBranch: 'main' }, { id: 'p2', name: 'Web', projectPath: '/web', gitRootPath: '/web', defaultBranch: 'main' }],
    boards: [{ id: 'board-1', name: 'Delivery', workflowYaml: FIXTURE_WORKFLOW_YAML, workflow: structuredClone(workflow), createdAt: now, updatedAt: now }],
    tasks: [task('t1', 'Alpha task', 'p1', 'intake'), { ...task('t2', 'Beta task', 'p2', 'doing'), description: 'Searchable documentation', worktree: { path: '/trees/beta', branch: 'beta', owned: true, status: 'ready' }, effectiveCwd: '/trees/beta' }],
    notes: [], createdAt: now, updatedAt: now,
  };
  return { sequence: 1, attention: { t1: { running: true, background: [{ kind: 'job', label: 'Run tests' }], unread: true, awaitingReply: true, failed: true } }, state: { hubs: [hub], settings: { revision: 1 } } };
}

/** Test-only legacy view over the first Hub and board. Production code reads state.hubs. */
export function withLegacyView(snapshot: KanbanSnapshot): TestSnapshot {
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
  const hub = () => state.hubs[0]!;
  const board = () => hub().boards[0]!;
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

export function fixture(): TestSnapshot { return withLegacyView(rawFixture()); }

/** A second instructed destination for replacement tests; kept out of the base fixture. */
export function fixtureWithPlan(): TestSnapshot {
  const value = fixture();
  value.state.hubs[0]!.boards[0]!.workflow.columns.push({ id: 'plan', name: 'Plan', onEnterPrompt: 'Plan this task.' });
  return value;
}
export function restrictedFixture(): TestSnapshot {
  const value = fixture();
  const board = value.state.hubs[0]!.boards[0]!;
  board.workflow.columns.push({ id: 'blocked', name: 'Blocked' });
  return value;
}
export function restrictedInstructedFixture(): TestSnapshot {
  const value = restrictedFixture();
  const board = value.state.hubs[0]!.boards[0]!;
  board.workflow.columns.find(column => column.id === 'blocked')!.onEnterPrompt = 'Blocked instruction.';
  return value;
}

function cloneSnapshot(value: KanbanSnapshot): KanbanSnapshot {
  const normalized = withLegacyView(value);
  return structuredClone({ sequence: normalized.sequence, attention: normalized.attention, state: { hubs: normalized.state.hubs, settings: normalized.state.settings ?? { revision: 0 } }, ...(normalized.questionRounds ? { questionRounds: normalized.questionRounds } : {}), ...(normalized.clientEpoch !== undefined ? { clientEpoch: normalized.clientEpoch } : {}) });
}

export function fakeApi(initial: TestSnapshot = fixture()) {
  let value = withLegacyView(cloneSnapshot(initial));
  const nextEnteredAt = createEnteredAtSource();
  delete (value as { commandReceipt?: unknown }).commandReceipt;
  let next = 3; const listeners = new Set<(snapshot: TestSnapshot) => void>();
  const publish = (snapshot?: KanbanSnapshot) => { if (snapshot) value = withLegacyView(cloneSnapshot(snapshot)); else { value.sequence++; value.state.revision++; } const result = withLegacyView(cloneSnapshot(value)); for (const listener of listeners) listener(result); return result; };
  const command = vi.fn(async (input: Command): Promise<KanbanSnapshot> => {
    const current = 'taskId' in input ? value.state.hubs.flatMap(hub => hub.tasks).find(item => item.id === input.taskId) : undefined;
    let receipt: KanbanSnapshot['commandReceipt'];
    switch (input.type) {
      case 'hub.create': { const hub: HubState = { id: 'hub-' + next++, name: input.name, revision: 0, projects: [], boards: [], tasks: [], notes: [], createdAt: now, updatedAt: now }; value.state.hubs.push(hub); receipt = { kind: 'hub', id: hub.id }; break; }
      case 'hub.rename': { const hub = value.state.hubs.find(item => item.id === input.hubId); if (hub) hub.name = input.name; break; }
      case 'hub.delete': value.state.hubs = value.state.hubs.filter(item => item.id !== input.hubId); break;
      case 'board.create': { const hub = value.state.hubs.find(item => item.id === input.hubId); if (hub) { const board = { id: 'board-' + next++, name: input.name, workflowYaml: FIXTURE_WORKFLOW_YAML, workflow: structuredClone(workflow), createdAt: now, updatedAt: now }; hub.boards.push(board); receipt = { kind: 'board', id: board.id }; } break; }
      case 'board.rename': { const hub = value.state.hubs.find(item => item.id === input.hubId); const board = hub?.boards.find(item => item.id === input.boardId); if (board) board.name = input.name; break; }
      case 'board.delete': { const hub = value.state.hubs.find(item => item.id === input.hubId); if (hub) hub.boards = hub.boards.filter(item => item.id !== input.boardId); break; }
      case 'board.workflow.save': { const hub = value.state.hubs.find(item => item.id === input.hubId); const board = hub?.boards.find(item => item.id === input.boardId); if (board) board.workflowYaml = input.yaml; break; }
      case 'task.create': { const hub = value.state.hubs[0]!; const board = hub.boards.find(item => item.id === (input.boardId ?? hub.boards[0]!.id))!; const id = 't' + next; const created = { ...task(id, input.title, input.projectId, board.workflow.initialColumnId), boardId: board.id, description: input.description, sessionIds: ['created-' + next++] }; const view: BoardState = { schemaVersion: 2, revision: hub.revision, workflowYaml: board.workflowYaml, workflow: board.workflow, projects: hub.projects, tasks: hub.tasks, notes: hub.notes }; applyInitialEntry(view, created, nextEnteredAt); hub.tasks.push(created); receipt = { kind: 'task', id }; break; }
      case 'task.edit': if (current) { if (input.title !== undefined) current.title = input.title; if (input.description !== undefined) current.description = input.description; } break;
      case 'task.move': if (current) { const hub = value.state.hubs.find(item => item.tasks.some(task => task.id === current.id)); const board = hub?.boards.find(item => item.id === current.boardId); if (hub && board) applyMove({ schemaVersion: 2, revision: hub.revision, workflowYaml: board.workflowYaml, workflow: board.workflow, projects: hub.projects, tasks: hub.tasks, notes: hub.notes }, input.taskId, input.columnId, input.beforeTaskId, nextEnteredAt); } break;
      case 'task.runInstruction': if (current) { const hub = value.state.hubs.find(item => item.tasks.some(task => task.id === current.id)); const board = hub?.boards.find(item => item.id === current.boardId); if (hub && board) { const result = applyRunInstruction({ schemaVersion: 2, revision: hub.revision, workflowYaml: board.workflowYaml, workflow: board.workflow, projects: hub.projects, tasks: hub.tasks, notes: hub.notes }, input); if (!result.ok) throw { code: result.code, message: result.message }; } } break;
      case 'conversation.create': if (current) { const id = 's' + next++; current.sessionIds.push(id); receipt = { kind: 'conversation', id }; } break;
      case 'conversation.close': current?.closedSessionIds.push(input.sessionId); break;
      case 'conversation.reopen': if (current) current.closedSessionIds = current.closedSessionIds.filter(id => id !== input.sessionId); break;
      case 'task.delete': value.state.tasks = value.state.tasks.filter(item => item.id !== input.taskId); value.state.notes = value.state.notes.filter(note => note.taskId !== input.taskId); break;
      case 'worktree.create': if (current) { current.worktree = { path: input.path, branch: input.branchName, owned: true, status: 'ready' }; current.effectiveCwd = input.path + '/apps/api'; } break;
      case 'worktree.attach': if (current) { current.worktree = { path: input.path, branch: 'external', owned: false, status: 'ready' }; current.effectiveCwd = input.path + '/apps/api'; } break;
      case 'worktree.remove': if (current) { current.worktree = null; current.effectiveCwd = value.state.projects.find(project => project.id === current.projectId)?.projectPath ?? ''; } break;
      case 'operation.retry': case 'operation.return': if (current) current.operation = null; break;
      case 'note.save': { const note = value.state.notes.find(item => item.id === input.noteId); if (note) note.content = input.content; else { const id = 'n' + next++; value.state.notes.push({ id, taskId: input.taskId, content: input.content, createdAt: 'now', updatedAt: 'now' }); receipt = { kind: 'note', id }; } break; }
      case 'workflow.save': value.state.workflowYaml = input.yaml; break;
      case 'project.save': { const hub = value.state.hubs.find(item => item.id === input.hubId) ?? value.state.hubs[0]!; const project = hub.projects.find(item => item.id === input.project.id); if (project) Object.assign(project, input.project); else { const id = 'p' + next++; hub.projects.push({ ...input.project, id }); receipt = { kind: 'project', id }; } break; }
      case 'project.delete': { const hub = value.state.hubs.find(item => item.id === input.hubId) ?? value.state.hubs[0]!; hub.projects = hub.projects.filter(project => project.id !== input.projectId); receipt = { kind: 'project', id: input.projectId }; break; }
      case 'settings.save': value.state.settings = { revision: value.state.settings.revision + 1, ...(input.settings.worktreeBasePath ? { worktreeBasePath: input.settings.worktreeBasePath } : {}) }; break;
    }
    const snapshot = publish();
    return receipt ? { ...snapshot, commandReceipt: receipt } : snapshot;
  });
  const worktreeDefault = vi.fn(async (taskId: string) => {
    const task = value.state.tasks.find(item => item.id === taskId);
    const branchName = task ? taskTitleSlug(task.title) : 'task';
    return { branchName, path: worktreePathForBranch(value.state.settings.worktreeBasePath, branchName) };
  });
  const api: ClientApi = { snapshot: vi.fn(async () => withLegacyView(cloneSnapshot(value))), command, branches: vi.fn(async () => ['main', 'feature']), worktreeDefault, detectProject: vi.fn(async (pathValue: string) => ({ kind: 'folder' as const, projectPath: pathValue })), subscribe: vi.fn(listener => { const wrapped = (snapshot: KanbanSnapshot) => listener(snapshot); listeners.add(wrapped as (snapshot: TestSnapshot) => void); return () => listeners.delete(wrapped as (snapshot: TestSnapshot) => void); }) };
  return { api, command, publish: (snapshot?: KanbanSnapshot) => publish(snapshot), get: () => withLegacyView(cloneSnapshot(value)), listeners };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}
