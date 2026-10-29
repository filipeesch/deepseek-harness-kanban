import React, { useEffect, useId, useState } from 'react';
import type { Board, BoardState, ClientApi, HubState, KanbanSettings, Project, Task } from '../../shared/types.js';
import { hubProjectView } from '../hub-view.js';
import { ProjectEditorDialog } from '../projects/project-editor-dialog.js';
import { ProjectList } from '../projects/project-list.js';
import { Modal, Tabs, type RunCommand } from '../ui.js';
import { BoardSettings } from './board-settings.js';
import { GeneralSettings } from './general-settings.js';
import { HubSettings } from './hub-settings.js';

export function Configuration({ state, hub, board, hubCount, settings, settingsRevision, run, api, onClose, initial = 'General', onHubDeleted, onBoardDeleted, onBoardCreated }: {
  state: BoardState | null; hub: HubState | null; board: Board | null; hubCount: number;
  settings?: KanbanSettings; settingsRevision: number; run: RunCommand; api?: ClientApi;
  onClose: () => void; initial?: string; onHubDeleted?: () => void; onBoardDeleted?: () => void; onBoardCreated?: (id: string) => void;
}) {
  const sections = board ? ['General', 'Hub', 'Projects', 'Board'] : ['General', 'Hub', 'Projects'];
  const [section, setSection] = useState(sections.includes(initial) ? initial : 'General'); const id = useId();
  const [workflowDraft, setWorkflowDraft] = useState<{ yaml: string; revision: number } | null>(null);
  const [closePending, setClosePending] = useState(false);
  const dirty = Boolean(state && workflowDraft !== null && workflowDraft.yaml !== state.workflowYaml);
  useEffect(() => { if (!dirty) setClosePending(false); }, [dirty]);
  function requestClose() {
    if (closePending) { setClosePending(false); return; }
    if (dirty) { setClosePending(true); return; }
    onClose();
  }
  const projectView = state ?? (hub ? hubProjectView(hub) : null);
  return <Modal title="Kanban configuration" onClose={requestClose} size={section === 'Board' ? 'wide' : 'default'}>
    <Tabs label="Configuration sections" values={sections} selected={section} onSelect={setSection} id={id} />
    {closePending && <div className="kb-inline-confirm" role="alertdialog" aria-label="Discard workflow changes">
      <p>You have unsaved workflow changes. Discard them and close configuration?</p>
      <div className="kb-actions"><button type="button" className="kb-button" onClick={() => setClosePending(false)}>Keep editing</button><button type="button" className="kb-button kb-danger" onClick={onClose}>Discard and close</button></div>
    </div>}
    <section className="kb-panel" role="tabpanel" id={id + '-panel-' + section} aria-labelledby={id + '-tab-' + section}>
      {section === 'General' ? <GeneralSettings settings={settings} settingsRevision={settingsRevision} run={run} />
        : section === 'Hub' ? (hub ? <HubSettings hub={hub} hubCount={hubCount} run={run} onDeleted={onHubDeleted} onBoardCreated={onBoardCreated} /> : <p className="kb-hint">No Hub is selected.</p>)
        : section === 'Projects' ? (projectView ? <ProjectsSection projects={projectView.projects} tasks={hub?.tasks ?? projectView.tasks} revision={projectView.revision} run={run} api={api} hubId={hub?.id} /> : <p className="kb-hint">No Hub is selected.</p>)
        : state && board ? <BoardSettings state={state} hub={hub} board={board} run={run} onDeleted={onBoardDeleted} workflowDraft={workflowDraft} setWorkflowDraft={setWorkflowDraft} />
        : <p className="kb-hint">Create a board before configuring a workflow.</p>}
    </section>
  </Modal>;
}

function ProjectsSection({ projects, tasks, revision, run, api, hubId }: { projects: Project[]; tasks: Task[]; revision: number; run: RunCommand; api?: ClientApi; hubId?: string }) {
  const [editing, setEditing] = useState<{ project?: Project } | null>(null);
  const [saved, setSaved] = useState(false);
  return <div className="kb-form">
    <ProjectList projects={projects} tasks={tasks} revision={revision} run={run} onAdd={() => { setEditing({}); setSaved(false); }} onEdit={project => { setEditing({ project }); setSaved(false); }} />
    {saved && <p role="status">Project saved.</p>}
    {editing && <ProjectEditorDialog
      {...(api === undefined ? {} : { api })}
      {...(hubId === undefined ? {} : { hubId })}
      expectedRevision={revision}
      {...(editing.project === undefined ? {} : { project: editing.project })}
      run={run}
      onClose={() => setEditing(null)}
      onSaved={() => { setEditing(null); setSaved(true); }}
    />}
  </div>;
}
