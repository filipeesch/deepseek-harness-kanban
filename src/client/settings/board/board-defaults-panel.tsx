import React, { useId } from 'react';
import type { Board, ClientApi, HubState } from '../../../shared/types.js';
import { displayPreset } from '../../agent-preset-roster.js';
import { useAgentPresetPort } from '../../agent-preset-context.js';
import { NativeModelField } from '../../model/native-model-field.js';
import { ErrorNotice, type RunCommand } from '../../ui.js';
import type { NativeSeat } from '../../native-slot-host.js';
import { useBoardDefaults } from './use-board-defaults.js';
import { usePanelDirty } from './use-panel-dirty.js';

export interface BoardDefaultsPanelProps {
  hub: HubState;
  board: Board;
  run: RunCommand;
  api?: ClientApi;
  /** The saved workflow document, never the editor's draft. */
  yaml: string;
  baseRevision: number;
  /** Whether the Workflow sub-section holds unsaved edits. */
  workflowEditing: boolean;
  /** Navigate to the Workflow sub-section, through the container's leave guard. */
  onOpenWorkflow: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  seat?: NativeSeat;
}

/**
 * The board's defaults: the model and the agent preset every new conversation
 * starts on. One draft, one dirty state, one guarded workflow save.
 */
export function BoardDefaultsPanel({ hub, board, run, api, yaml, baseRevision, workflowEditing, onOpenWorkflow, onDirtyChange, seat }: BoardDefaultsPanelProps) {
  const { port, translate } = useAgentPresetPort();
  const controller = useBoardDefaults({
    hub, board, run, ...(api === undefined ? {} : { api }), yaml, baseRevision, workflowEditing, presetPort: port, ...(translate === undefined ? {} : { translate }),
  });
  const id = useId();
  usePanelDirty(controller.dirty, onDirtyChange);
  const group = id + '-preset';
  const rosterOptions = controller.roster.options;
  const storedMissing = controller.storedPreset !== undefined && controller.roster.status === 'ready'
    && !rosterOptions.some(option => option.id === controller.storedPreset);
  // A stored preset is always presented, even while the roster is loading or
  // failed: the configuration must never hide the value it is keeping.
  const showStoredPreset = controller.storedPreset !== undefined && (controller.roster.status !== 'ready' || storedMissing);

  return <form className="kb-form" aria-label="Board defaults" onSubmit={event => { event.preventDefault(); void controller.save(); }}>
    <h3>Defaults</h3>
    <p className="kb-hint">Every new conversation on this board starts on these choices. The host default leaves the choice to DSH.</p>

    <fieldset className="kb-fieldset" aria-label="Board default model">
      <legend>Default model</legend>
      <label className="kb-choice"><input type="radio" name={id + '-model'} checked={controller.mode === 'host'} disabled={controller.pending} onChange={controller.chooseHostModel} /> Host default model</label>
      <label className="kb-choice"><input type="radio" name={id + '-model'} checked={controller.mode === 'specific'} disabled={controller.pending} onChange={controller.chooseSpecificModel} /> Specific model</label>
      {controller.mode === 'specific' && <>
        <NativeModelField
          seat={seat}
          value={controller.selection}
          catalog={controller.catalog.catalog}
          catalogError={controller.catalog.error}
          catalogLoading={controller.catalog.loading}
          onChange={controller.chooseModel}
          onRetry={controller.catalog.reload}
          disabled={controller.pending}
          subject="board"
        />
        {controller.selection === undefined && <p className="kb-hint" role="status">Choose a model or switch to the host default before saving.</p>}
        {controller.storedModelMissing && controller.storedModel !== undefined && <p className="kb-hint" role="status">The board's stored model, {controller.storedModel.provider} · {controller.storedModel.model}, is not offered by this host. It is kept until another route is chosen.</p>}
        {controller.catalog.error !== null && <p className="kb-hint" role="status">The model catalog is unavailable: {controller.catalog.error.message} <button type="button" className="kb-button" disabled={controller.pending} onClick={controller.catalog.reload}>Retry models</button></p>}
      </>}
    </fieldset>

    <fieldset className="kb-fieldset" aria-label="Board default agent preset">
      <legend>Default agent preset</legend>
      <label className="kb-choice kb-preset-choice">
        <input type="radio" name={group} checked={controller.preset === undefined} disabled={controller.pending} onChange={() => controller.choosePreset(undefined)} />
        <span><strong>Host default preset</strong><span className="kb-hint">Leave the choice to DSH</span></span>
      </label>
      {controller.roster.status === 'loading' && <p className="kb-hint" role="status">Loading agent presets…</p>}
      {controller.roster.status === 'error' && <p className="kb-hint" role="status">The agent-preset roster is unavailable: {controller.roster.error ?? 'unknown error'} <button type="button" className="kb-button" disabled={controller.pending} onClick={controller.retryPresets}>Retry presets</button></p>}
      {controller.roster.status === 'ready' && rosterOptions.map(option => {
        const display = displayPreset(option, controller.translate);
        return <label className="kb-choice kb-preset-choice" key={option.id}>
          <input type="radio" name={group} checked={controller.preset === option.id} disabled={controller.pending} data-preset-id={option.id} data-host-default={option.isDefault === true ? 'true' : 'false'} onChange={() => controller.choosePreset(option.id)} />
          <span><strong>{display.name}</strong>{display.description === undefined ? null : <span className="kb-hint">{display.description}</span>}</span>
        </label>;
      })}
      {showStoredPreset && controller.storedPreset !== undefined && <label className="kb-choice kb-preset-choice">
        <input type="radio" name={group} checked={controller.preset === controller.storedPreset} disabled={controller.pending} data-preset-id={controller.storedPreset} onChange={() => controller.choosePreset(controller.storedPreset)} />
        <span><strong>{controller.storedPreset}{storedMissing ? ' (not available on this host)' : ''}</strong><span className="kb-hint">{storedMissing ? 'The board keeps this preset until another one is chosen.' : 'The stored preset is kept while the roster cannot be read.'}</span></span>
      </label>}
    </fieldset>

    {workflowEditing && <p className="kb-hint" role="status">Save is unavailable while the Workflow sub-section holds unsaved edits. Save or discard them there first. <button type="button" className="kb-button" onClick={onOpenWorkflow}>Open Workflow</button></p>}
    <div className="kb-actions">
      <button className="kb-button kb-primary" disabled={!controller.canSave}>{controller.pending ? 'Saving…' : 'Save defaults'}</button>
      {!controller.dirty && !controller.saved && <span className="kb-hint">No changes to save.</span>}
    </div>
    <ErrorNotice problem={controller.error} />
    {controller.saved && <p role="status">Defaults saved.</p>}
  </form>;
}
