import React, { useEffect, useId, useState } from 'react';
import type { Attention, Board, BoardState, ClientApi, HubScheduleRuntime, HubSharingView, HubState, KanbanSettings, Project, SharingAuthView, Task } from '../../shared/types.js';
import { hubProjectView } from '../board-projection.js';
import { ProjectEditorDialog } from '../projects/project-editor-dialog.js';
import { ProjectList } from '../projects/project-list.js';
import { Modal, Tabs, type ModalSize, type RunCommand } from '../ui.js';
import type { NativeSeat } from '../native-slot-host.js';
import { BoardSettings } from './board-settings.js';
import { GeneralSettings } from './general-settings.js';
import { HubSettings } from './hub-settings.js';
import { TeamSettings } from './team-settings/team-settings.js';
import { SchedulesSettings } from './schedules/schedules-settings.js';

interface Section { id: string; size: ModalSize; render: () => React.ReactNode }

/**
 * One dialog, one descriptor per section. A section states how wide its surface
 * must be, so the shell never special-cases a section by name and the board's
 * workflow can claim the widest surface without widening every other dialog.
 */
const SECTION_SIZE: Readonly<Record<string, ModalSize>> = {
  General: 'settings', Hub: 'settings', Projects: 'settings', Schedules: 'settings', Board: 'settings-wide', 'Team Settings': 'settings',
};

export function Configuration({ state, hub, board, hubCount, settings, settingsRevision, run, api, sharing, sharingAuth, conversationAttention, scheduleRuntime, onOpenSession, onClose, initial = 'General', onHubDeleted, onBoardDeleted, onBoardCreated, nativeSeat }: {
  state: BoardState | null; hub: HubState | null; board: Board | null; hubCount: number;
  settings?: KanbanSettings; settingsRevision: number; run: RunCommand; api?: ClientApi; sharing?: HubSharingView; sharingAuth?: SharingAuthView; conversationAttention?: Record<string, Attention>;
  scheduleRuntime?: HubScheduleRuntime; onOpenSession?: (sessionId: string) => void;
  onClose: () => void; initial?: string; onHubDeleted?: () => void; onBoardDeleted?: () => void; onBoardCreated?: (id: string) => void;
  /** The native slot registry the board's model selector borrows; absent outside the real client. */
  nativeSeat?: NativeSeat;
}) {
  const id = useId();
  const [section, setSection] = useState(initial);
  const [pendingSection, setPendingSection] = useState<string | null>(null);
  const [boardDirty, setBoardDirty] = useState(false);
  const [workflowDraft, setWorkflowDraft] = useState<{ yaml: string; revision: number } | null>(null);
  const [closePending, setClosePending] = useState(false);
  const dirty = Boolean(state && workflowDraft !== null && workflowDraft.yaml !== state.workflowYaml);
  useEffect(() => { if (!dirty && !boardDirty) setClosePending(false); }, [dirty, boardDirty]);
  const projectView = state ?? (hub ? hubProjectView(hub) : null);
  const sections: Section[] = [
    { id: 'General', size: SECTION_SIZE.General!, render: () => <GeneralSettings settings={settings} settingsRevision={settingsRevision} run={run} /> },
    { id: 'Hub', size: SECTION_SIZE.Hub!, render: () => hub ? <HubSettings hub={hub} hubCount={hubCount} run={run} sharing={sharing} {...(onHubDeleted === undefined ? {} : { onDeleted: onHubDeleted })} {...(onBoardCreated === undefined ? {} : { onBoardCreated })} /> : <p className="kb-hint">No Hub is selected.</p> },
    { id: 'Projects', size: SECTION_SIZE.Projects!, render: () => projectView ? <ProjectsSection projects={projectView.projects} tasks={hub?.tasks ?? projectView.tasks} revision={projectView.revision} run={run} api={api} hubId={hub?.id} conversationAttention={conversationAttention} /> : <p className="kb-hint">No Hub is selected.</p> },
    { id: 'Schedules', size: SECTION_SIZE.Schedules!, render: () => hub ? <SchedulesSettings hub={hub} runtime={scheduleRuntime} {...(api === undefined ? {} : { api })} run={run} {...(onOpenSession === undefined ? {} : { onOpenSession })} {...(nativeSeat === undefined ? {} : { nativeSeat })} /> : <p className="kb-hint">No Hub is selected.</p> },
    ...(state && board ? [{ id: 'Board', size: SECTION_SIZE.Board!, render: () => <BoardSettings state={state} hub={hub} board={board} run={run} api={api} sharing={sharing} {...(onBoardDeleted === undefined ? {} : { onDeleted: onBoardDeleted })} workflowDraft={workflowDraft} setWorkflowDraft={setWorkflowDraft} {...(nativeSeat === undefined ? {} : { nativeSeat })} onDirtyChange={setBoardDirty} /> }] : []),
    { id: 'Team Settings', size: SECTION_SIZE['Team Settings']!, render: () => hub ? <TeamSettings key={hub.id} hub={hub} sharing={sharing} auth={sharingAuth} api={api} run={run} /> : <p className="kb-hint">No Hub is selected.</p> },
  ];
  const selected = sections.some(value => value.id === section) ? section : 'General';
  const current = sections.find(value => value.id === selected) ?? sections[0]!;
  const unsaved = dirty || boardDirty;
  /** Leaving Board with a dirty panel discards a draft, so it asks first. */
  function requestSection(next: string): void {
    if (next === selected) return;
    if (selected === 'Board' && boardDirty) { setPendingSection(next); return; }
    setSection(next);
  }
  function requestClose() {
    if (closePending) { setClosePending(false); return; }
    if (unsaved) { setClosePending(true); return; }
    onClose();
  }
  const discardKind = dirty && boardDirty ? 'board and workflow' : dirty ? 'workflow' : 'board';
  return <Modal title="Kanban configuration" onClose={requestClose} size={current.size}>
    <Tabs label="Configuration sections" values={sections.map(value => value.id)} selected={selected} onSelect={requestSection} id={id} />
    {pendingSection !== null && <div className="kb-inline-confirm" role="alertdialog" aria-label="Discard board changes">
      <p>You have unsaved board changes. Discard them and open {pendingSection}?</p>
      <div className="kb-actions"><button type="button" className="kb-button" onClick={() => setPendingSection(null)}>Keep editing</button><button type="button" className="kb-button kb-danger" onClick={() => { setBoardDirty(false); setSection(pendingSection); setPendingSection(null); }}>Discard and continue</button></div>
    </div>}
    {closePending && <div className="kb-inline-confirm" role="alertdialog" aria-label="Discard configuration changes">
      <p>You have unsaved {discardKind} changes. Discard them and close configuration?</p>
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
