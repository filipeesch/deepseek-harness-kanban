import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BoardView } from '../../src/client/board.js';
import { styles } from '../../src/client/styles.js';
import { Configuration } from '../../src/client/settings/configuration.js';
import { ProjectEditorDialog } from '../../src/client/projects/project-editor-dialog.js';
import { DirectoryPickerProvider } from '../../src/client/services.js';
import { QuestionForm } from '../../src/questions/QuestionForm.js';
import type { Command, QuestionRound, RoundPage } from '../../src/shared/types.js';
import { createHarnessApi, type TestSnapshot } from './fake-api.js';
import { themeFixture } from './theme-fixture.js';

const scenario = new URLSearchParams(window.location.search).get('scenario') ?? 'board';
const harness = createHarnessApi({ attention: scenario === 'activity' || scenario === 'appearance' || scenario === 'hubs', hubs: scenario === 'hubs' ? 2 : 1, restricted: scenario === 'move', persist: scenario === 'board', pending: scenario === 'appearance', detect: scenario === 'project-editor' ? 'git' : 'folder' });
(window as unknown as { __harness: unknown }).__harness = { commands: harness.commands, snapshot: harness.snapshot };

function WorkflowScenario() {
  const [snapshot, setSnapshot] = useState<TestSnapshot>(harness.snapshot());
  const run = async (command: Command) => { const next = await harness.api.command(command); setSnapshot(next as TestSnapshot); return next; };
  return <Configuration state={snapshot.state} hub={snapshot.state.hubs[0]!} board={snapshot.state.hubs[0]!.boards[0]!} hubCount={1} settings={snapshot.state.settings} settingsRevision={snapshot.state.settings.revision} run={run} api={harness.api} initial="Board" onClose={() => {}} />;
}


function ProjectEditorScenario() {
  const [, setSnapshot] = useState<TestSnapshot>(harness.snapshot());
  const run = async (command: Command) => { const next = await harness.api.command(command); setSnapshot(next as TestSnapshot); return next; };
  return <DirectoryPickerProvider picker={{ pick: async () => '/repo/apps/web' }}><ProjectEditorDialog api={harness.api} run={run} onClose={() => {}} onSaved={() => {}} /></DirectoryPickerProvider>;
}

function NativeComposerScenario() {
  return <div className="dsh-kanban" style={{ height: 600 }}>
    <div className="kb-session-frame" style={{ height: '100%' }}>
      <div className="kb-native-session-header" style={{ height: 52 }}>header</div>
      <div className="kb-native-conversation">
        <div data-conversation-content="" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <div data-conversation-scroll="" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <div data-conversation-session="" style={{ flex: '1 0 auto', minHeight: 0 }} />
            <div data-composer-seat="" style={{ flex: 'none', height: 80 }}>composer</div>
          </div>
        </div>
      </div>
    </div>
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
  if (scenario === 'appearance') return <><style>{themeFixture}</style><ThemeSync /><BoardView api={harness.api} renderConversation={id => <div data-native={id} />} /></>;
  if (scenario === 'move') return <><style>{themeFixture}</style><ThemeSync /><BoardView api={harness.api} renderConversation={id => <div data-native={id} />} /></>;
  if (scenario === 'project-editor') return <><style>{themeFixture}</style><style>{styles}</style><ThemeSync /><div className="dsh-kanban" style={{ height: '100%' }}><ProjectEditorScenario /></div></>;
  if (scenario === 'native-composer') return <><style>{styles}</style><NativeComposerScenario /></>;
  if (scenario === 'workflow') return <><style>{styles}</style><div className="dsh-kanban" style={{ height: '100%' }}><WorkflowScenario /></div></>;
  if (scenario === 'question') return <><style>{themeFixture}</style><style>{styles}</style><ThemeSync /><div className="dsh-kanban"><QuestionScenario /></div></>;
  return <BoardView api={harness.api} renderConversation={id => <div data-native={id} />} />;
}

createRoot(document.getElementById('root')!).render(<App />);
(window as unknown as { __harnessReady: boolean }).__harnessReady = true;
