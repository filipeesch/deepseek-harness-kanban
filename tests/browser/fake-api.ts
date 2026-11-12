import type { BoardState, ClientApi, Command, ConversationModelOutcome, ModelSelection, DriveBrowseView, DriveDiscoveryView, HubSchedule, HubScheduleRuntime, HubSharingView, HubState, HubTask, KanbanSnapshot, KanbanState, LocalDriveRequest, LocalDriveResult, Note, SharingCommand } from '../../src/shared/types.js';
import { NO_PENDING_USER_WORK } from '../../src/shared/types.js';
import { requireProjectPath } from '../../src/shared/project.js';
import { pendingUserWork } from '../../src/domain/pending-user-work.js';
import { defaultWorktreeDestination, taskTitleSlug } from '../../src/shared/worktree-name.js';
import { applyInitialEntry, applyMove, applyRunInstruction, createEnteredAtSource } from '../support/in-memory-board.js';
import { transitions } from '../support/transition-rules.js';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { writeBoardModelField } from '../../src/domain/board-model-field.js';
import { renameTaskStage, updateStage } from '../../src/domain/stage-update.js';
import type { TaskHistoryEntry } from '../../src/shared/task-history.js';

export interface HarnessApi {
  api: ClientApi;
  snapshot(): TestSnapshot;
  commands(): readonly Command[];
  sharingCommands(): readonly SharingCommand[];
  /** Applies a host-driven board change and publishes it, as a team update or an automatic advance would. */
  mutate(change: (state: TestSnapshot['state']) => void): void;
}
export type TestSnapshot = KanbanSnapshot & { state: KanbanState & Omit<BoardState, 'settings'> & { settings: any } };

export interface HarnessOptions { deterministic?: import('../../src/shared/deterministic.js').DeterministicPhase; deterministicDelivery?: 'failed'; deterministicRefusal?: boolean; deterministicFailure?: 'infrastructure' | 'diagnostic'; stageUpdateFailure?: boolean; history?: 'short' | 'long'; recorded?: boolean; staleRoute?: boolean; attention?: boolean; presence?: boolean; hubs?: number; restricted?: boolean; restrictedNext?: boolean; runFailure?: boolean; persist?: boolean; pending?: boolean; auto?: boolean; declared?: boolean; declaredFailed?: boolean; detect?: 'git' | 'folder'; prepare?: 'plain' | 'restricted'; initialInstruction?: boolean; agentPause?: boolean; notes?: boolean; idle?: boolean; sharing?: Record<string, HubSharingView>; shareFailure?: boolean; shareRefusal?: boolean; folderRefusal?: boolean; retained?: Array<{ path: string; projectId: string; taskTitle: string; reason: 'folder' | 'unresolved' }>; relocation?: Array<'waiting' | 'failed' | null>; extraProject?: boolean; drive?: 'ready' | 'empty' | 'app-missing' | 'unsupported' | 'error'; schedules?: HubSchedule[]; scheduleRuntime?: HubScheduleRuntime; modelCatalogFailure?: boolean;
  /** Names the board's default model and what its conversations report back when it cannot be applied. */
  boardModel?: { model: ModelSelection; fallback?: ConversationModelOutcome }; }

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
  // One task with a recorded flow, so the History section can render every kind of row.
  if (options.history !== undefined) {
    const short: TaskHistoryEntry[] = [
      { kind: 'created', at: '2026-11-11T09:00:00.000Z', columnId: 'explore' },
      { kind: 'stage', at: '2026-11-11T09:20:00.000Z', fromColumnId: 'explore', columnId: 'propose' },
      { kind: 'auto-mode', at: '2026-11-11T09:40:00.000Z', action: 'paused', reason: 'turn-error', message: 'Rate limited.' },
      { kind: 'worktree', at: '2026-11-11T10:00:00.000Z', action: 'created', path: '/worktrees/harness', branch: 'task/harness' },
    ];
    // A long record proves the section scrolls and withholds nothing behind a control.
    const base = Date.parse('2026-11-11T08:00:00.000Z');
    const long: TaskHistoryEntry[] = Array.from({ length: 41 }, (_, index): TaskHistoryEntry => {
      const at = new Date(base + index * 60_000).toISOString();
      if (index === 0) return { kind: 'created', at, columnId: 'explore' };
      if (index % 2 === 1) return { kind: 'stage', at, fromColumnId: index % 4 === 1 ? 'explore' : 'propose', columnId: index % 4 === 1 ? 'propose' : 'explore' };
      return { kind: 'auto-mode', at, action: index % 4 === 0 ? 'paused' : 'resumed', ...(index % 4 === 0 ? { reason: 'turn-error' } : {}) };
    });
    tasks.find(value => value.id === 'long-0')!.history = options.history === 'long' ? long : short;
  }
  const attention: KanbanSnapshot['attention'] = options.attention ? {
    'long-0': { running: true, background: [], unread: false, awaitingReply: false, failed: false, pending: NO_PENDING_USER_WORK },
    'long-1': { running: false, background: [{ kind: 'job', label: 'Run tests' }], unread: false, awaitingReply: false, failed: false, pending: NO_PENDING_USER_WORK },
    'long-2': { running: true, background: [{ kind: 'schedule', label: 'Wake later' }], unread: false, awaitingReply: false, failed: false, pending: NO_PENDING_USER_WORK },
    'long-3': { running: false, background: [{ kind: 'job', label: 'Run tests' }, { kind: 'schedule', label: 'Wake later' }], unread: true, awaitingReply: true, failed: true, pending: NO_PENDING_USER_WORK },
  } : {};
  // One card per attention state, so each surface is visible on its own. The first four
  // tasks carry the states; the rest stay quiet.
  if (options.presence) {
    const state = (overrides: Partial<KanbanSnapshot['attention'][string]>) => ({ running: false, background: [], unread: false, awaitingReply: false, failed: false, pending: NO_PENDING_USER_WORK, ...overrides });
    attention['long-0'] = state({ running: true });
    attention['long-1'] = state({ unread: true });
    attention['long-2'] = state({ awaitingReply: true });
    attention['long-3'] = state({ failed: true, unread: true });
    // Every painted card also carries status text, so contrast is measurable on each surface.
    for (const id of ['long-0', 'long-1', 'long-2', 'long-3']) {
      const card = tasks.find(value => value.id === id);
      if (card) card.pendingTransition = { id: 'presence-' + id, fromColumnId: 'explore', columnId: 'propose', mode: 'move', status: 'waiting' };
    }
  }
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
  // The idle scenario strips every piece of in-flight work, so the stage editor's
  // identifier field is exercised in the state that allows a rename.
  if (options.idle) for (const value of tasks) {
    value.operation = null;
    delete value.autoMode;
    delete value.pendingTransition;
    if (value.worktree !== null && value.worktree.status !== 'ready') value.worktree = null;
  }
  const shortTask = tasks.find(value => value.id === 'short')!;
  // The appearance scenario needs one card that is both painted and carries status text,
  // so the contrast of the status region is measured on the surface it actually sits on.
  if (options.pending) {
    shortTask.pendingTransition = { id: 'pending-short', fromColumnId: 'propose', columnId: 'apply', mode: 'move', status: 'waiting' };
    const pendingShort: KanbanSnapshot['attention'][string] = { running: false, background: [], unread: true, awaitingReply: false, failed: false, pending: NO_PENDING_USER_WORK };
    attention['short'] = pendingShort;
    conversationAttention['s-short'] = pendingShort;
  }
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
  // A transition the agent declared: it is not a confirmed action and is named for
  // what it is, on a card whose auto mode stays off.
  if (options.declared || options.declaredFailed) {
    shortTask.pendingTransition = {
      id: 'declared-short', fromColumnId: 'propose', columnId: 'apply', mode: 'run', text: 'Plan this task.', sessionId: 's-short', origin: 'agent',
      reason: 'The plan is ready for review.',
      ...(options.declaredFailed
        ? { status: 'failed' as const, error: { code: 'SEND_FAILED', message: 'The instruction could not be admitted.' } }
        : { status: 'waiting' as const }),
    };
  }
  // A pause the agent requested, alone and beside a diagnostic pause, so the card
  // and the control present both records.
  if (options.agentPause) {
    tasks.find(value => value.id === 'long-0')!.autoMode = { enabled: true, hold: { reason: 'Review the diff', at: now } };
    tasks.find(value => value.id === 'long-3')!.autoMode = { enabled: true, hold: { reason: 'Review the diff', at: now }, pause: { reason: 'turn-error', at: now } };
  }
  const hub: HubState = {
    id: 'hub', name: 'Harness Hub', revision: 1,
    projects: [
      { id: 'p', projectKey: 'p', name: 'Project', projectPath: '/repo', gitRootPath: '/repo', defaultBranch: 'main' },
      { id: 'p2', projectKey: 'p2', name: 'A very long project name that must truncate inside the card', projectPath: '/repo/long', gitRootPath: '/repo', defaultBranch: 'main' },
    ],
boards: [{ id: 'board', name: 'Harness board', workflowYaml: workflowYaml(options.restricted, options.prepare !== undefined, options.restrictedNext), workflow: { name: 'Harness flow', initialColumnId: 'explore', columns: [{ id: 'explore', name: 'Explore', ...(options.initialInstruction ? { onEnterPrompt: 'Start the task.' } : {}), ...(options.restrictedNext ? { allowedTransitions: transitions('apply') } : options.restricted ? { allowedTransitions: transitions('propose') } : {}) }, { id: 'propose', name: 'Propose', ...(options.restricted ? {} : { onEnterPrompt: 'Plan this task.' }) }, { id: 'apply', name: 'Apply', ...(options.prepare === undefined ? {} : { onEnterPrompt: 'Apply the plan.' }) }], groups: [{ id: 'planning', name: 'Planning', columnIds: ['explore', 'propose'] }] }, createdAt: now, updatedAt: now }],
    tasks, notes: options.notes ? [
      { id: 'n1', taskId: 'short', content: 'Design note with **bold** text', tags: ['design'], createdAt: now, updatedAt: now },
      { id: 'n2', taskId: 'short', content: 'Todo note', tags: ['todo'], createdAt: now, updatedAt: now },
    ] satisfies Note[] : [], createdAt: now, updatedAt: now,
  };
  if (options.recorded) {
    // A branch the model routed explicitly: Explore configures two targets and the
    // task records the second, so both the automatic and manual paths follow it.
    hub.boards[0]!.workflow.columns.find(column => column.id === 'explore')!.allowedTransitions = transitions('propose', 'apply');
    const routed = hub.tasks.find(task => task.id === 'long-0')!;
    routed.autoMode = { enabled: true };
    routed.recordedTransition = { fromColumnId: 'explore', columnId: 'apply', at: now };
  }
  if (options.staleRoute) {
    // A recording whose target the workflow no longer configures: the automatic
    // advance pauses and the drawer's next-stage action refuses.
    hub.boards[0]!.workflow.columns.find(column => column.id === 'explore')!.allowedTransitions = transitions('propose', 'apply');
    const routed = hub.tasks.find(task => task.id === 'long-0')!;
    routed.autoMode = { enabled: true };
    routed.recordedTransition = { fromColumnId: 'explore', columnId: 'done', at: now };
  }
  if (options.schedules !== undefined) hub.schedules = structuredClone(options.schedules);
  if (options.boardModel !== undefined) {
    // The board names a default model, exactly as the workflow control writes it.
    const board = hub.boards[0]!;
    board.workflowYaml = writeBoardModelField(board.workflowYaml, options.boardModel.model);
    board.workflow = parseWorkflow(board.workflowYaml);
  }
  if (options.extraProject) hub.projects.push({ id: 'p3', projectKey: 'p3', name: 'Relocation-only project', projectPath: '/repo/free', gitRootPath: '/repo', defaultBranch: 'main' });
  options.relocation?.forEach((state, index) => {
    const project = hub.projects[index];
    if (!project || state === null || state === undefined) return;
    project.operation = {
      id: 'relocation-' + project.id,
      request: { from: { projectPath: requireProjectPath(project), gitRootPath: project.gitRootPath }, to: { name: project.name, projectPath: '/moved/' + project.id, gitRootPath: '/moved' } },
      phase: state,
      migratedSessionIds: [],
      started: state !== 'waiting',
      createdAt: now,
      ...(state === 'failed' ? { error: { code: 'DIRECTORY_SWITCH_FAILED', message: 'A conversation directory could not be changed.' } } : {}),
    };
  });
  const settings = { revision: 1, worktreeBasePath: '/worktrees' };
  const raw: KanbanSnapshot = { sequence: 1, stateRevision: 1, attention, conversationAttention, sharing: options.sharing ?? {}, ...(options.retained === undefined ? {} : { retainedCheckouts: options.retained }), ...(options.scheduleRuntime === undefined ? {} : { scheduleRuntime: { hub: options.scheduleRuntime } }), state: { hubs: [hub], settings } };
  if (options.deterministic) {
    const column = hub.boards[0]!.workflow.columns[0]!;
    const script = { language: 'typescript' as const, code: 'await tools.bash({command: "sleep 1"});\nreturn { exit: "passed", message: "CI passed" };', directory: 'task' as const, env: ['CI_TOKEN'], params: [{ name: 'pipeline', description: 'CI workflow' }], exits: { passed: 'propose', cached: 'propose', error: 'apply' } };
    const updated = updateStage({ text: hub.boards[0]!.workflowYaml, stageId: column.id, patch: { deterministic: script, allowedTransitions: null, onEnterPrompt: null } });
    hub.boards[0]!.workflowYaml = updated.text; hub.boards[0]!.workflow = parseWorkflow(updated.text);
    const scriptTask = tasks.find(task => task.id === 'long-0')!;
    scriptTask.sessionIds = []; scriptTask.stageEntry = { id: 'script-entry', columnId: 'explore', stageIdentity: 'stable-wait', enteredAt: now };
    // The failure vocabulary a real settled run stores: origin, attempts and the guard facts.
    const guard = { admission: 'not-admitted' as const, exitCode: 125, signal: null, timedOut: false, aborted: false, elapsedMs: 10_012, stdoutBytes: 0, stdoutHead: '', stderrBytes: 0, stderrTail: '' };
    const diagnosticGuard = { ...guard, admission: 'started' as const, stderrBytes: 53, stderrTail: 'NATIVE_LIFETIME_UNCLEAN: Owned processes survived cleanup.' };
    const failure = options.deterministic === 'failed' && options.deterministicFailure === 'infrastructure'
      ? { code: 'BASH_PROTOCOL', message: 'Infrastructure failure: The isolated Bash guard returned no result and no diagnostic output (exit status 125). (3 attempts) Detail: the task History.', details: { origin: 'infrastructure', attempts: [1, 2, 3].map(attempt => ({ attempt, code: 'BASH_PROTOCOL', guard })), guard } }
      : options.deterministic === 'failed' && options.deterministicFailure === 'diagnostic'
        ? { code: 'BASH_PROTOCOL', message: 'Infrastructure failure: The isolated Bash guard could not prove that the command process tree was stopped. (2 attempts) Detail: the task History.', details: { origin: 'infrastructure', attempts: [1, 2].map(attempt => ({ attempt, code: 'BASH_PROTOCOL', guard: diagnosticGuard })), guard: diagnosticGuard, cause: { code: 'TYPESCRIPT_EXCEPTION', message: 'Error: the guard left no result' } } }
        : undefined;
    if (failure !== undefined) scriptTask.history = [{ kind: 'deterministic-execution', at: now, columnId: 'explore', executionId: 'script-run', outcome: 'failed', error: failure }];
    raw.deterministic = { 'long-0': { entryId: 'script-entry', executionId: 'script-run', phase: options.deterministic, startedAt: now, attempt: 1, restartCount: 1, fingerprint: 'synthetic-captured-version', savedVersionChanged: false, parameters: { pipeline: 'ci-main' }, ...(options.deterministicDelivery === undefined ? {} : { deliveryStatus: options.deterministicDelivery }), ...(failure === undefined ? {} : { error: failure }), ...(failure !== undefined || !(options.deterministic === 'failed' && options.deterministicRefusal) ? {} : { error: { code: 'PARAMETERS_REQUIRED', message: 'Missing required parameter: pipeline. Edit the entry parameters before Play.' } }) } };
  }
  const configured = new Set<string>();
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
      status, provider: 'google-drive-local', providerLabel: 'Google Drive Local', supportsFiles: true, address: 'member@example.test / ' + folder,
      intervalMinutes: 1, lastSyncedAt: '2026-10-21T00:05:00Z',
      drafts: 0, updates: 0, conflicts: 0, syncing: false,
      boards: [{ boardId: 'board', key: 'harness-board', name: 'Harness board', state: 'in-sync', bound: true, draft: false }],
      incoming: [], pendingRemovals: [], removed: [], blockers: [],
      ...(status === 'preview' ? { preview: { publishedBoards: 1, localBoards: 1 }, boards: [{ boardId: 'board', key: 'harness-board', name: 'Harness board', state: 'draft' as const, bound: true, draft: true }] } : {}),
    };
  }
  if (options.persist) { try { const stored = sessionStorage.getItem('dsh-kanban.harness'); if (stored) value = withLegacy(JSON.parse(stored) as KanbanSnapshot); } catch { /* storage is optional */ } }
  const publish = () => { value = withLegacy(clone(value)); value.sequence++; if (options.persist) { try { sessionStorage.setItem('dsh-kanban.harness', JSON.stringify(value)); } catch { /* storage is optional */ } } const copy = withLegacy(clone(value)); for (const listener of listeners) listener(copy); return withLegacy(clone(value)); };
  const api: ClientApi = {
    snapshot: async () => withLegacy(clone(value)),
    deterministicReview: async taskId => {
      const script = value.state.workflow.columns[0]!.deterministic!;
      return { executionId: value.deterministic?.[taskId]?.executionId ?? 'preview', fingerprint: 'synthetic-captured-version', code: script.code!, language: script.language, directory: script.directory, exits: script.exits, env: script.env ?? [], params: script.params ?? [], variables: (script.env ?? []).map(name => ({ name, configured: configured.has(name) })), source: { kind: 'inline' }, executionDirectory: '/isolated/project' };
    },
    command: async (command: Command) => {
      commands.push(structuredClone(command));
      if (command.type === 'task.deterministicVariable') { if (command.value === undefined) configured.delete(command.name); else configured.add(command.name); }
      if (command.type === 'task.deterministicParameters') { const summary = value.deterministic?.[command.taskId]; if (summary) summary.parameters = structuredClone(command.values); }
      if (command.type === 'task.deterministicRetryDelivery') { const summary = value.deterministic?.[command.taskId]; if (summary) { summary.phase = 'result-ready'; summary.deliveryStatus = 'pending'; } }
      if (command.type === 'task.deterministicStop' || command.type === 'task.deterministicPlay' || command.type === 'task.deterministicApprove') {
        const summary = value.deterministic?.[command.taskId];
        if (summary) { summary.phase = command.type === 'task.deterministicStop' ? 'stopped' : 'active'; if (command.type === 'task.deterministicPlay') { summary.executionId = 'script-run-play'; delete summary.error; } }
      }
      const firstHub = value.state.hubs[0]!; const firstBoard = firstHub.boards[0]!;
      let receipt: KanbanSnapshot['commandReceipt'];
      if (command.type === 'board.workflow.save') { const hub = value.state.hubs.find(item => item.id === command.hubId); const board = hub?.boards.find(item => item.id === command.boardId); if (board) { board.workflowYaml = command.yaml; board.workflow = parseWorkflow(command.yaml); if (hub) hub.revision += 1; } }
      if (command.type === 'board.stage.update') {
        if (options.stageUpdateFailure) throw { code: 'REVISION_CONFLICT', message: 'The Hub changed while the stage edit was open.' };
        const hub = value.state.hubs.find(item => item.id === command.hubId);
        const board = hub?.boards.find(item => item.id === command.boardId);
        if (hub && command.expectedRevision !== undefined && command.expectedRevision !== hub.revision) throw { code: 'REVISION_CONFLICT', message: 'Hub state has changed since this revision.' };
        if (hub && board) {
          // The fake runs the same domain operation the host runs, so a UI save test
          // observes the text, the parse, and the task migration the host would store.
          const result = updateStage({ text: board.workflowYaml, stageId: command.stageId, patch: command.patch });
          if (result.renamedFrom !== undefined && result.renamedTo !== undefined) for (const task of hub.tasks) renameTaskStage(task, result.renamedFrom, result.renamedTo);
          board.workflowYaml = result.text;
          board.workflow = parseWorkflow(result.text);
          hub.revision += 1;
        }
      }
      if (command.type === 'retainedCheckout.dismiss') {
        value.retainedCheckouts = value.retainedCheckouts?.filter(entry => !command.paths.includes(entry.path));
      }
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
      if (command.type === 'task.pause') {
        const task = value.state.hubs.flatMap(hub => hub.tasks).find(item => item.id === command.taskId);
        if (task?.autoMode?.enabled === true) task.autoMode.hold = { reason: command.reason, at: now };
      }
      if (command.type === 'task.resume') {
        const task = value.state.hubs.flatMap(hub => hub.tasks).find(item => item.id === command.taskId);
        if (task?.autoMode !== undefined) delete task.autoMode.hold;
      }
      if (command.type === 'task.create') {
        const id = 't-created-' + commands.length;
        const created = { ...task(id, command.title, firstBoard.workflow.initialColumnId, 0), projectId: command.projectId, boardId: firstBoard.id, description: command.description, sessionIds: [], ...(command.autoMode === true ? { autoMode: { enabled: true } } : {}) };
        applyInitialEntry({ schemaVersion: 2, revision: firstHub.revision, workflowYaml: firstBoard.workflowYaml, workflow: firstBoard.workflow, projects: firstHub.projects, tasks: firstHub.tasks, notes: firstHub.notes }, created, nextEnteredAt);
        firstHub.tasks.push(created);
        receipt = { kind: 'task', id };
      }
      if (command.type === 'task.prepareFirstExecution') {
        const task = value.state.hubs.flatMap(hub => hub.tasks).find(item => item.id === command.taskId);
        const hub = task ? value.state.hubs.find(item => item.tasks.some(candidate => candidate.id === task.id)) : undefined;
        const project = task ? hub?.projects.find(item => item.id === task.projectId) : undefined;
        if (task) {
          if (project?.gitRootPath && task.worktree === null && task.worktreeDismissed !== true) { task.worktree = { path: '/worktrees/' + task.id, branch: task.title, owned: true, status: 'ready' }; task.effectiveCwd = task.worktree.path; }
          if (task.sessionIds.length === 0) { const id = 's-created-' + commands.length; task.sessionIds.push(id); receipt = { kind: 'conversation', id }; }
        }
      }
      if (command.type === 'worktree.create') { const task = firstHub.tasks.find(item => item.id === command.taskId); if (task) { const path = command.path ?? '/worktrees/derived'; task.worktree = { path, branch: command.branchName ?? 'derived', owned: true, status: 'ready' }; task.effectiveCwd = path; } }
      if (command.type === 'worktree.dismiss') { const task = firstHub.tasks.find(item => item.id === command.taskId); if (task) task.worktreeDismissed = true; }
      if (command.type === 'conversation.create') {
        const task = value.state.hubs.flatMap(item => item.tasks).find(item => item.id === command.taskId);
        if (task) { const id = 's-created-' + task.sessionIds.length + '-' + commands.length; task.sessionIds.push(id); receipt = { kind: 'conversation', id, ...(options.boardModel?.fallback === undefined ? {} : { model: structuredClone(options.boardModel.fallback) }) }; }
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
      if (command.type === 'schedule.save') {
        const hub = value.state.hubs.find(item => item.id === command.hubId);
        if (hub) {
          const current = command.scheduleId === undefined ? undefined : (hub.schedules ?? []).find(item => item.id === command.scheduleId);
          const id = current?.id ?? 'schedule-' + (commands.length + 1);
          const schedule: HubSchedule = {
            id, title: command.title, prompt: command.prompt, cron: command.cron, timeZone: command.timeZone, projectId: command.projectId,
            ...(command.model === undefined ? {} : { model: command.model }),
            newConversation: command.newConversation, archiveWhenIdle: command.newConversation ? command.archiveWhenIdle : false,
            enabled: current?.enabled ?? true, createdAt: current?.createdAt ?? now, updatedAt: now,
          };
          hub.schedules = [...(hub.schedules ?? []).filter(item => item.id !== id), schedule];
          hub.revision += 1;
          receipt = { kind: 'schedule', id };
        }
      }
      if (command.type === 'schedule.setEnabled') {
        const hub = value.state.hubs.find(item => item.id === command.hubId);
        const schedule = hub?.schedules?.find(item => item.id === command.scheduleId);
        if (hub && schedule) { schedule.enabled = command.enabled; schedule.updatedAt = now; hub.revision += 1; }
      }
      if (command.type === 'schedule.delete') {
        const hub = value.state.hubs.find(item => item.id === command.hubId);
        if (hub) {
          const found = hub.schedules?.find(item => item.id === command.scheduleId);
          if (found) { hub.schedules = (hub.schedules ?? []).filter(item => item.id !== command.scheduleId); hub.revision += 1; receipt = { kind: 'schedule', id: found.id }; }
        }
      }
      if (command.type === 'schedule.runNow') {
        const hub = value.state.hubs.find(item => item.id === command.hubId);
        const schedule = hub?.schedules?.find(item => item.id === command.scheduleId);
        if (hub && schedule) {
          const runtime = value.scheduleRuntime ?? {};
          value.scheduleRuntime = { ...runtime, [hub.id]: { ...(runtime[hub.id] ?? {}), [schedule.id]: { running: false, lastRun: { status: 'sent', at: now, manual: true, sessionId: 's-' + schedule.id } } } };
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
    modelCatalog: async () => {
      if (options.modelCatalogFailure) throw { code: 'MODEL_CATALOG_UNAVAILABLE', message: 'The model catalog is unavailable.' };
      return { default: { provider: 'deepseek', model: 'chat' }, providers: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'chat', name: 'Chat' }, { id: 'reason', name: 'Reason' }] }], failures: [] };
    },
    worktreeDefault: async taskId => { const task = value.state.hubs[0]!.tasks.find(item => item.id === taskId); const project = value.state.hubs[0]!.projects.find(item => item.id === task?.projectId); const branchName = taskTitleSlug(task?.title ?? 'task'); return { kind: 'derived' as const, branchName, path: defaultWorktreeDestination({ gitRootPath: project?.gitRootPath, basePath: value.state.settings?.worktreeBasePath, branchName }) }; },
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
  const mutate = (change: (state: TestSnapshot['state']) => void): void => { change(value.state); publish(); };
  return { api, snapshot: () => withLegacy(clone(value)), commands: () => structuredClone(commands), sharingCommands: () => structuredClone(sharingCommands), mutate };
}

export function workflowYaml(restricted = false, applyInstruction = false, restrictedNext = false): string {
  return ['name: Harness flow', 'initial_column: explore', 'columns:', '  - id: explore', '    label: Explore', ...(restrictedNext ? ['    allowed_transitions: [apply]'] : restricted ? ['    allowed_transitions: [propose]'] : []), '  - id: propose', '    label: Propose', ...(restricted ? [] : ['    on_enter_prompt: |', '      Plan this task.']), '  - id: apply', '    label: Apply', ...(applyInstruction ? ['    on_enter_prompt: |', '      Apply the plan.'] : []), 'groups:', '  - id: planning', '    label: Planning', '    columns: [explore, propose]', ''].join(String.fromCharCode(10));
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
    ...(normalized.deterministic === undefined ? {} : { deterministic: normalized.deterministic }),
    ...(normalized.sharingAuth === undefined ? {} : { sharingAuth: normalized.sharingAuth }),
    ...(normalized.retainedCheckouts === undefined ? {} : { retainedCheckouts: normalized.retainedCheckouts }),
    ...(normalized.scheduleRuntime === undefined ? {} : { scheduleRuntime: normalized.scheduleRuntime }),
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
