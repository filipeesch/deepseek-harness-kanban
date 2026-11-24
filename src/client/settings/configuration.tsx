import React, { useId, useRef, useState } from 'react';
import type { Attention, Board, ClientApi, HubScheduleRuntime, HubSharingView, HubState, KanbanSettings, Project, SharingAuthView, Task } from '../../shared/types.js';
import { ProjectEditorDialog } from '../projects/project-editor-dialog.js';
import { ProjectList } from '../projects/project-list.js';
import { Modal, Tabs, type ModalSize, type RunCommand } from '../ui.js';
import type { NativeSeat } from '../native-slot-host.js';
import { BoardsSection } from './boards/boards-section.js';
import { GeneralSettings } from './general-settings.js';
import { HubSettings } from './hub-settings.js';
import { TeamSettings } from './team-settings/team-settings.js';
import { SchedulesSettings } from './schedules/schedules-settings.js';

/**
 * The top-level sections, in presentation order. General stays first and remains the
 * section opened by default; board configuration moved out of this row and is opened
 * from the Boards section, so no board is editable from two places.
 */
const SECTION_IDS = ['General', 'Hub', 'Boards', 'Projects', 'Schedules', 'Team Settings'] as const;
type SectionId = (typeof SECTION_IDS)[number];

/** Every section presents the same width; the board overlay carries the only wide surface. */
const SECTION_SIZE: ModalSize = 'settings';

interface Section {
  id: SectionId;
  /** Renders the section, reporting through the given callback whether it holds a draft. */
  render: (report: (dirty: boolean) => void) => React.ReactNode;
}

export function Configuration({ hub, hubCount, settings, settingsRevision, run, api, sharing, sharingAuth, conversationAttention, scheduleRuntime, onOpenSession, onClose, initial = 'General', onHubDeleted, onBoardCreated, nativeSeat }: {
  hub: HubState | null; hubCount: number;
  settings?: KanbanSettings; settingsRevision: number; run: RunCommand; api?: ClientApi; sharing?: HubSharingView; sharingAuth?: SharingAuthView; conversationAttention?: Record<string, Attention>;
  scheduleRuntime?: HubScheduleRuntime; onOpenSession?: (sessionId: string) => void;
  onClose: () => void; initial?: string; onHubDeleted?: () => void; onBoardCreated?: (id: string) => void;
  /** The native slot registry the board's model selector borrows; absent outside the real client. */
  nativeSeat?: NativeSeat;
}) {
  const id = useId();
  const [section, setSection] = useState<SectionId>(() => SECTION_IDS.includes(initial as SectionId) ? initial as SectionId : 'General');
  const [pendingSection, setPendingSection] = useState<SectionId | null>(null);
  const [closePending, setClosePending] = useState(false);
  const [drafts, setDrafts] = useState<Partial<Record<SectionId, boolean>>>({});
  // One stable reporter per section: a fresh callback on every render would make every
  // panel's dirty effect run again.
  const reporters = useRef<Partial<Record<SectionId, (dirty: boolean) => void>>>({});
  function reporterFor(value: SectionId): (dirty: boolean) => void {
    reporters.current[value] ??= (dirty: boolean) => setDrafts(previous => previous[value] === dirty ? previous : { ...previous, [value]: dirty });
    return reporters.current[value]!;
  }
  const dirtySection = SECTION_IDS.find(value => drafts[value] === true);
  const sections: Section[] = [
    { id: 'General', render: report => <GeneralSettings settings={settings} settingsRevision={settingsRevision} run={run} onDirtyChange={report} /> },
    { id: 'Hub', render: report => hub ? <HubSettings hub={hub} hubCount={hubCount} run={run} {...(sharing === undefined ? {} : { sharing })} {...(onHubDeleted === undefined ? {} : { onDeleted: onHubDeleted })} onDirtyChange={report} /> : <p className="kb-hint">No Hub is selected.</p> },
    { id: 'Boards', render: () => hub ? <BoardsSection hub={hub} settings={settings} run={run} {...(api === undefined ? {} : { api })} {...(sharing === undefined ? {} : { sharing })} {...(nativeSeat === undefined ? {} : { nativeSeat })} {...(onBoardCreated === undefined ? {} : { onCreated: onBoardCreated })} /> : <p className="kb-hint">No Hub is selected.</p> },
    { id: 'Projects', render: () => hub ? <ProjectsSection projects={hub.projects} boards={hub.boards} tasks={hub.tasks} revision={hub.revision} run={run} api={api} hubId={hub.id} conversationAttention={conversationAttention} /> : <p className="kb-hint">No Hub is selected.</p> },
    { id: 'Schedules', render: () => hub ? <SchedulesSettings hub={hub} runtime={scheduleRuntime} {...(api === undefined ? {} : { api })} run={run} {...(onOpenSession === undefined ? {} : { onOpenSession })} {...(nativeSeat === undefined ? {} : { nativeSeat })} /> : <p className="kb-hint">No Hub is selected.</p> },
    { id: 'Team Settings', render: () => hub ? <TeamSettings key={hub.id} hub={hub} sharing={sharing} auth={sharingAuth} api={api} run={run} onOpenProjects={() => requestSection('Projects')} /> : <p className="kb-hint">No Hub is selected.</p> },
  ];
  const current = sections.find(value => value.id === section) ?? sections[0]!;
  /** Leaving a section that holds a draft discards it, so it asks first. */
  function requestSection(next: SectionId): void {
    if (next === section) return;
    if (drafts[section] === true) { setPendingSection(next); return; }
    setSection(next);
  }
  function discardAndContinue(): void {
    if (pendingSection === null) return;
    const next = pendingSection;
    setDrafts(previous => ({ ...previous, [section]: false }));
    setPendingSection(null);
    setSection(next);
  }
  function requestClose(): void {
    if (closePending) { setClosePending(false); return; }
    if (dirtySection !== undefined) { setClosePending(true); return; }
    onClose();
  }
  return <Modal title="Kanban configuration" onClose={requestClose} size={SECTION_SIZE}>
    <Tabs label="Configuration sections" values={SECTION_IDS} selected={section} onSelect={value => requestSection(value as SectionId)} id={id} />
    {pendingSection !== null && <div className="kb-inline-confirm" role="alertdialog" aria-label="Discard section changes">
      <p>You have unsaved changes in {section}. Discard them and open {pendingSection}?</p>
      <div className="kb-actions"><button type="button" className="kb-button" onClick={() => setPendingSection(null)}>Keep editing</button><button type="button" className="kb-button kb-danger" onClick={discardAndContinue}>Discard and continue</button></div>
    </div>}
    {closePending && <div className="kb-inline-confirm" role="alertdialog" aria-label="Discard configuration changes">
      <p>You have unsaved changes in {dirtySection ?? section}. Discard them and close configuration?</p>
      <div className="kb-actions"><button type="button" className="kb-button" onClick={() => setClosePending(false)}>Keep editing</button><button type="button" className="kb-button kb-danger" onClick={onClose}>Discard and close</button></div>
    </div>}
    <section className="kb-panel" role="tabpanel" id={id + '-panel-' + section} aria-labelledby={id + '-tab-' + section}>
      {current.render(reporterFor(current.id))}
    </section>
  </Modal>;
}

function ProjectsSection({ projects, boards, tasks, revision, run, api, hubId, conversationAttention }: { projects: Project[]; boards: Board[]; tasks: Task[]; revision: number; run: RunCommand; api?: ClientApi; hubId?: string; conversationAttention?: Record<string, Attention> }) {
  const [editing, setEditing] = useState<{ project?: Project } | null>(null);
  const [saved, setSaved] = useState<'saved' | 'relocated' | 'linked' | null>(null);
  return <div className="kb-form">
    <ProjectList projects={projects} boards={boards} tasks={tasks} revision={revision} run={run} onAdd={() => { setEditing({}); setSaved(null); }} onEdit={project => { setEditing({ project }); setSaved(null); }} onLinked={() => setSaved('linked')} />
    {saved === 'saved' && <p role="status">Project saved.</p>}
    {saved === 'linked' && <p role="status">Project linked to the team's key.</p>}
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
