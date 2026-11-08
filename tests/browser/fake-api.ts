import type { BoardState, ClientApi, Command, DriveBrowseView, DriveDiscoveryView, HubSharingView, HubState, HubTask, KanbanSnapshot, KanbanState, LocalDriveRequest, LocalDriveResult, Note, SharingCommand } from '../../src/shared/types.js';
import { NO_PENDING_USER_WORK } from '../../src/shared/types.js';
import { pendingUserWork } from '../../src/domain/pending-user-work.js';
import { taskTitleSlug, worktreePathForBranch } from '../../src/shared/worktree-name.js';
import { applyMove, applyRunInstruction, createEnteredAtSource } from '../support/in-memory-board.js';

export interface HarnessApi {
  api: ClientApi;
  snapshot(): TestSnapshot;
  commands(): readonly Command[];
  sharingCommands(): readonly SharingCommand[];
}
export type TestSnapshot = KanbanSnapshot & { state: KanbanState & Omit<BoardState, 'settings'> & { settings: any } };

export interface HarnessOptions { attention?: boolean; hubs?: number; restricted?: boolean; runFailure?: boolean; persist?: boolean; pending?: boolean; auto?: boolean; detect?: 'git' | 'folder'; prepare?: 'plain' | 'restricted'; notes?: boolean; sharing?: Record<string, HubSharingView>; shareFailure?: boolean; shareRefusal?: boolean; folderRefusal?: boolean; retained?: Array<{ path: string; projectId: string; taskTitle: string }>; relocation?: Array<'waiting' | 'failed' | null>; extraProject?: boolean; drive?: 'ready' | 'empty' | 'app-missing' | 'unsupported' | 'error' }

const now = '2026-10-21T00:00:00Z';

function task(id: string, title: string, columnId: string, position: number): HubTask {
  return { id, boardId: 'board', projectId: 'p', title, description: 'Harness task', columnId, position, sessionIds: ['s-' + id], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null, createdAt: '', updatedAt: '' };
}

export function createHarnessApi(options: HarnessOptions = {}): HarnessApi {
  const nextEnteredAt = createEnteredAtSource();
  const closedConversationTask = task('closed', 'Closed conversation task', 'apply', 42);
  closedConversationTask.sessionIds = ['s-closed', ...Array.from({ length: 11 }, (_, index) => 's-closed-hidden-' + index)];
  closedConversationTask.closedSessionIds = closedConversationTask.sessionIds.slice(1);
  const tasks: HubTask[] = [
    ...Array.from({ length: 12 }, (_, index) => task('long-' + index, 'Long column task ' + index, 'explore', index)),
    task('short', 'Short task', 'propose', 40),
    task('other', 'Other task', 'apply', 41),
    closedConversationTask,
    longTitleTask(),
    deleteTarget(),
    failedDelete(),
    failedDeleteReturn(),
    ...(options.prepare === undefined ? [] : [firstExecutionTask(), blockedBindingTask()]),
  ];
  const attention: KanbanSnapshot['attention'] = options.attention ? {
    'long-0': { running: true, background: [], unread: false, awaitingReply: false, failed: false, pending: NO_PENDING_USER_WORK },
    'long-1': { running: false, background: [{ kind: 'job', label: 'Run tests' }], unread: false, awaitingReply: false, failed: false, pending: NO_PENDING_USER_WORK },
    'long-2': { running: true, background: [{ kind: 'schedule', label: 'Wake later' }], unread: false, awaitingReply: false, failed: false, pending: NO_PENDING_USER_WORK },
    'long-3': { running: false, background: [{ kind: 'job', label: 'Run tests' }, { kind: 'schedule', label: 'Wake later' }], unread: true, awaitingReply: true, failed: true, pending: NO_PENDING_USER_WORK },
  } : {};
  const conversationAttention: KanbanSnapshot['conversationAttention'] = options.attention ? {
    's-long-0': attention['long-0']!, 's-long-1': attention['long-1']!, 's-long-2': { running: true, background: [{ kind: 'schedule', label: 'Wake later' }], unread: false, awaitingReply: false, failed: false, pending: NO_PENDING_USER_WORK }, 's-long-3': attention['long-3']!,
  } : {};
  // The auto-mode scenario also holds one task on pending user work, so the chip's
  // held state is exercised against the real components. The control reads the
  // task-level attention, which the host aggregates from every conversation.
  if (options.auto) {
    const held: KanbanSnapshot['attention'][string] = { running: false, background: [], unread: false, awaitingReply: false, failed: false, pending: pendingUserWork(['queued-prompt'], 1) };
    attention['other'] = held;
    conversationAttention['s-other'] = held;
  }
  const shortTask = tasks.find(value => value.id === 'short')!;
  if (options.pending) shortTask.pendingTransition = { id: 'pending-short', fromColumnId: 'propose', columnId: 'apply', mode: 'move', status: 'waiting' };
  if (options.auto) {
    tasks.find(value => value.id === 'long-0')!.autoMode = { enabled: true };
    tasks.find(value => value.id === 'other')!.autoMode = { enabled: true };
    tasks.find(value => value.id === 'long-1')!.autoMode = { enabled: true, pause: { reason: 'turn-error', at: now } };
    const failed = tasks.find(value => value.id === 'long-2')!;
    failed.autoMode = { enabled: true };
    failed.pendingTransition = { id: 'auto-failed', fromColumnId: 'explore', columnId: 'propose', mode: 'run', text: 'Plan this task.', sessionId: 's-long-2', status: 'failed', origin: 'auto', error: { code: 'SEND_FAILED', message: 'The instruction could not be sent.' } };
    shortTask.autoMode = { enabled: true };
    shortTask.pendingTransition = { id: 'auto-short', fromColumnId: 'propose', columnId: 'apply', mode: 'run', text: 'Plan this task.', sessionId: 's-short', status: 'waiting', origin: 'auto' };
  }
  const hub: HubState = {
    id: 'hub', name: 'Harness Hub', revision: 1,
    projects: [
      { id: 'p', name: 'Project', projectPath: '/repo', gitRootPath: '/repo', defaultBranch: 'main' },
      { id: 'p2', name: 'A very long project name that must truncate inside the card', projectPath: '/repo/long', gitRootPath: '/repo', defaultBranch: 'main' },
    ],
    boards: [{ id: 'board', name: 'Harness board', workflowYaml: workflowYaml(options.restricted, options.prepare !== undefined), workflow: { name: 'Harness flow', initialColumnId: 'explore', columns: [{ id: 'explore', name: 'Explore', ...(options.restricted ? { allowedTransitions: ['propose'] } : {}) }, { id: 'propose', name: 'Propose', ...(options.restricted ? {} : { onEnterPrompt: 'Plan this task.' }) }, { id: 'apply', name: 'Apply', ...(options.prepare === undefined ? {} : { onEnterPrompt: 'Apply the plan.' }) }], groups: [{ id: 'planning', name: 'Planning', columnIds: ['explore', 'propose'] }] }, createdAt: now, updatedAt: now }],
    tasks, notes: options.notes ? [
      { id: 'n1', taskId: 'short', content: 'Design note with **bold** text', tags: ['design'], createdAt: now, updatedAt: now },
      { id: 'n2', taskId: 'short', content: 'Todo note', tags: ['todo'], createdAt: now, updatedAt: now },
    ] satisfies Note[] : [], createdAt: now, updatedAt: now,
  };
  if (options.extraProject) hub.projects.push({ id: 'p3', name: 'Relocation-only project', projectPath: '/repo/free', gitRootPath: '/repo', defaultBranch: 'main' });
  options.relocation?.forEach((state, index) => {
    const project = hub.projects[index];
    if (!project || state === null || state === undefined) return;
    project.operation = {
      id: 'relocation-' + project.id,
      request: { from: { projectPath: project.projectPath, gitRootPath: project.gitRootPath }, to: { name: project.name, projectPath: '/moved/' + project.id, gitRootPath: '/moved' } },
      phase: state,
      migratedSessionIds: [],
      started: state !== 'waiting',
      createdAt: now,
      ...(state === 'failed' ? { error: { code: 'DIRECTORY_SWITCH_FAILED', message: 'A conversation directory could not be changed.' } } : {}),
    };
  });
  const settings = { revision: 1, worktreeBasePath: '/worktrees' };
  const raw: KanbanSnapshot = { sequence: 1, stateRevision: 1, attention, conversationAttention, sharing: options.sharing ?? {}, ...(options.retained === undefined ? {} : { retainedCheckouts: options.retained }), state: { hubs: [hub], settings } };
  let value = withLegacy(raw);
  if ((options.hubs ?? 1) > 1) value.state.hubs.push({ id: 'hub-2', name: 'Second Hub', revision: 0, projects: [], boards: [], tasks: [], notes: [], createdAt: now, updatedAt: now });
  const listeners = new Set<(snapshot: TestSnapshot) => void>();
  const commands: Command[] = [];
  const sharingCommands: SharingCommand[] = [];
  const driveRoot = '/Users/member/Library/CloudStorage/GoogleDrive-member@example.test';
  const driveDiscovery: DriveDiscoveryView = options.drive === 'app-missing'
    ? { state: 'app-missing', locations: [] }
    : options.drive === 'unsupported'
      ? { state: 'unsupported', locations: [] }
      : options.drive === 'empty'
        ? { state: 'empty', locations: [] }
        : { state: 'ready', locations: [{ id: driveRoot, rootPath: driveRoot, kind: 'account', status: 'available', account: 'member@example.test' }] };
  function drivePage(request: LocalDriveRequest): LocalDriveResult {
    if (request.action === 'roots') return { action: 'roots', discovery: driveDiscovery };
    const atRoot = request.path === driveRoot;
    const name = request.path.split('/').pop() ?? '';
    const entries = atRoot
      ? [{ name: 'Meu Drive', path: driveRoot + '/Meu Drive', group: { id: 'my-drive' as const, label: 'My Drive' } }, { name: 'Drives compartilhados', path: driveRoot + '/Drives compartilhados', group: { id: 'shared-drives' as const, label: 'Shared drives' } }]
      : name === 'Meu Drive'
        ? [{ name: 'Projetos', path: request.path + '/Projetos' }, { name: 'Time', path: request.path + '/Time' }]
        : name === 'Drives compartilhados'
          ? [{ name: 'Design', path: request.path + '/Design' }]
          : name === 'Projetos'
            ? [{ name: 'Website', path: request.path + '/Website' }]
            : [];
    const page: DriveBrowseView = { rootId: driveRoot, path: request.path, parent: atRoot ? null : request.path.slice(0, request.path.lastIndexOf('/')), entries, hasDocument: name === 'Projetos', truncated: false, shown: entries.length };
    return { action: 'list', page };
  }
  function localDriveSharing(pathValue: string, status: 'preview' | 'published'): HubSharingView {
    const folder = pathValue.slice(pathValue.lastIndexOf('/') + 1);
    return {
      status, provider: 'google-drive-local', providerLabel: 'Google Drive Local', address: 'member@example.test / ' + folder,
      syncMode: 'continuous', intervalMinutes: 1, lastSyncedAt: '2026-10-21T00:05:00Z',
      drafts: 0, pending: 0, updates: 0, conflicts: 0, orderChanged: false, syncing: false,
      boards: [{ boardId: 'board', key: 'harness-board', name: 'Harness board', state: 'in-sync', bound: true, pending: false }],
      incoming: [], removed: [], blockers: [], removing: [],
      ...(status === 'preview' ? { preview: { publishedBoards: 1, localBoards: 1 }, boards: [{ boardId: 'board', key: 'harness-board', name: 'Harness board', state: 'updates-available' as const, bound: true, pending: true }] } : {}),
    };
  }
  if (options.persist) { try { const stored = sessionStorage.getItem('dsh-kanban.harness'); if (stored) value = withLegacy(JSON.parse(stored) as KanbanSnapshot); } catch { /* storage is optional */ } }
  const publish = () => { value = withLegacy(clone(value)); value.sequence++; if (options.persist) { try { sessionStorage.setItem('dsh-kanban.harness', JSON.stringify(value)); } catch { /* storage is optional */ } } const copy = withLegacy(clone(value)); for (const listener of listeners) listener(copy); return withLegacy(clone(value)); };
  const api: ClientApi = {
    snapshot: async () => withLegacy(clone(value)),
    command: async (command: Command) => {
      commands.push(structuredClone(command));
      const firstHub = value.state.hubs[0]!; const firstBoard = firstHub.boards[0]!;
      let receipt: KanbanSnapshot['commandReceipt'];
      if (command.type === 'board.workflow.save') { const hub = value.state.hubs.find(item => item.id === command.hubId); const board = hub?.boards.find(item => item.id === command.boardId); if (board) { board.workflowYaml = command.yaml; if (hub) hub.revision += 1; } }
      if (command.type === 'workflow.save') { firstBoard.workflowYaml = command.yaml; firstHub.revision += 1; }
      if (command.type === 'task.move') {
        const task = value.state.hubs.flatMap(hub => hub.tasks).find(item => item.id === command.taskId);
        const hub = task ? value.state.hubs.find(item => item.tasks.some(candidate => candidate.id === task.id)) : undefined;
        const board = task && hub ? hub.boards.find(item => item.id === task.boardId) : undefined;
        if (task && hub && board) applyMove({ schemaVersion: 2, revision: hub.revision, workflowYaml: board.workflowYaml, workflow: board.workflow, projects: hub.projects, tasks: hub.tasks, notes: hub.notes }, command.taskId, command.columnId, command.beforeTaskId, nextEnteredAt);
      }
      if (command.type === 'task.runInstruction') {
        if (options.runFailure) throw { code: 'SEND_FAILED', message: 'The instruction could not be sent.' };
        const task = value.state.hubs.flatMap(hub => hub.tasks).find(item => item.id === command.taskId);
        const hub = task ? value.state.hubs.find(item => item.tasks.some(candidate => candidate.id === task.id)) : undefined;
        const board = task && hub ? hub.boards.find(item => item.id === task.boardId) : undefined;
        if (task && hub && board) {
          const result = applyRunInstruction({ schemaVersion: 2, revision: hub.revision, workflowYaml: board.workflowYaml, workflow: board.workflow, projects: hub.projects, tasks: hub.tasks, notes: hub.notes }, command);
          if (!result.ok) throw { code: result.code, message: result.message };
        }
      }
      if (command.type === 'operation.dismiss') {
        const task = value.state.hubs.flatMap(hub => hub.tasks).find(item => item.id === command.taskId);
        if (task?.pendingTransition?.origin === 'auto' && task.pendingTransition.status === 'failed') delete task.pendingTransition;
      }
      if (command.type === 'task.autoMode') {
        const task = value.state.hubs.flatMap(hub => hub.tasks).find(item => item.id === command.taskId);
        if (task) { if (command.enabled) task.autoMode = { enabled: true }; else delete task.autoMode; }
      }
      if (command.type === 'worktree.create') { const task = firstHub.tasks.find(item => item.id === command.taskId); if (task) { task.worktree = { path: command.path, branch: command.branchName, owned: true, status: 'ready' }; task.effectiveCwd = command.path; } }
      if (command.type === 'worktree.dismiss') { const task = firstHub.tasks.find(item => item.id === command.taskId); if (task) task.worktreeDismissed = true; }
      if (command.type === 'conversation.create') {
        const task = value.state.hubs.flatMap(item => item.tasks).find(item => item.id === command.taskId);
        if (task) { const id = 's-created-' + task.sessionIds.length + '-' + commands.length; task.sessionIds.push(id); receipt = { kind: 'conversation', id }; }
      }
      if (command.type === 'note.save') {
        const task = value.state.hubs.flatMap(hub => hub.tasks).find(item => item.id === command.taskId);
        const hub = task ? value.state.hubs.find(item => item.tasks.some(candidate => candidate.id === task.id)) : undefined;
        const current = command.noteId ? hub?.notes.find(item => item.id === command.noteId) : undefined;
        if (hub !== undefined && current !== undefined) {
          if (command.content !== undefined) current.content = command.content;
          if (command.tags !== undefined) { if (command.tags.length === 0) delete current.tags; else current.tags = [...command.tags]; }
        } else if (hub !== undefined && task !== undefined) {
          const id = 'note-' + (commands.length + 1);
          hub.notes.push({ id, taskId: task.id, content: command.content ?? '', ...(command.tags !== undefined && command.tags.length > 0 ? { tags: [...command.tags] } : {}), createdAt: now, updatedAt: now });
          receipt = { kind: 'note', id };
        }
      }
      if (command.type === 'note.delete') {
        const hub = value.state.hubs.find(item => item.notes.some(note => note.id === command.noteId));
        if (hub !== undefined) hub.notes = hub.notes.filter(note => !(note.id === command.noteId && note.taskId === command.taskId));
        receipt = { kind: 'note', id: command.noteId };
      }
      if (command.type === 'board.create') { const hub = value.state.hubs.find(item => item.id === command.hubId); if (hub) { const board = { id: 'board-' + (commands.length + 1), name: command.name, workflowYaml: workflowYaml(), workflow: structuredClone(firstBoard.workflow), createdAt: now, updatedAt: now }; hub.boards.push(board); receipt = { kind: 'board', id: board.id }; } }
      if (command.type === 'hub.create') { const created: HubState = { id: 'hub-' + (commands.length + 1), name: command.name, revision: 0, projects: [], boards: [], tasks: [], notes: [], createdAt: now, updatedAt: now }; value.state.hubs.push(created); receipt = { kind: 'hub', id: created.id }; }
      const relocatedProject = command.type === 'project.relocationRetry' || command.type === 'project.relocationCancel'
        ? value.state.hubs.flatMap(hub => hub.projects).find(project => project.id === command.projectId)
        : undefined;
      if (relocatedProject?.operation !== undefined) {
        if (command.type === 'project.relocationRetry') { relocatedProject.operation.phase = 'queued'; delete relocatedProject.operation.error; }
        if (command.type === 'project.relocationCancel') delete relocatedProject.operation;
      }
      const snapshot = publish();
      return receipt ? { ...snapshot, commandReceipt: receipt } : snapshot;
    },
    branches: async () => ['main', 'feature'],
    worktreeDefault: async taskId => { const task = value.state.hubs[0]!.tasks.find(item => item.id === taskId); const branchName = taskTitleSlug(task?.title ?? 'task'); return { branchName, path: worktreePathForBranch(value.state.settings.worktreeBasePath, branchName) }; },
    detectProject: async (pathValue: string) => options.detect === 'git'
      ? { kind: 'git' as const, projectPath: pathValue, gitRootPath: '/repo', defaultBranch: 'main' }
      : { kind: 'folder' as const, projectPath: pathValue },
    sharing: async (command: SharingCommand) => {
      sharingCommands.push(structuredClone(command));
      if (options.shareFailure) throw { code: 'SHARING_FAILED', message: 'The publishing operation could not be completed.' };
      if (options.folderRefusal && command.type === 'sharing.connect') throw { code: 'SHARING_FOLDER_MISSING', message: 'The selected folder does not exist.' };
      if (options.shareRefusal) throw { code: 'SHARING_REFUSED', message: 'The team configuration cannot be applied until these boards are resolved.', details: { blockers: [{ code: 'SHARING_ORPHAN_COLUMNS', message: 'Board "Harness board" would leave 2 tasks in column "plan", which the team workflow does not define.' }] } };
      const hubId = 'hubId' in command ? command.hubId : undefined;
      const current = hubId === undefined ? undefined : value.sharing[hubId];
      if (current && hubId !== undefined) value.sharing[hubId] = { ...current, drafts: Math.max(0, current.drafts - 1), ...(command.type === 'sharing.check' ? { lastCheckedAt: '2026-10-21T00:05:00Z' } : {}) };
      if (command.type === 'sharing.disconnect' && hubId !== undefined) delete value.sharing[hubId];
      if (command.type === 'sharing.connect' && command.provider === 'google-drive-local' && command.settings?.path !== undefined) {
        value.sharing.hub = localDriveSharing(command.settings.path, command.settings.path.endsWith('/Projetos') ? 'preview' : 'published');
      }
      if (command.type === 'sharing.changeLocation' && command.settings.path !== undefined) {
        value.sharing.hub = localDriveSharing(command.settings.path, command.settings.path.endsWith('/Projetos') || command.settings.path.endsWith('/Website') ? 'preview' : 'published');
      }
      return publish();
    },
    localDrive: async (request: LocalDriveRequest) => {
      if (options.drive === 'error') throw { code: 'SHARING_DRIVE_DISCOVERY_FAILED', message: 'Google Drive discovery could not be completed.' };
      return drivePage(request);
    },
    subscribe: listener => { const wrapped = (snapshot: TestSnapshot) => listener(snapshot); listeners.add(wrapped); return () => listeners.delete(wrapped); },
  };
  return { api, snapshot: () => withLegacy(clone(value)), commands: () => structuredClone(commands), sharingCommands: () => structuredClone(sharingCommands) };
}

export function workflowYaml(restricted = false, applyInstruction = false): string {
  return ['name: Harness flow', 'initial_column: explore', 'columns:', '  - id: explore', '    label: Explore', ...(restricted ? ['    allowed_transitions: [propose]'] : []), '  - id: propose', '    label: Propose', ...(restricted ? [] : ['    on_enter_prompt: |', '      Plan this task.']), '  - id: apply', '    label: Apply', ...(applyInstruction ? ['    on_enter_prompt: |', '      Apply the plan.'] : []), 'groups:', '  - id: planning', '    label: Planning', '    columns: [explore, propose]', ''].join(String.fromCharCode(10));
}

function firstExecutionTask(): HubTask {
  return { ...task('first', 'First execution task', 'explore', -1), sessionIds: [], closedSessionIds: [] };
}
function blockedBindingTask(): HubTask {
  return {
    ...task('broken', 'Broken binding task', 'explore', -2), sessionIds: [], closedSessionIds: [],
    worktree: { path: '/worktrees/broken', branch: 'broken', owned: true, status: 'error', error: { code: 'WORKTREE_CREATE_FAILED', message: 'The checkout could not be created.' } },
  };
}

function clone(value: KanbanSnapshot): KanbanSnapshot {
  const normalized = withLegacy(value);
  return structuredClone({
    sequence: normalized.sequence, stateRevision: normalized.stateRevision,
    attention: normalized.attention, conversationAttention: normalized.conversationAttention,
    sharing: normalized.sharing ?? {},
    ...(normalized.sharingAuth === undefined ? {} : { sharingAuth: normalized.sharingAuth }),
    ...(normalized.retainedCheckouts === undefined ? {} : { retainedCheckouts: normalized.retainedCheckouts }),
    state: { hubs: normalized.state.hubs, settings: normalized.state.settings ?? { revision: 0 } },
  });
}
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

function longTitleTask(): HubTask {
  return { ...task('long-title', 'A very long task title that should wrap across multiple lines in the narrow card', 'apply', 45), projectId: 'p2' };
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
