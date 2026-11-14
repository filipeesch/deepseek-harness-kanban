import React, { useState } from 'react';
import type { ClientApi, Command, HubSchedule, HubScheduleRuntime, HubState, Problem } from '../../../shared/types.js';
import { describeCron, nextOccurrence } from '../../../domain/cron.js';
import { asProblem, ErrorNotice, type RunCommand } from '../../ui.js';
import { ScheduleEditorDialog } from './schedule-editor-dialog.js';
import type { NativeSeat } from '../../native-slot-host.js';
import { formatOccurrence } from './schedule-draft.js';
import { ScheduleLastRun } from './last-run.js';

function description(schedule: HubSchedule): string {
  try { return describeCron(schedule.cron); } catch { return schedule.cron; }
}

function nextRun(schedule: HubSchedule): string {
  try {
    const next = nextOccurrence(schedule.cron, schedule.timeZone, new Date());
    return next === undefined ? 'no next occurrence' : formatOccurrence(next, schedule.timeZone);
  } catch { return 'invalid schedule'; }
}

function modelLabel(schedule: HubSchedule): string {
  return schedule.model === undefined ? 'Host default' : schedule.model.provider + ' · ' + schedule.model.model;
}

/** The Hub's Schedules section: the list, its row actions, and the editor overlay. */
export function SchedulesSettings({ hub, runtime, api, run, onOpenSession, nativeSeat }: {
  hub: HubState;
  runtime?: HubScheduleRuntime;
  api?: ClientApi;
  run: RunCommand;
  onOpenSession?: (sessionId: string) => void;
  /** The native slot registry the model selector borrows; absent outside the real client. */
  nativeSeat?: NativeSeat;
}) {
  const [editing, setEditing] = useState<{ schedule?: HubSchedule } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<Problem | null>(null);
  const projects = hub.projects;
  const schedules = [...(hub.schedules ?? [])].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  const busy = pending !== null;

  async function act(key: string, command: Command): Promise<boolean> {
    if (busy) return false;
    setPending(key);
    setError(null);
    try { await run(command); return true; }
    catch (failure) { setError(asProblem(failure)); return false; }
    finally { setPending(null); }
  }

  return <div className="kb-form" aria-label="Schedules">
    <h3>Schedules</h3>
    <p className="kb-hint">Run a prompt in a Hub project on a cron schedule. A schedule runs only while this host is open, skips occurrences it missed, and is never published to the team.</p>
    <div className="kb-actions">
      <button type="button" className="kb-button kb-primary" disabled={busy || projects.length === 0} onClick={() => setEditing({})}>New schedule</button>
      {projects.length === 0 && <span className="kb-hint">Register a project in this Hub before scheduling a session.</span>}
    </div>
    {schedules.length === 0
      ? <p className="kb-hint" role="status">No schedules yet.</p>
      : <ul className="kb-schedule-list">{schedules.map(schedule => {
        const state = runtime?.[schedule.id];
        const projectName = projects.find(project => project.id === schedule.projectId)?.name ?? 'Missing project';
        return <li key={schedule.id}>
          <div className="kb-schedule-title">
            <strong>{schedule.title}</strong>
            <span className="kb-badge">{schedule.enabled ? 'Enabled' : 'Paused'}</span>
            {state?.running === true && <span className="kb-badge" role="status">Running</span>}
          </div>
          <div className="kb-schedule-facts">
            <span>{description(schedule)}</span>
            <span>Next: {nextRun(schedule)}</span>
            <span>Project: {projectName}</span>
            <span>Model: {modelLabel(schedule)}</span>
            <span>{schedule.timeZone}</span>
          </div>
          <div className="kb-schedule-actions">
            <button type="button" className="kb-button" aria-label={'Edit schedule ' + schedule.title} disabled={busy} onClick={() => setEditing({ schedule })}>Edit</button>
            <button type="button" className="kb-button" aria-label={(schedule.enabled ? 'Pause schedule ' : 'Enable schedule ') + schedule.title} disabled={busy} onClick={() => void act('toggle:' + schedule.id, { type: 'schedule.setEnabled', hubId: hub.id, scheduleId: schedule.id, enabled: !schedule.enabled })}>{schedule.enabled ? 'Pause' : 'Enable'}</button>
            <button type="button" className="kb-button" aria-label={'Run schedule ' + schedule.title + ' now'} title={schedule.enabled ? 'Run one occurrence now without moving the schedule' : 'Enable the schedule to run it now'} disabled={busy || !schedule.enabled || state?.running === true} onClick={() => void act('run:' + schedule.id, { type: 'schedule.runNow', hubId: hub.id, scheduleId: schedule.id })}>{pending === 'run:' + schedule.id ? 'Starting…' : 'Run now'}</button>
            <button type="button" className="kb-button kb-danger" aria-label={'Delete schedule ' + schedule.title} disabled={busy} onClick={() => setConfirming(schedule.id)}>Delete</button>
          </div>
          <ScheduleLastRun runtime={state} timeZone={schedule.timeZone} {...(onOpenSession === undefined ? {} : { onOpenSession })} />
          {confirming === schedule.id && <div className="kb-inline-confirm" role="alertdialog" aria-label={'Confirm deleting schedule ' + schedule.title}>
            <p>Delete <strong>{schedule.title}</strong>? Its future occurrences stop; the conversations it already created are kept.</p>
            <div className="kb-actions">
              <button type="button" className="kb-button" disabled={busy} onClick={() => setConfirming(null)}>Cancel</button>
              <button type="button" className="kb-button kb-danger" disabled={busy} onClick={() => void act('delete:' + schedule.id, { type: 'schedule.delete', hubId: hub.id, scheduleId: schedule.id, confirmed: true }).then(done => { if (done) setConfirming(null); })}>Delete schedule</button>
            </div>
          </div>}
        </li>;
      })}</ul>}
    <ErrorNotice problem={error} />
    {editing !== null && <ScheduleEditorDialog
      hubId={hub.id}
      {...(editing.schedule === undefined ? {} : { schedule: editing.schedule })}
      expectedRevision={hub.revision}
      projects={projects}
      {...(api === undefined ? {} : { api })}
      {...(nativeSeat === undefined ? {} : { nativeSeat })}
      run={run}
      onClose={() => setEditing(null)}
      onSaved={() => setEditing(null)}
    />}
  </div>;
}
