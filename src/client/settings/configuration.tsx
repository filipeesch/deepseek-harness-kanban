import React, { useEffect, useId, useState } from 'react';
import type { Attention, Board, BoardState, ClientApi, HubSharingView, HubState, KanbanSettings, Project, SharingAuthView, Task } from '../../shared/types.js';
import { hubProjectView } from '../board-projection.js';
import { ProjectEditorDialog } from '../projects/project-editor-dialog.js';
import { ProjectList } from '../projects/project-list.js';
import { Modal, Tabs, type RunCommand } from '../ui.js';
import { BoardSettings } from './board-settings.js';
import { GeneralSettings } from './general-settings.js';
import { HubSettings } from './hub-settings.js';
import { TeamSettings } from './team-settings/team-settings.js';

interface Section { id: string; render: () => React.ReactNode }

export function Configuration({ state, hub, board, hubCount, settings, settingsRevision, run, api, sharing, sharingAuth, conversationAttention, onClose, initial = 'General', onHubDeleted, onBoardDeleted, onBoardCreated }: {
  state: BoardState | null; hub: HubState | null; board: Board | null; hubCount: number;
  settings?: KanbanSettings; settingsRevision: number; run: RunCommand; api?: ClientApi; sharing?: HubSharingView; sharingAuth?: SharingAuthView; conversationAttention?: Record<string, Attention>;
  onClose: () => void; initial?: string; onHubDeleted?: () => void; onBoardDeleted?: () => void; onBoardCreated?: (id: string) => void;
}) {
  const id = useId();
  const [section, setSection] = useState(initial);
  const [workflowDraft, setWorkflowDraft] = useState<{ yaml: string; revision: number } | null>(null);
  const [closePending, setClosePending] = useState(false);
  const dirty = Boolean(state && workflowDraft !== null && workflowDraft.yaml !== state.workflowYaml);
  useEffect(() => { if (!dirty) setClosePending(false); }, [dirty]);
  const projectView = state ?? (hub ? hubProjectView(hub) : null);
  const sections: Section[] = [
    { id: 'General', render: () => <GeneralSettings settings={settings} settingsRevision={settingsRevision} run={run} /> },
    { id: 'Hub', render: () => hub ? <HubSettings hub={hub} hubCount={hubCount} run={run} sharing={sharing} onDeleted={onHubDeleted} onBoardCreated={onBoardCreated} /> : <p className="kb-hint">No Hub is selected.</p> },
    { id: 'Projects', render: () => projectView ? <ProjectsSection projects={projectView.projects} tasks={hub?.tasks ?? projectView.tasks} revision={projectView.revision} run={run} api={api} hubId={hub?.id} conversationAttention={conversationAttention} /> : <p className="kb-hint">No Hub is selected.</p> },
    ...(state && board ? [{ id: 'Board', render: () => <BoardSettings state={state} hub={hub} board={board} run={run} api={api} sharing={sharing} onDeleted={onBoardDeleted} workflowDraft={workflowDraft} setWorkflowDraft={setWorkflowDraft} /> }] : []),
    { id: 'Team Settings', render: () => hub ? <TeamSettings key={hub.id} hub={hub} sharing={sharing} auth={sharingAuth} api={api} /> : <p className="kb-hint">No Hub is selected.</p> },
  ];
  const selected = sections.some(value => value.id === section) ? section : 'General';
  const current = sections.find(value => value.id === selected) ?? sections[0]!;
  function requestClose() {
    if (closePending) { setClosePending(false); return; }
    if (dirty) { setClosePending(true); return; }
    onClose();
  }
  return <Modal title="Kanban configuration" onClose={requestClose} size={selected === 'Board' ? 'wide' : 'default'}>
    <Tabs label="Configuration sections" values={sections.map(value => value.id)} selected={selected} onSelect={setSection} id={id} />
    {closePending && <div className="kb-inline-confirm" role="alertdialog" aria-label="Discard workflow changes">
      <p>You have unsaved workflow changes. Discard them and close configuration?</p>
      <div className="kb-actions"><button type="button" className="kb-button" onClick={() => setClosePending(false)}>Keep editing</button><button type="button" className="kb-button kb-danger" onClick={onClose}>Discard and close</button></div>
    </div>}
    <section className="kb-panel" role="tabpanel" id={id + '-panel-' + selected} aria-labelledby={id + '-tab-' + selected}>
      {current.render()}
    </section>
  </Modal>;
}

function ProjectsSection({ projects, tasks, revision, run, api, hubId, conversationAttention }: { projects: Project[]; tasks: Task[]; revision: number; run: RunCommand; api?: ClientApi; hubId?: string; conversationAttention?: Record<string, Attention> }) {
  const [editing, setEditing] = useState<{ project?: Project } | null>(null);
  const [saved, setSaved] = useState<'saved' | 'relocated' | null>(null);
  return <div className="kb-form">
    <ProjectList projects={projects} tasks={tasks} revision={revision} run={run} onAdd={() => { setEditing({}); setSaved(null); }} onEdit={project => { setEditing({ project }); setSaved(null); }} />
    {saved === 'saved' && <p role="status">Project saved.</p>}
    {saved === 'relocated' && <p role="status">Relocation accepted. Its progress is shown in the project row.</p>}
    {editing && <ProjectEditorDialog
      {...(api === undefined ? {} : { api })}
      {...(hubId === undefined ? {} : { hubId })}
      expectedRevision={revision}
      {...(editing.project === undefined ? {} : { project: editing.project })}
      tasks={tasks}
      isConversationActive={sessionId => { const attention = conversationAttention?.[sessionId]; return attention !== undefined && (attention.running || attention.background.length > 0); }}
      run={run}
      onClose={() => setEditing(null)}
      onSaved={(_id, outcome) => { setEditing(null); setSaved(outcome === 'save' ? 'saved' : 'relocated'); }}
    />}
  </div>;
}
