import React, { useState } from 'react';
import type { Board, ClientApi, HubState } from '../../../shared/types.js';
import { SegmentedControl } from '../../segmented.js';
import { ErrorNotice, type RunCommand } from '../../ui.js';
import { useBoardMcpDefaults } from './use-board-defaults.js';
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
}

/**
 * The board's MCP tab: the MCP tool allowlist. The agents — and with them the board
 * default preset and model — live in the Agents tab, which owns their draft and
 * their migration.
 */
export function BoardDefaultsPanel({ hub, board, run, api, yaml, baseRevision, workflowEditing, onOpenWorkflow, onDirtyChange }: BoardDefaultsPanelProps) {
  const controller = useBoardMcpDefaults({
    hub, board, run, ...(api === undefined ? {} : { api }), yaml, baseRevision, workflowEditing,
  });
  usePanelDirty(controller.dirty, onDirtyChange);

  return <form className="kb-form" aria-label="Board defaults" onSubmit={event => { event.preventDefault(); void controller.save(); }}>
    <h3>MCP</h3>
    <p className="kb-hint">The board&apos;s agents and their models are edited in the Agents tab. This tab keeps the tools every conversation of this board may use.</p>

    <fieldset className="kb-fieldset" aria-label="Board MCP tool allowlist">
      <legend>MCP tool allowlist</legend>
      <p className="kb-hint">Which MCP servers this board&apos;s conversations may use. An absent field keeps every server visible; a selection keeps only what it names.</p>
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
