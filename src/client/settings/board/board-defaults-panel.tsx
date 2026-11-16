import React, { useId, useState } from 'react';
import type { Board, ClientApi, HubState } from '../../../shared/types.js';
import { displayPreset } from '../../agent-preset-roster.js';
import { useAgentPresetPort } from '../../agent-preset-context.js';
import { NativeModelField } from '../../model/native-model-field.js';
import { SegmentedControl } from '../../segmented.js';
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
      <SegmentedControl
        label="Default model mode"
        value={controller.mode}
        options={[{ value: 'host', label: 'Host default' }, { value: 'specific', label: 'Specific model' }]}
        disabled={controller.pending}
        onChange={mode => mode === 'host' ? controller.chooseHostModel() : controller.chooseSpecificModel()}
      />
      {/* The selector stays in place in both modes and is disabled under the host default,
          so switching the mode never moves or resizes this panel. */}
      <NativeModelField
        seat={seat}
        value={controller.selection}
        catalog={controller.catalog.catalog}
        catalogError={controller.catalog.error}
        catalogLoading={controller.catalog.loading}
        onChange={controller.chooseModel}
        onRetry={controller.catalog.reload}
        disabled={controller.pending || controller.mode === 'host'}
        subject="board"
      />
      {controller.mode === 'specific' && <>
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

    <fieldset className="kb-fieldset" aria-label="Board MCP tool allowlist">
      <legend>MCP tool allowlist</legend>
      <p className="kb-hint">Which MCP servers this board's conversations may use. An absent field keeps every server visible; a selection keeps only what it names.</p>
      <SegmentedControl
        label="MCP access"
        value={controller.mcpMode}
        options={[{ value: 'all', label: 'Every server' }, { value: 'selected', label: 'Selected servers' }]}
        disabled={controller.pending}
        onChange={value => controller.chooseMcpMode(value === 'all' ? 'all' : 'selected')}
      />
      {controller.mcpMode === 'all'
        ? <p className="kb-hint" role="status">Every MCP server this host configures stays visible to this board&apos;s conversations.</p>
        : <>
          {controller.mcpServers.status === 'loading' && <p className="kb-hint" role="status">Loading MCP servers…</p>}
          {controller.mcpServers.status === 'error' && <p className="kb-hint" role="status">The MCP server list is unavailable: {controller.mcpServers.error ?? 'unknown error'} <button type="button" className="kb-button" disabled={controller.pending} onClick={controller.mcpServers.reload}>Retry servers</button></p>}
          {controller.knownMcpServers.length > 0 && <div className="kb-mcp-servers" role="group" aria-label="MCP servers">
            {controller.knownMcpServers.map(server => {
              const reported = controller.mcpServers.servers.includes(server);
              // A checked server means every tool of that server. A server with only some
              // tools allowed stays unchecked and says how many tools it keeps.
              const whole = controller.mcpEntries.includes(server);
              const tools = controller.mcpEntries.filter(entry => entry.startsWith(server + '/')).length;
              return <label className="kb-choice" key={server}>
                <input type="checkbox" checked={whole} disabled={controller.pending} data-mcp-server={server} onChange={() => controller.toggleMcpServer(server)} />
                <span className="kb-mcp-choice-body"><strong>{server}</strong>
                  {!whole && tools > 0 ? <span className="kb-hint">{tools} {tools === 1 ? 'tool' : 'tools'} selected</span> : null}
                  {reported ? null : <span className="kb-hint">Not reported by this host. It is kept until you remove it.</span>}
                </span>
              </label>;
            })}
          </div>}
          <McpEntryInput disabled={controller.pending} onAdd={controller.addMcpEntry} />
          {controller.mcpEntryProblem !== null && <p className="kb-hint" role="status">{controller.mcpEntryProblem}</p>}
          {controller.mcpEntries.length === 0 && <p className="kb-hint" role="status">No server is allowed. This board&apos;s conversations see no MCP tool.</p>}
          {controller.mcpEntries.length > 0 && <ul className="kb-mcp-entries" aria-label="Allowed MCP entries">
            {controller.mcpEntries.map(entry => <li key={entry}>
              <code>{entry}</code>
              <button type="button" className="kb-button" aria-label={'Remove ' + entry} disabled={controller.pending} onClick={() => controller.removeMcpEntry(entry)}>Remove</button>
            </li>)}
          </ul>}
        </>}
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

/** One free allowlist entry: a server, or a server and one of its tools. */
function McpEntryInput({ disabled, onAdd }: { disabled: boolean; onAdd: (value: string) => void }) {
  const [value, setValue] = useState('');
  const submit = (): void => {
    if (!value.trim()) return;
    onAdd(value);
    setValue('');
  };
  return <div className="kb-input-row">
    <input
      className="kb-input"
      aria-label="Add MCP server or tool"
      placeholder="server or server/tool"
      value={value}
      disabled={disabled}
      onChange={event => setValue(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); submit(); } }}
    />
    <button type="button" className="kb-button" disabled={disabled || !value.trim()} onClick={submit}>Add entry</button>
  </div>;
}
