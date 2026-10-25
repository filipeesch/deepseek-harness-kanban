import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BoardView } from '../../src/client/board.js';
import { styles } from '../../src/client/styles.js';
import { Configuration } from '../../src/client/forms.js';
import { QuestionForm } from '../../src/questions/QuestionForm.js';
import type { Command, QuestionRound } from '../../src/shared/types.js';
import { createHarnessApi, type TestSnapshot } from './fake-api.js';
import { themeFixture } from './theme-fixture.js';

const scenario = new URLSearchParams(window.location.search).get('scenario') ?? 'board';
const harness = createHarnessApi({ attention: scenario === 'activity' || scenario === 'appearance' || scenario === 'hubs', hubs: scenario === 'hubs' ? 2 : 1, restricted: scenario === 'move' });
(window as unknown as { __harness: unknown }).__harness = { commands: harness.commands, snapshot: harness.snapshot };

function WorkflowScenario() {
  const [snapshot, setSnapshot] = useState<TestSnapshot>(harness.snapshot());
  const run = async (command: Command) => { const next = await harness.api.command(command); setSnapshot(next as TestSnapshot); return next; };
  return <Configuration state={snapshot.state} hub={snapshot.state.hubs[0]!} board={snapshot.state.hubs[0]!.boards[0]!} hubCount={1} settings={snapshot.state.settings} settingsRevision={snapshot.state.settings.revision} run={run} api={harness.api} initial="Board" onClose={() => {}} />;
}

const round: QuestionRound = {
  id: 'round-1', sessionId: 'session-1', turnId: '1', complete: true, answered: false,
  pages: [{ callId: 'call-1', sequence: 0, page: { question: 'Which **storage** should we use?', type: 'exclusive', options: [{ title: 'Local', description: 'Keep it local.' }, { title: 'Remote', description: 'Use a service.' }] } }],
};
function QuestionScenario() {
  return <div style={{ padding: 20, width: 380 }}><QuestionForm round={round} onSubmit={() => {}} onDismiss={() => {}} /></div>;
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
  if (scenario === 'workflow') return <><style>{styles}</style><div className="dsh-kanban" style={{ height: '100%' }}><WorkflowScenario /></div></>;
  if (scenario === 'question') return <><style>{styles}</style><div className="dsh-kanban"><QuestionScenario /></div></>;
  return <BoardView api={harness.api} renderConversation={id => <div data-native={id} />} />;
}

createRoot(document.getElementById('root')!).render(<App />);
(window as unknown as { __harnessReady: boolean }).__harnessReady = true;
