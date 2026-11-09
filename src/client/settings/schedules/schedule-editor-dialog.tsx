import React from 'react';
import type { ClientApi, HubSchedule, Project } from '../../../shared/types.js';
import { ErrorNotice, Modal, type RunCommand } from '../../ui.js';
import { COMMON_TIME_ZONES, CRON_PRESETS, draftCatalogModel, presetFor } from './schedule-draft.js';
import { useScheduleEditor } from './use-schedule-editor.js';

/** The one overlay that creates and edits a schedule. */
export function ScheduleEditorDialog({ hubId, schedule, expectedRevision, projects, api, run, onClose, onSaved }: {
  hubId: string;
  schedule?: HubSchedule;
  expectedRevision?: number;
  projects: readonly Project[];
  api?: ClientApi;
  run: RunCommand;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editor = useScheduleEditor({
    ...(api === undefined ? {} : { api }), hubId, ...(schedule === undefined ? {} : { schedule }),
    ...(expectedRevision === undefined ? {} : { expectedRevision }), projects, run, onClose, onSaved,
  });
  const { draft } = editor;
  const title = schedule === undefined ? 'New schedule' : 'Edit schedule';
  const zoneListId = 'kb-schedule-zone-list';
  const modelValue = draft.modelMode === 'custom' ? draft.modelProvider + '::' + draft.modelName : 'default';
  const modelOptions: Array<{ value: string; label: string }> = [
    { value: 'default', label: 'Host default model' },
    ...(editor.catalog?.providers.flatMap(provider => provider.models.map(model => ({ value: provider.id + '::' + model.id, label: provider.name + ' · ' + model.name }))) ?? []),
  ];
  if (draft.modelMode === 'custom' && !modelOptions.some(option => option.value === modelValue)) {
    modelOptions.push({ value: modelValue, label: draft.modelProvider + ' · ' + draft.modelName + ' (not in the catalog)' });
  }
  const catalogModel = draftCatalogModel(draft, editor.catalog);
  const efforts = catalogModel?.reasoning?.efforts ?? [];
  const storedEffort = draft.reasoningEffort !== '' && !efforts.some(effort => effort.id === draft.reasoningEffort) ? draft.reasoningEffort : undefined;
  function chooseModel(value: string): void {
    if (value === 'default') {
      editor.change('modelMode', 'default');
      editor.change('reasoningEffort', '');
      return;
    }
    const [provider, model] = value.split('::');
    editor.change('modelMode', 'custom');
    editor.change('modelProvider', provider ?? '');
    // A different route invalidates the previous route's reasoning effort.
    editor.change('reasoningEffort', '');
    editor.change('modelName', model ?? '');
  }
  return <Modal title={title} onClose={editor.cancel} busy={editor.pending}>
    <form className="kb-form" aria-label={title} aria-busy={editor.pending} onSubmit={event => { event.preventDefault(); void editor.save(); }}>
      <label className="kb-field">Title<input className="kb-input" autoFocus aria-label="Schedule title" disabled={editor.pending} value={draft.title} onChange={event => editor.change('title', event.target.value)} /></label>
      <label className="kb-field">Prompt<textarea className="kb-input" aria-label="Prompt" rows={5} disabled={editor.pending} value={draft.prompt} onChange={event => editor.change('prompt', event.target.value)} /></label>
      <label className="kb-field">Quick schedule<select className="kb-input" aria-label="Quick schedule" disabled={editor.pending} value={presetFor(draft.cron)} onChange={event => {
        const preset = CRON_PRESETS.find(value => value.id === event.target.value);
        if (preset?.cron !== undefined) editor.change('cron', preset.cron);
      }}>{CRON_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>
      <label className="kb-field">Cron expression<input className="kb-input" aria-label="Cron expression" disabled={editor.pending} value={draft.cron} onChange={event => editor.change('cron', event.target.value)} /></label>
      <label className="kb-field">Time zone<input className="kb-input" aria-label="Schedule time zone" list={zoneListId} disabled={editor.pending} value={draft.timeZone} onChange={event => editor.change('timeZone', event.target.value)} />
        <datalist id={zoneListId}>{COMMON_TIME_ZONES.map(zone => <option key={zone} value={zone} />)}</datalist>
      </label>
      <p className="kb-hint" role="status">{editor.description === null ? 'The cron expression is not valid yet.' : editor.description}</p>
      {editor.occurrences.length > 0 && <p className="kb-hint">Next: {editor.occurrences.join(' · ')}</p>}
      <label className="kb-field">Project<select className="kb-input" aria-label="Project" disabled={editor.pending || projects.length === 0} value={draft.projectId} onChange={event => editor.change('projectId', event.target.value)}>
        <option value="">Choose a project</option>
        {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select></label>
      {projects.length === 0 && <p className="kb-hint" role="status">Register a project in this Hub before scheduling a session.</p>}
      <label className="kb-field">Model<select className="kb-input" aria-label="Model" disabled={editor.pending || editor.catalog === null} value={modelValue} onChange={event => chooseModel(event.target.value)}>
        {modelOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select></label>
      {(efforts.length > 0 || storedEffort !== undefined) && <label className="kb-field">Reasoning effort<select className="kb-input" aria-label="Reasoning effort" disabled={editor.pending} value={draft.reasoningEffort} onChange={event => editor.change('reasoningEffort', event.target.value)}>
        <option value="">Model default</option>
        {efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
        {storedEffort !== undefined && <option value={storedEffort}>{storedEffort} (stored)</option>}
      </select></label>}
      {editor.catalogError !== null && <p className="kb-hint" role="status">The model catalog is unavailable: {editor.catalogError.message} The stored model, when present, is kept.</p>}
      {editor.catalog !== null && draft.modelMode === 'custom' && catalogModel === undefined && <p className="kb-hint" role="status">This model is not in the host catalog. Choose a catalog model or the host default before saving.</p>}
      <label className="kb-choice"><input type="checkbox" aria-label="New conversation per run" disabled={editor.pending} checked={draft.newConversation} onChange={event => editor.change('newConversation', event.target.checked)} /> New conversation for each run</label>
      <label className="kb-choice"><input type="checkbox" aria-label="Archive when idle" disabled={editor.pending || !draft.newConversation} checked={draft.archiveWhenIdle} onChange={event => editor.change('archiveWhenIdle', event.target.checked)} /> Archive the conversation once it is idle</label>
      <p className="kb-hint">A schedule runs unattended while the host is open. Missed occurrences are skipped, and an occurrence is skipped while the previous run of the same schedule is still active.</p>
      <ErrorNotice problem={editor.error} />
      <div className="kb-actions">
        <button type="button" className="kb-button" disabled={editor.pending} onClick={editor.cancel}>Cancel</button>
        <button className="kb-button kb-primary" disabled={editor.pending}>{editor.pending ? 'Saving…' : 'Save schedule'}</button>
      </div>
    </form>
  </Modal>;
}
