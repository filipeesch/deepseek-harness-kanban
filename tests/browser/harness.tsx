import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BoardView } from '../../src/client/board.js';
import { styles } from '../../src/client/styles/index.js';
import { Configuration } from '../../src/client/settings/configuration.js';
import { ProjectEditorDialog } from '../../src/client/projects/project-editor-dialog.js';
import { DirectoryPickerProvider } from '../../src/client/services.js';
import { AgentPresetProvider } from '../../src/client/agent-preset-context.js';
import type { AgentPresetPortSource } from '../../src/client/agent-preset-port.js';
import { QuestionForm } from '../../src/questions/QuestionForm.js';
import type { BoardState, ClientApi, Command, HubSharingView, QuestionRound, RoundPage, StoredQuestionDraft } from '../../src/shared/types.js';
import { createHarnessApi, workflowYaml, type TestSnapshot } from './fake-api.js';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { themeFixture } from './theme-fixture.js';
import { DeterministicHandoffNodeView } from '../../src/client/deterministic-handoff-node.js';
import { TaskMessageNodeView, TASK_MESSAGE_NODE_KIND } from '../../src/client/task-message-node.js';
import type { NativeSlotSource } from '../../src/client/native-slot-host.js';

const scenario = new URLSearchParams(window.location.search).get('scenario') ?? 'board';
const sharingCase = new URLSearchParams(window.location.search).get('sharing');
const flowScenario = scenario === 'flow' || scenario === 'flow-anchored' || scenario === 'flow-orphan' || scenario === 'flow-offgrid' || scenario === 'flow-placed' || scenario === 'flow-crossing' || scenario === 'flow-restricted' || scenario === 'flow-restricted-next' || scenario === 'flow-presence' || scenario === 'flow-refused';
const query = new URLSearchParams(window.location.search);
const themed = query.get('theme') === 'host';
const refuse = query.get('refuse');
const sharingViews: Record<string, HubSharingView> = sharingCase === null ? {} : { hub: harnessSharing(sharingCase) };
const driveCase = query.get('drive') as 'ready' | 'empty' | 'app-missing' | 'unsupported' | 'error' | null;
const sharingAuth = sharingCase?.startsWith('drive') === true && !sharingCase.startsWith('drive-local') ? { status: 'connected' as const, email: 'member@example.test' } : undefined;
const scheduleFixtures = [
  { id: 'schedule', title: 'Morning review', prompt: 'Summarize the pull requests.', cron: '0 9 * * *', timeZone: 'Europe/Lisbon', projectId: 'p', newConversation: true, archiveWhenIdle: true, enabled: true, createdAt: '2026-10-21T00:00:00Z', updatedAt: '2026-10-21T00:00:00Z' },
  { id: 'schedule-2', title: 'Weekly report', prompt: 'Write the weekly report.', cron: '0 0 * * 1', timeZone: 'Europe/Lisbon', projectId: 'p', newConversation: true, archiveWhenIdle: true, enabled: false, createdAt: '2026-10-21T00:01:00Z', updatedAt: '2026-10-21T00:01:00Z' },
];
const scheduleRuntimeFixture = {
  schedule: { running: false, lastRun: { status: 'sent' as const, at: '2026-10-21T09:00:00Z', manual: false, sessionId: 's-schedule' } },
  'schedule-2': { running: false },
};
const boardModel = scenario === 'board-model'
  ? { model: query.get('route') === 'stale'
    ? { provider: 'deepseek', model: 'retired', reasoningEffort: 'high' }
    : { provider: 'deepseek', model: 'reason', reasoningEffort: 'high' } }
  : scenario === 'board-model-notice'
    ? {
      model: { provider: 'deepseek', model: 'reason', reasoningEffort: 'high' },
      fallback: { requested: { provider: 'deepseek', model: 'reason', reasoningEffort: 'high' }, applied: false as const, reason: 'unavailable' as const, inUse: { provider: 'deepseek', model: 'chat' } },
    }
    : undefined;
const harness = createHarnessApi({ ...(scenario === 'deterministic' ? { deterministic: (query.get('phase') ?? 'active') as import('../../src/shared/deterministic.js').DeterministicPhase, ...(query.get('delivery') === 'failed' ? { deterministicDelivery: 'failed' as const } : {}), ...(query.get('refusal') === 'parameters' ? { deterministicRefusal: true } : {}), ...(query.get('failure') === 'infrastructure' ? { deterministicFailure: 'infrastructure' as const } : {}), ...(query.get('failure') === 'diagnostic' ? { deterministicFailure: 'diagnostic' as const } : {}) } : {}), idle: scenario === 'stage-idle', history: scenario === 'history' ? 'short' : scenario === 'history-long' ? 'long' : undefined, ...(boardModel === undefined ? {} : { boardModel }), ...(scenario === 'schedules' ? { schedules: scheduleFixtures, scheduleRuntime: scheduleRuntimeFixture } : {}), recorded: scenario === 'routed', staleRoute: scenario === 'stale-route', attention: scenario === 'activity' || scenario === 'appearance' || scenario === 'hubs' || scenario === 'project-relocation' || scenario === 'flow-presence' || scenario === 'presence',
  presence: scenario === 'presence', hubs: scenario === 'hubs' ? 2 : 1, initialInstruction: scenario === 'create', restricted: scenario === 'move' || scenario === 'prepare-restricted' || scenario === 'flow-restricted', ...(scenario === 'restricted-next' || scenario === 'flow-restricted-next' ? { restrictedNext: true } : {}), persist: scenario === 'board' || scenario === 'relocation-board', pending: scenario === 'appearance', auto: scenario === 'auto' || scenario === 'agent-pause', declared: scenario === 'declared' || scenario === 'declared-failed', declaredFailed: scenario === 'declared-failed', ...(scenario === 'agent-pause' ? { agentPause: true } : {}), detect: scenario === 'project-editor' || scenario === 'project-relocation' ? 'git' : 'folder', notes: scenario === 'notes', sharing: sharingViews, ...(driveCase === null ? {} : { drive: driveCase }), shareFailure: sharingCase === 'share-fail', shareRefusal: sharingCase === 'refuse-error', folderRefusal: refuse === 'folder', ...(scenario === 'prepare' ? { prepare: 'plain' as const } : scenario === 'prepare-restricted' ? { prepare: 'restricted' as const } : {}), ...(scenario === 'retained' ? { retained: [{ path: '/worktrees/gone', projectId: 'p', taskTitle: 'Moved repo', reason: 'unresolved' as const }] } : scenario === 'retained-many' ? { retained: [{ path: '/worktrees/gone', projectId: 'p', taskTitle: 'Moved repo', reason: 'unresolved' as const }, { path: '/worktrees/plain', projectId: 'p', taskTitle: 'Plain task', reason: 'folder' as const }] } : {}), ...(scenario === 'relocation-list' ? { relocation: ['waiting', 'failed', 'waiting'] as Array<'waiting' | 'failed' | null> } : scenario === 'relocation-board' ? { relocation: ['waiting', 'failed'] as Array<'waiting' | 'failed' | null> } : {}), ...(scenario === 'relocation-list' ? { extraProject: true } : {}), ...(scenario === 'flow-refused' ? { stageUpdateFailure: true } : {}) });

function harnessSharing(kind: string): HubSharingView {
  const view: HubSharingView = {
    status: 'published', provider: 'git', providerLabel: 'Git repository', supportsFiles: true, address: 'https://example.test/team.git', intervalMinutes: 5, lastCheckedAt: '2026-10-21T00:05:00Z',
    drafts: 0, updates: 0, conflicts: 0, syncing: false,
    boards: [{ boardId: 'board', key: 'harness-board', name: 'Harness board', state: 'in-sync', bound: true, draft: false }],
    incoming: [], pendingRemovals: [], removed: [], blockers: [],
  };
  const draftBoard = { ...view.boards[0]!, state: 'draft' as const, draft: true, detail: { changes: [{ kind: 'stage.field-changed' as const, stage: 'explore', field: 'name' }, { kind: 'board.renamed' as const, name: 'Renamed board' }] } };
  if (kind === 'draft') return { ...view, drafts: 1, boards: [draftBoard] };
  if (kind === 'updates') return { ...view, status: 'updates-available', updates: 1, boards: [{ ...view.boards[0]!, state: 'updates-available', updates: 2, detail: { changes: [{ kind: 'stage.id-changed', from: 'explore', to: 'discover' }] } }], incoming: [{ key: 'team-board', name: 'Team board' }] };
  if (kind === 'update-required') return { ...view, status: 'needs-review', conflicts: 1, blockers: [{ code: 'SHARING_DOCUMENT_VERSION_UNSUPPORTED', message: 'The team configuration was written by a newer plugin version. Update the plugin to read or publish it.' }], boards: [{ ...view.boards[0]!, state: 'update-required' }] };
  if (kind === 'review') return { ...view, status: 'needs-review', conflicts: 1, boards: [{ ...view.boards[0]!, state: 'needs-review', detail: { changes: [{ kind: 'stage.id-changed', from: 'explore', to: 'discover' }], local: workflowYaml(), team: workflowYaml(true), localName: 'Harness board', teamName: 'Team board' } }] };
  if (kind === 'orphan') return { ...view, boards: [{ ...view.boards[0]!, state: 'orphan' }] };
  if (kind === 'pending-orphan') return { ...view, status: 'updates-available', updates: 1, boards: [{ ...view.boards[0]!, state: 'orphan', updates: 1 }] };
  if (kind === 'collision') return { ...view, status: 'needs-review', conflicts: 1, boards: [{ boardId: 'board', name: 'Harness board', state: 'needs-review', bound: false, draft: false }] };
  if (kind === 'mixed') return { ...view, status: 'updates-available', updates: 1, drafts: 1, boards: [draftBoard], incoming: [{ key: 'team-board', name: 'Team board' }] };
  if (kind === 'removed') return { ...view, removed: [{ boardId: 'old-board', key: 'old-board', name: 'Old board' }] };
  if (kind === 'unavailable') return { ...view, status: 'unavailable', error: { code: 'SHARING_UNREACHABLE', message: 'The team repository could not be reached.' } };
  if (kind === 'preview') return { ...view, status: 'preview', preview: { publishedBoards: 2, localBoards: 1 }, previewBoards: [{ key: 'harness-board', name: 'Harness board' }, { key: 'team-board', name: 'Team board' }], boards: [{ ...view.boards[0]!, state: 'draft', draft: true }], incoming: [{ key: 'team-board', name: 'Team board' }] };
  if (kind.startsWith('drive-local')) {
    const local = { ...view, provider: 'google-drive-local' as const, providerLabel: 'Google Drive Local', address: 'member@example.test / Projetos', intervalMinutes: 1, lastSyncedAt: '2026-10-21T00:05:00Z' };
    if (kind === 'drive-local-unavailable') return { ...local, status: 'unavailable', error: { code: 'SHARING_DRIVE_MOUNT_UNAVAILABLE', message: 'The Google Drive location is no longer mounted on this machine.' } };
    if (kind === 'drive-local-review') return { ...local, status: 'needs-review', conflicts: 1, blockers: [{ code: 'SHARING_CONFLICT_COPY', message: 'Another copy of the team configuration is in this folder: kanban-hub (1).yaml. Review the copies before synchronizing.' }], boards: [{ ...local.boards[0]!, state: 'needs-review' }] };
    return local;
  }
  if (kind.startsWith('drive')) {
    const drive = { ...view, provider: 'google-drive' as const, providerLabel: 'Google Drive', supportsFiles: false, address: 'Team drive / Hub', authorization: 'connected' as const, lastSyncedAt: '2026-10-21T00:05:00Z' };
    if (kind === 'drive-preview') return { ...drive, status: 'preview', preview: { publishedBoards: 2, localBoards: 1 }, previewBoards: [{ key: 'harness-board', name: 'Harness board' }, { key: 'team-board', name: 'Team board' }], boards: [{ ...drive.boards[0]!, state: 'draft', draft: true }], incoming: [{ key: 'team-board', name: 'Team board' }] };
    if (kind === 'drive-review') return { ...drive, status: 'needs-review', conflicts: 1, boards: [{ ...drive.boards[0]!, state: 'needs-review', detail: { changes: [{ kind: 'stage.id-changed', from: 'explore', to: 'discover' }], local: workflowYaml(), team: workflowYaml(true), localName: 'Harness board', teamName: 'Team board' } }] };
    return drive;
  }
  if (kind.startsWith('folder')) {
    const folder = { ...view, provider: 'local-folder' as const, providerLabel: 'Local folder', address: '~/.dsh-kanban/hub', intervalMinutes: 1, lastSyncedAt: '2026-10-21T00:05:00Z' };
    if (kind === 'folder-preview') return { ...folder, status: 'preview', preview: { publishedBoards: 2, localBoards: 1 }, previewBoards: [{ key: 'harness-board', name: 'Harness board' }, { key: 'team-board', name: 'Team board' }], boards: [{ ...folder.boards[0]!, state: 'draft', draft: true }], incoming: [{ key: 'team-board', name: 'Team board' }] };
    if (kind === 'folder-review') return { ...folder, status: 'needs-review', blockers: [{ code: 'SHARING_CONFLICT_COPY', message: 'Another copy of the team configuration is in this folder: kanban-hub (1).yaml. Review the copies before synchronizing.' }] };
    return folder;
  }
  if (kind === 'unavailable-conflict') return { ...view, status: 'unavailable', conflicts: 1, error: { code: 'SHARING_UNREACHABLE', message: 'The team repository could not be reached.' }, boards: [{ ...view.boards[0]!, state: 'needs-review', detail: { changes: [], local: workflowYaml(), team: workflowYaml(true), localName: 'Harness board', teamName: 'Team board' } }] };
  if (kind === 'unavailable-folder-review') {
    return { ...view, provider: 'local-folder' as const, providerLabel: 'Local folder', address: '~/.dsh-kanban/hub', intervalMinutes: 1, status: 'unavailable', error: { code: 'SHARING_FOLDER_MISSING', message: 'The selected folder is not accessible.' }, blockers: [{ code: 'SHARING_CONFLICT_COPY', message: 'Another copy of the team configuration is in this folder: kanban-hub (1).yaml. Review the copies before synchronizing.' }] };
  }
  if (kind === 'refuse-error') return { ...view, status: 'updates-available', updates: 1 };
  return view;
}
(window as unknown as { __harness: unknown }).__harness = { commands: harness.commands, snapshot: harness.snapshot, sharingCommands: harness.sharingCommands, mutate: harness.mutate };
if (flowScenario) {
  harness.mutate(state => {
    const board = state.hubs[0]!.boards[0]!;
    // The anchored scenario stores one connection layout, so a reload presents it.
    const anchored = scenario === 'flow-anchored'
      ? 'connections:' + String.fromCharCode(10) + '  - from: explore' + String.fromCharCode(10) + '    to: propose' + String.fromCharCode(10) + '    source: {side: top, at: 2}' + String.fromCharCode(10)
      : scenario === 'flow-orphan'
        ? 'connections:' + String.fromCharCode(10) + '  - from: explore' + String.fromCharCode(10) + '    to: apply' + String.fromCharCode(10) + '    source: {side: top, at: 0}' + String.fromCharCode(10)
        : '';
    // The off-grid scenario stores a placement that is not on the snapping lattice.
    const positioned = scenario === 'flow-offgrid'
      ? board.workflowYaml.replace('  - id: explore', '  - id: explore' + String.fromCharCode(10) + '    position: {x: 13, y: 7}')
      : scenario === 'flow-placed'
        ? board.workflowYaml
          .replace('  - id: explore', '  - id: explore' + String.fromCharCode(10) + '    position: {x: 0, y: 0}')
          .replace('  - id: propose', '  - id: propose' + String.fromCharCode(10) + '    position: {x: 400, y: 200}')
          .replace('  - id: apply', '  - id: apply' + String.fromCharCode(10) + '    position: {x: 800, y: 300}')
        // A third stage sits between the two connected stages, so the automatic
        // route crosses its region and the selected copy must paint above it.
        : scenario === 'flow-crossing'
          ? board.workflowYaml
            .replace('  - id: explore', '  - id: explore' + String.fromCharCode(10) + '    position: {x: 0, y: 0}')
            .replace('  - id: propose', '  - id: propose' + String.fromCharCode(10) + '    position: {x: 800, y: 0}')
            .replace('  - id: apply', '  - id: apply' + String.fromCharCode(10) + '    position: {x: 300, y: 0}')
          : board.workflowYaml;
    board.workflowYaml = 'default_view: workflow' + String.fromCharCode(10) + positioned + anchored;
    board.workflow = parseWorkflow(board.workflowYaml);
  });
}

/** The drawer creates a conversation from a preset card, so the notice scenario supplies a host roster. */
const harnessPresetPort = { list: async () => [{ id: 'standard', name: 'Standard', description: 'Balanced coding agent', isDefault: true }], select: async () => ({ ok: true }) };

function BoardModelNoticeScenario() {
  // One stored snapshot: a fresh object per read would spin React's store.
  const source = useMemo<AgentPresetPortSource>(() => ({ getSnapshot: () => harnessPresetPort, subscribe: () => () => {} }), []);
  return <AgentPresetProvider source={source}><div className="dsh-kanban" style={{ height: '100%' }}><BoardView api={harness.api} renderConversation={id => <div data-native={id} />} /></div></AgentPresetProvider>;
}

function WorkflowScenario() {
  const [snapshot, setSnapshot] = useState<TestSnapshot>(harness.snapshot());
  const run = async (command: Command) => { const next = await harness.api.command(command); setSnapshot(next as TestSnapshot); return next; };
  return <Configuration state={snapshot.state} hub={snapshot.state.hubs[0]!} board={snapshot.state.hubs[0]!.boards[0]!} hubCount={1} settings={snapshot.state.settings} settingsRevision={snapshot.state.settings.revision} run={run} api={harness.api} {...(sharingViews.hub === undefined ? {} : { sharing: sharingViews.hub })} initial="Board" onClose={() => {}} />;
}


function PublishingScenario({ auth }: { auth?: { status: 'connected'; email: string } }) {
  const [snapshot, setSnapshot] = useState<TestSnapshot>(harness.snapshot());
  const [sharing, setSharing] = useState<HubSharingView | undefined>(sharingViews.hub);
  const run = async (command: Command) => { const next = await harness.api.command(command); setSnapshot(next as TestSnapshot); return next; };
  // The fake host models connect and change-location outcomes; mirror them into
  // the rendered surface so the preview and connected states are exercised.
  const api: ClientApi = {
    ...harness.api,
    sharing: async command => {
      const next = await harness.api.sharing(command);
      setSnapshot(next as TestSnapshot);
      setSharing(next.sharing.hub);
      return next;
    },
  };
  return <Configuration state={snapshot.state} hub={snapshot.state.hubs[0]!} board={snapshot.state.hubs[0]!.boards[0]!} hubCount={1} settings={snapshot.state.settings} settingsRevision={snapshot.state.settings.revision} run={run} api={api} {...(sharing === undefined ? {} : { sharing })} {...(auth === undefined ? {} : { sharingAuth: auth })} initial="Team Settings" onClose={() => {}} />;
}

function RelocationEditorScenario() {
  const [snapshot, setSnapshot] = useState<TestSnapshot>(harness.snapshot());
  const [sent, setSent] = useState('');
  const hub = snapshot.state.hubs[0]!;
  const project = hub.projects[0]!;
  const run = async (command: Command) => {
    setSent(command.type + (command.type === 'project.relocate' ? ':' + command.project.projectPath : ''));
    const next = await harness.api.command(command);
    setSnapshot(next as TestSnapshot);
    return next;
  };
  return <DirectoryPickerProvider picker={{ pick: async () => '/moved/repo' }}>
    <ProjectEditorDialog
      api={harness.api}
      project={project}
      tasks={hub.tasks}
      expectedRevision={hub.revision}
      isConversationActive={sessionId => (snapshot.conversationAttention?.[sessionId]?.running ?? false)}
      run={run}
      onClose={() => {}}
      onSaved={() => {}}
    />
    <p role="status" data-sent={sent}>{sent}</p>
  </DirectoryPickerProvider>;
}

function SchedulesScenario() {
  const [snapshot, setSnapshot] = useState<TestSnapshot>(harness.snapshot());
  const [opened, setOpened] = useState('');
  const hub = snapshot.state.hubs[0]!;
  const run = async (command: Command) => { const next = await harness.api.command(command); setSnapshot(next as TestSnapshot); return next; };
  return <div className="dsh-kanban" style={{ height: '100%' }}>
    <Configuration
      state={snapshot.state as unknown as BoardState}
      hub={hub}
      board={null}
      hubCount={1}
      settings={snapshot.state.settings}
      settingsRevision={snapshot.state.settings.revision}
      run={run}
      api={harness.api}
      scheduleRuntime={snapshot.scheduleRuntime?.[hub.id]}
      onOpenSession={sessionId => setOpened(sessionId)}
      initial="Schedules"
      onClose={() => {}}
    />
    <p role="status" data-opened={opened}>{opened}</p>
  </div>;
}

function RelocationListScenario() {
  const [snapshot, setSnapshot] = useState<TestSnapshot>(harness.snapshot());
  const hub = snapshot.state.hubs[0]!;
  const run = async (command: Command) => { const next = await harness.api.command(command); setSnapshot(next as TestSnapshot); return next; };
  return <div className="dsh-kanban" style={{ height: '100%' }}>
    <Configuration
      state={snapshot.state as unknown as BoardState}
      hub={hub}
      board={null}
      hubCount={1}
      settingsRevision={1}
      run={run}
      api={harness.api}
      conversationAttention={snapshot.conversationAttention}
      initial="Projects"
      onClose={() => {}}
    />
  </div>;
}

function ProjectEditorScenario() {
  const [, setSnapshot] = useState<TestSnapshot>(harness.snapshot());
  const run = async (command: Command) => { const next = await harness.api.command(command); setSnapshot(next as TestSnapshot); return next; };
  return <DirectoryPickerProvider picker={{ pick: async () => '/repo/apps/web' }}><ProjectEditorDialog api={harness.api} run={run} onClose={() => {}} onSaved={() => {}} /></DirectoryPickerProvider>;
}

function TaskMessageScenario() {
  const messageText = 'Message from task "Prepare release" (task-1) in Hub "Product Hub" on board "Delivery".\nTo reply, use send_task_message with task_id "task-1", and only when this message asks for a reply or the user asks you to.\n\nPlease reply with the deployment window.';
  const node = {
    key: 'task-message', kind: TASK_MESSAGE_NODE_KIND, id: 'message-1', target: 'chat', anchorSeq: 1,
    location: { kind: 'unresolved' }, visibility: 'visible', groupTree: 'turn',
    data: {
      seq: 1, time: 1, content: [{ type: 'text', text: messageText }],
      source: { kind: 'task-message', form: 'notice', summary: 'Task message from Prepare release' },
      producer: { role: 'inject', label: 'task-message' }, form: 'notice',
    },
  } as never;
  // A minimal stand-in for the host's native context row, so the screenshot shows
  // the delegated disclosure chrome rather than only the inline fallback.
  function NativeRow(props: Record<string, unknown>) {
    const data = (props.node as { data: { content: readonly { type: string; text?: string }[]; source: { summary?: string } } }).data;
    const text = data.content.flatMap(block => block.type === 'text' && block.text !== undefined ? [block.text] : []).join(String.fromCharCode(10));
    return <details className="kb-native-context"><summary>{data.source.summary}</summary><pre style={{ margin: 0, padding: '0 10px 10px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', font: 'inherit' }}>{text}</pre></details>;
  }
  const fallback = query.get('fallback') === '1';
  const slots = {
    entriesOfSlot: () => fallback ? [] : [{ component: NativeRow, options: { key: 'context' } }],
    subscribe: () => () => {},
  } as unknown as NativeSlotSource;
  return <div className="dsh-kanban" style={{ padding: 24, maxWidth: 760 }}>
    <TaskMessageNodeView node={node} t={((key: string) => key) as never} slots={slots} />
  </div>;
}

const questionCase = new URLSearchParams(window.location.search).get('case') ?? 'default';
const round: QuestionRound = {
  id: 'round-1', sessionId: 'session-1', turnId: '1', complete: true, answered: false,
  pages: [{ callId: 'call-1', sequence: 0, page: { question: 'Which **storage** should we use?', type: 'exclusive', options: [{ title: 'Local', description: 'Keep it local.' }, { title: 'Remote', description: 'Use a service.' }] } }],
};
const secondPage: RoundPage = { callId: 'call-2', sequence: 1, page: { question: 'Which **theme** should we use?', type: 'freetext' } };
function QuestionScenario() {
  const [value, setValue] = useState<QuestionRound>(() => ({ ...round, complete: questionCase !== 'waiting' && questionCase !== 'new-page' }));
  const [hidden, setHidden] = useState(questionCase === 'hidden');
  const storedDraft: StoredQuestionDraft | undefined = questionCase === 'draft' ? {
    answers: { 'call-1': { choices: ['Local'], text: '', other: '', notes: 'Restored from the host.' } },
    generalNotes: 'Restored Additional Notes.',
    active: { kind: 'page', callId: 'call-1' },
    updatedAt: '2026-11-12T10:00:00.000Z',
  } : undefined;
  return <div style={{ padding: 20, width: 380 }}>
    <QuestionForm round={value} hidden={hidden} {...(storedDraft === undefined ? {} : { storedDraft })} onSubmit={() => { if (questionCase === 'submit') setHidden(true); }} onDismiss={() => {}} />
    {questionCase === 'new-page' && <button type="button" onClick={() => setValue(previous => ({ ...previous, pages: [...previous.pages, secondPage] }))}>Add page</button>}
  </div>;
}

/**
 * Mounts the board with a control that hides and shows it, so a spec can prove a
 * dismissal survives the panel switch that used to undo it.
 */
function RetainedScenario() {
  const [shown, setShown] = useState(true);
  return <>
    <button type="button" onClick={() => setShown(previous => !previous)}>{shown ? 'Hide board' : 'Show board'}</button>
    {shown && <BoardView api={harness.api} renderConversation={id => <div data-native={id} />} />}
  </>;
}

function ThemeSync() {
  React.useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => document.body.toggleAttribute('data-ds-dark-theme', media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);
  return null;
}

function App() {
  if (scenario === 'deterministic') return <><style>{themeFixture}</style><style>{styles}</style><ThemeSync /><BoardView api={harness.api} renderConversation={id => <div data-native={id} />} /></>;
  if (scenario === 'handoff') return <><style>{themeFixture}</style><ThemeSync /><div className="dsh-kanban" style={{ padding: 24 }}><DeterministicHandoffNodeView node={{ data: { seq: 1, time: 1, content: [{ type: 'text', text: 'Deterministic result from CI · Execution synthetic-run · Exit passed\nCI passed. [REDACTED]' }], source: { kind: 'deterministic-handoff', form: 'notice', summary: 'CI → Manual review' }, producer: { role: 'inject', label: 'deterministic-handoff' }, form: 'notice' } } as never} slots={{ entriesOfSlot: () => [], subscribe: () => () => {} }} t={((key: string) => key) as never} /></div></>;
  if (scenario === 'history' || scenario === 'history-long') return <><style>{themeFixture}</style><style>{styles}</style><ThemeSync /><div className="dsh-kanban" style={{ height: '100%' }}><BoardView api={harness.api} renderConversation={id => <div data-native={id} />} /></div></>;
  if (scenario === 'hubs') return <><style>{themeFixture}</style><style>{styles}</style><ThemeSync /><div className="dsh-kanban" style={{ height: '100%' }}><BoardView api={harness.api} renderConversation={id => <div data-native={id} />} /></div></>;
  if (scenario === 'appearance' || scenario === 'notes' || scenario === 'presence') return <><style>{themeFixture}</style><ThemeSync /><BoardView api={harness.api} renderConversation={id => <div data-native={id} />} onMarkAllRead={() => {}} /></>;
  if (scenario === 'move') return <><style>{themeFixture}</style><ThemeSync /><BoardView api={harness.api} renderConversation={id => <div data-native={id} />} /></>;
  if (scenario === 'prepare' || scenario === 'prepare-restricted') return <><style>{themeFixture}</style><ThemeSync /><BoardView api={harness.api} renderConversation={id => <div data-native={id} />} /></>;
  if (scenario === 'stage-idle') return <><style>{themeFixture}</style><style>{styles}</style><ThemeSync /><div className="dsh-kanban" style={{ height: '100%' }}><BoardView api={harness.api} renderConversation={id => <div data-native={id} />} /></div></>;
  if (scenario === 'auto' || scenario === 'agent-pause' || scenario === 'declared' || scenario === 'declared-failed') return <><style>{themeFixture}</style><ThemeSync /><BoardView api={harness.api} renderConversation={id => <div data-native={id} />} /></>;
  if (scenario === 'routed') return <><style>{themeFixture}</style><ThemeSync /><BoardView api={harness.api} renderConversation={id => <div data-native={id} />} /></>;
  if (scenario === 'stale-route') return <><style>{themeFixture}</style><ThemeSync /><BoardView api={harness.api} renderConversation={id => <div data-native={id} />} /></>;
  if (scenario === 'project-relocation') return <><style>{themeFixture}</style><style>{styles}</style><ThemeSync /><div className="dsh-kanban" style={{ height: '100%' }}><RelocationEditorScenario /></div></>;
  if (scenario === 'relocation-list') return <><style>{themeFixture}</style><style>{styles}</style><ThemeSync /><RelocationListScenario /></>;
  if (scenario === 'schedules') return <><style>{themeFixture}</style><style>{styles}</style><ThemeSync /><SchedulesScenario /></>;
  if (scenario === 'project-editor') return <><style>{themeFixture}</style><style>{styles}</style><ThemeSync /><div className="dsh-kanban" style={{ height: '100%' }}><ProjectEditorScenario /></div></>;
  if (scenario === 'workflow') return <><style>{styles}</style><div className="dsh-kanban" style={{ height: '100%' }}><WorkflowScenario /></div></>;
  if (scenario === 'board-model') return <><style>{themeFixture}</style><style>{styles}</style><ThemeSync /><div className="dsh-kanban" style={{ height: '100%' }}><WorkflowScenario /></div></>;
  if (scenario === 'board-model-notice') return <><style>{themeFixture}</style><style>{styles}</style><ThemeSync /><BoardModelNoticeScenario /></>;
  if (flowScenario) return themed
    ? <><style>{themeFixture}</style><style>{styles}</style><ThemeSync /><div className="dsh-kanban" style={{ height: '100%' }}><BoardView api={harness.api} renderConversation={id => <div data-native={id} />} onMarkAllRead={() => {}} /></div></>
    : <><style>{styles}</style><div className="dsh-kanban" style={{ height: '100%' }}><BoardView api={harness.api} renderConversation={id => <div data-native={id} />} /></div></>;
  if (scenario === 'publishing' && themed) return <><style>{themeFixture}</style><style>{styles}</style><ThemeSync /><div className="dsh-kanban" style={{ height: '100%' }}><PublishingScenario auth={sharingAuth} /></div></>;
  if (scenario === 'publishing') return <><style>{styles}</style><div className="dsh-kanban" style={{ height: '100%' }}><PublishingScenario auth={sharingAuth} /></div></>;
  if (scenario === 'relocation-board') return <><style>{themeFixture}</style><style>{styles}</style><ThemeSync /><div className="dsh-kanban" style={{ height: '100%' }}><BoardView api={harness.api} renderConversation={id => <div data-native={id} />} /></div></>;
  if (scenario === 'retained' || scenario === 'retained-many') return <><style>{themeFixture}</style><style>{styles}</style><ThemeSync /><div className="dsh-kanban" style={{ height: '100%' }}><RetainedScenario /></div></>;
  if (scenario === 'sharing') return <><style>{themeFixture}</style><style>{styles}</style><ThemeSync /><div className="dsh-kanban" style={{ height: '100%' }}><BoardView api={harness.api} renderConversation={id => <div data-native={id} />} /></div></>;
  if (scenario === 'question') return <><style>{themeFixture}</style><style>{styles}</style><ThemeSync /><div className="dsh-kanban"><QuestionScenario /></div></>;
  if (scenario === 'task-message') return <><style>{themeFixture}</style><style>{styles}</style><ThemeSync /><div className="dsh-kanban" style={{ height: '100%' }}><TaskMessageScenario /></div></>;
  return <BoardView api={harness.api} renderConversation={id => <div data-native={id} />} />;
}

createRoot(document.getElementById('root')!).render(<App />);
(window as unknown as { __harnessCommands: () => readonly Command[] }).__harnessCommands = () => harness.commands();
(window as unknown as { __harnessReady: boolean }).__harnessReady = true;
