import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BoardView } from '../../src/client/board.js';
import { styles } from '../../src/client/styles/index.js';
import { Configuration } from '../../src/client/settings/configuration.js';
import { ProjectEditorDialog } from '../../src/client/projects/project-editor-dialog.js';
import { DirectoryPickerProvider } from '../../src/client/services.js';
import { QuestionForm } from '../../src/questions/QuestionForm.js';
import type { BoardState, ClientApi, Command, HubSharingView, QuestionRound, RoundPage } from '../../src/shared/types.js';
import { createHarnessApi, workflowYaml, type TestSnapshot } from './fake-api.js';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { themeFixture } from './theme-fixture.js';

const scenario = new URLSearchParams(window.location.search).get('scenario') ?? 'board';
const sharingCase = new URLSearchParams(window.location.search).get('sharing');
const flowScenario = scenario === 'flow' || scenario === 'flow-anchored' || scenario === 'flow-orphan' || scenario === 'flow-offgrid' || scenario === 'flow-restricted' || scenario === 'flow-restricted-next';
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
const harness = createHarnessApi({ idle: scenario === 'stage-idle', ...(scenario === 'schedules' ? { schedules: scheduleFixtures, scheduleRuntime: scheduleRuntimeFixture } : {}), recorded: scenario === 'routed', staleRoute: scenario === 'stale-route', attention: scenario === 'activity' || scenario === 'appearance' || scenario === 'hubs' || scenario === 'project-relocation', hubs: scenario === 'hubs' ? 2 : 1, initialInstruction: scenario === 'create', restricted: scenario === 'move' || scenario === 'prepare-restricted' || scenario === 'flow-restricted', ...(scenario === 'restricted-next' || scenario === 'flow-restricted-next' ? { restrictedNext: true } : {}), persist: scenario === 'board' || scenario === 'relocation-board', pending: scenario === 'appearance', auto: scenario === 'auto', detect: scenario === 'project-editor' || scenario === 'project-relocation' ? 'git' : 'folder', notes: scenario === 'notes', sharing: sharingViews, ...(driveCase === null ? {} : { drive: driveCase }), shareFailure: sharingCase === 'share-fail', shareRefusal: sharingCase === 'refuse-error', folderRefusal: refuse === 'folder', ...(scenario === 'prepare' ? { prepare: 'plain' as const } : scenario === 'prepare-restricted' ? { prepare: 'restricted' as const } : {}), ...(scenario === 'retained' ? { retained: [{ path: '/worktrees/gone', projectId: 'p', taskTitle: 'Moved repo' }] } : {}), ...(scenario === 'relocation-list' ? { relocation: ['waiting', 'failed', 'waiting'] as Array<'waiting' | 'failed' | null> } : scenario === 'relocation-board' ? { relocation: ['waiting', 'failed'] as Array<'waiting' | 'failed' | null> } : {}), ...(scenario === 'relocation-list' ? { extraProject: true } : {}) });

function harnessSharing(kind: string): HubSharingView {
  const view: HubSharingView = {
    status: 'published', provider: 'git', providerLabel: 'Git repository', supportsFiles: true, repository: 'https://example.test/team.git', address: 'https://example.test/team.git', syncMode: 'explicit', intervalMinutes: 5, lastCheckedAt: '2026-10-21T00:05:00Z',
    drafts: 0, pending: 0, updates: 0, conflicts: 0, orderChanged: false, syncing: false,
    boards: [{ boardId: 'board', key: 'harness-board', name: 'Harness board', state: 'in-sync', bound: true, pending: false }],
    incoming: [], removed: [], blockers: [], removing: [],
  };
  if (kind === 'draft') return { ...view, drafts: 1, boards: [{ ...view.boards[0]!, state: 'draft' }] };
  if (kind === 'updates') return { ...view, status: 'updates-available', updates: 2, boards: [{ ...view.boards[0]!, state: 'updates-available', pending: true }], incoming: [{ key: 'team-board', name: 'Team board' }] };
  if (kind === 'review') return { ...view, status: 'needs-review', conflicts: 1, boards: [{ ...view.boards[0]!, state: 'needs-review', detail: { local: workflowYaml(), team: workflowYaml(true), localName: 'Harness board', teamName: 'Team board' } }] };
  if (kind === 'orphan') return { ...view, boards: [{ ...view.boards[0]!, state: 'orphan' }] };
  if (kind === 'pending-orphan') return { ...view, status: 'updates-available', updates: 1, boards: [{ ...view.boards[0]!, state: 'orphan', pending: true }] };
  if (kind === 'collision') return { ...view, status: 'needs-review', conflicts: 1, boards: [{ boardId: 'board', name: 'Harness board', state: 'needs-review', bound: false, pending: false }] };
  if (kind === 'mixed') return { ...view, status: 'updates-available', updates: 1, drafts: 1, boards: [{ ...view.boards[0]!, state: 'draft' }] };
  if (kind === 'removal') return { ...view, status: 'updates-available', updates: 1, removing: [{ boardId: 'old-board', name: 'Old board' }] };
  if (kind === 'removed') return { ...view, removed: [{ boardId: 'old-board', key: 'old-board', name: 'Old board' }] };
  if (kind === 'unavailable') return { ...view, status: 'unavailable', error: { code: 'SHARING_UNREACHABLE', message: 'The team repository could not be reached.' } };
  if (kind === 'preview') return { ...view, status: 'preview', updates: 1, drafts: 1, boards: [{ ...view.boards[0]!, state: 'updates-available', pending: true, detail: { local: workflowYaml(), team: workflowYaml(true), localName: 'Harness board', teamName: 'Team board' } }], preview: { publishedBoards: 2, localBoards: 1 } };
  if (kind.startsWith('drive-local')) {
    const local = { ...view, provider: 'google-drive-local' as const, providerLabel: 'Google Drive Local', address: 'member@example.test / Projetos', syncMode: 'continuous' as const, intervalMinutes: 1, pending: 0, lastSyncedAt: '2026-10-21T00:05:00Z' };
    if (kind === 'drive-local-unavailable') return { ...local, status: 'unavailable', error: { code: 'SHARING_DRIVE_MOUNT_UNAVAILABLE', message: 'The Google Drive location is no longer mounted on this machine.' } };
    if (kind === 'drive-local-review') return { ...local, status: 'needs-review', conflicts: 1, blockers: [{ code: 'SHARING_CONFLICT_COPY', message: 'Another copy of the team document is in this folder: kanban-hub (1).yaml. Review the copies before synchronizing.' }], boards: [{ ...local.boards[0]!, state: 'needs-review' }] };
    return local;
  }
  if (kind.startsWith('drive')) {
    const drive = { ...view, provider: 'google-drive' as const, providerLabel: 'Google Drive', supportsFiles: false, address: 'Team drive / Hub', syncMode: 'continuous' as const, authorization: 'connected' as const, pending: 0, lastSyncedAt: '2026-10-21T00:05:00Z' };
    if (kind === 'drive-preview') return { ...drive, status: 'preview', updates: 1, drafts: 1, boards: [{ ...drive.boards[0]!, state: 'updates-available', pending: true, detail: { local: workflowYaml(), team: workflowYaml(true), localName: 'Harness board', teamName: 'Team board' } }], preview: { publishedBoards: 2, localBoards: 1 } };
    if (kind === 'drive-review') return { ...drive, status: 'needs-review', conflicts: 1, boards: [{ ...drive.boards[0]!, state: 'needs-review', detail: { local: workflowYaml(), team: workflowYaml(true), localName: 'Harness board', teamName: 'Team board' } }] };
    return drive;
  }
  if (kind.startsWith('folder')) {
    const { repository: _repository, ...base } = view;
    const folder = { ...base, provider: 'local-folder' as const, providerLabel: 'Local folder', address: '~/.dsh-kanban/hub', syncMode: 'continuous' as const, intervalMinutes: 1, pending: 0, lastSyncedAt: '2026-10-21T00:05:00Z' };
    if (kind === 'folder-preview') return { ...folder, status: 'preview', updates: 1, drafts: 1, boards: [{ ...folder.boards[0]!, state: 'updates-available', pending: true, detail: { local: workflowYaml(), team: workflowYaml(true), localName: 'Harness board', teamName: 'Team board' } }], preview: { publishedBoards: 2, localBoards: 1 } };
    if (kind === 'folder-review') return { ...folder, status: 'needs-review', blockers: [{ code: 'SHARING_CONFLICT_COPY', message: 'Another copy of the team document is in this folder: kanban-hub (1).yaml. Review the copies before synchronizing.' }] };
    return folder;
  }
  if (kind === 'unavailable-conflict') return { ...view, status: 'unavailable', conflicts: 1, error: { code: 'SHARING_UNREACHABLE', message: 'The team repository could not be reached.' }, boards: [{ ...view.boards[0]!, state: 'needs-review', detail: { local: workflowYaml(), team: workflowYaml(true), localName: 'Harness board', teamName: 'Team board' } }] };
  if (kind === 'unavailable-folder-review') {
    const { repository: _repository, ...base } = view;
    return { ...base, provider: 'local-folder' as const, providerLabel: 'Local folder', address: '~/.dsh-kanban/hub', syncMode: 'continuous' as const, intervalMinutes: 1, status: 'unavailable', error: { code: 'SHARING_FOLDER_MISSING', message: 'The selected folder is not accessible.' }, blockers: [{ code: 'SHARING_CONFLICT_COPY', message: 'Another copy of the team document is in this folder: kanban-hub (1).yaml. Review the copies before synchronizing.' }] };
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
      : board.workflowYaml;
    board.workflowYaml = 'default_view: workflow' + String.fromCharCode(10) + positioned + anchored;
    board.workflow = parseWorkflow(board.workflowYaml);
  });
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

const questionCase = new URLSearchParams(window.location.search).get('case') ?? 'default';
const round: QuestionRound = {
  id: 'round-1', sessionId: 'session-1', turnId: '1', complete: true, answered: false,
  pages: [{ callId: 'call-1', sequence: 0, page: { question: 'Which **storage** should we use?', type: 'exclusive', options: [{ title: 'Local', description: 'Keep it local.' }, { title: 'Remote', description: 'Use a service.' }] } }],
};
const secondPage: RoundPage = { callId: 'call-2', sequence: 1, page: { question: 'Which **theme** should we use?', type: 'freetext' } };
function QuestionScenario() {
  const [value, setValue] = useState<QuestionRound>(() => ({ ...round, complete: questionCase !== 'waiting' && questionCase !== 'new-page' }));
  const [hidden, setHidden] = useState(questionCase === 'hidden');
  return <div style={{ padding: 20, width: 380 }}>
    <QuestionForm round={value} hidden={hidden} onSubmit={() => { if (questionCase === 'submit') setHidden(true); }} onDismiss={() => {}} />
    {questionCase === 'new-page' && <button type="button" onClick={() => setValue(previous => ({ ...previous, pages: [...previous.pages, secondPage] }))}>Add page</button>}
  </div>;
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
  if (scenario === 'hubs') return <><style>{themeFixture}</style><style>{styles}</style><ThemeSync /><div className="dsh-kanban" style={{ height: '100%' }}><BoardView api={harness.api} renderConversation={id => <div data-native={id} />} /></div></>;
  if (scenario === 'appearance' || scenario === 'notes') return <><style>{themeFixture}</style><ThemeSync /><BoardView api={harness.api} renderConversation={id => <div data-native={id} />} /></>;
  if (scenario === 'move') return <><style>{themeFixture}</style><ThemeSync /><BoardView api={harness.api} renderConversation={id => <div data-native={id} />} /></>;
  if (scenario === 'prepare' || scenario === 'prepare-restricted') return <><style>{themeFixture}</style><ThemeSync /><BoardView api={harness.api} renderConversation={id => <div data-native={id} />} /></>;
  if (scenario === 'stage-idle') return <><style>{themeFixture}</style><style>{styles}</style><ThemeSync /><div className="dsh-kanban" style={{ height: '100%' }}><BoardView api={harness.api} renderConversation={id => <div data-native={id} />} /></div></>;
  if (scenario === 'auto') return <><style>{themeFixture}</style><ThemeSync /><BoardView api={harness.api} renderConversation={id => <div data-native={id} />} /></>;
  if (scenario === 'routed') return <><style>{themeFixture}</style><ThemeSync /><BoardView api={harness.api} renderConversation={id => <div data-native={id} />} /></>;
  if (scenario === 'stale-route') return <><style>{themeFixture}</style><ThemeSync /><BoardView api={harness.api} renderConversation={id => <div data-native={id} />} /></>;
  if (scenario === 'project-relocation') return <><style>{themeFixture}</style><style>{styles}</style><ThemeSync /><div className="dsh-kanban" style={{ height: '100%' }}><RelocationEditorScenario /></div></>;
  if (scenario === 'relocation-list') return <><style>{themeFixture}</style><style>{styles}</style><ThemeSync /><RelocationListScenario /></>;
  if (scenario === 'schedules') return <><style>{themeFixture}</style><style>{styles}</style><ThemeSync /><SchedulesScenario /></>;
  if (scenario === 'project-editor') return <><style>{themeFixture}</style><style>{styles}</style><ThemeSync /><div className="dsh-kanban" style={{ height: '100%' }}><ProjectEditorScenario /></div></>;
  if (scenario === 'workflow') return <><style>{styles}</style><div className="dsh-kanban" style={{ height: '100%' }}><WorkflowScenario /></div></>;
  if (flowScenario) return themed
    ? <><style>{themeFixture}</style><style>{styles}</style><ThemeSync /><div className="dsh-kanban" style={{ height: '100%' }}><BoardView api={harness.api} renderConversation={id => <div data-native={id} />} /></div></>
    : <><style>{styles}</style><div className="dsh-kanban" style={{ height: '100%' }}><BoardView api={harness.api} renderConversation={id => <div data-native={id} />} /></div></>;
  if (scenario === 'publishing' && themed) return <><style>{themeFixture}</style><style>{styles}</style><ThemeSync /><div className="dsh-kanban" style={{ height: '100%' }}><PublishingScenario auth={sharingAuth} /></div></>;
  if (scenario === 'publishing') return <><style>{styles}</style><div className="dsh-kanban" style={{ height: '100%' }}><PublishingScenario auth={sharingAuth} /></div></>;
  if (scenario === 'relocation-board') return <><style>{themeFixture}</style><style>{styles}</style><ThemeSync /><div className="dsh-kanban" style={{ height: '100%' }}><BoardView api={harness.api} renderConversation={id => <div data-native={id} />} /></div></>;
  if (scenario === 'retained') return <><style>{themeFixture}</style><style>{styles}</style><ThemeSync /><div className="dsh-kanban" style={{ height: '100%' }}><BoardView api={harness.api} renderConversation={id => <div data-native={id} />} /></div></>;
  if (scenario === 'sharing') return <><style>{themeFixture}</style><style>{styles}</style><ThemeSync /><div className="dsh-kanban" style={{ height: '100%' }}><BoardView api={harness.api} renderConversation={id => <div data-native={id} />} /></div></>;
  if (scenario === 'question') return <><style>{themeFixture}</style><style>{styles}</style><ThemeSync /><div className="dsh-kanban"><QuestionScenario /></div></>;
  return <BoardView api={harness.api} renderConversation={id => <div data-native={id} />} />;
}

createRoot(document.getElementById('root')!).render(<App />);
(window as unknown as { __harnessCommands: () => readonly Command[] }).__harnessCommands = () => harness.commands();
(window as unknown as { __harnessReady: boolean }).__harnessReady = true;
