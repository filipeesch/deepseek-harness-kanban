import React from 'react';
import type { ModelSelection } from '../../../shared/types.js';
import { MAIN_AGENT_ID } from '../../../shared/types.js';
import { displayPreset } from '../../agent-preset-roster.js';
import { SegmentedControl } from '../../segmented.js';
import { NativeModelField } from '../../model/native-model-field.js';
import type { NativeSeat } from '../../native-slot-host.js';
import type { AgentRowKey, BoardAgentsController } from './use-board-agents.js';

/** One route as the header line shows it. */
function routeText(selection: ModelSelection | undefined): string {
  if (selection === undefined) return '';
  return selection.reasoningEffort === undefined ? selection.provider + ' · ' + selection.model : selection.provider + ' · ' + selection.model + ' · ' + selection.reasoningEffort;
}

function presetLabel(controller: BoardAgentsController, preset: string): string {
  if (preset.trim() === '') return 'Host default preset';
  const option = controller.roster.options.find(value => value.id === preset);
  return option === undefined ? preset : displayPreset(option, controller.translate).name;
}

/** The stored preset stays presented even before the roster answers or when it is gone. */
function storedPresetOption(controller: BoardAgentsController, preset: string): React.ReactNode {
  if (preset.trim() === '') return null;
  if (controller.roster.options.some(option => option.id === preset)) return null;
  return <option value={preset}>{preset} (not offered by this host)</option>;
}

/** True when the authored preset is absent from a loaded roster. */
function presetProblem(controller: BoardAgentsController, preset: string): boolean {
  return preset.trim() !== '' && controller.roster.status === 'ready' && !controller.roster.options.some(option => option.id === preset);
}

/** One agent's row: the closed header names it, the open body edits it. */
function AgentRow({ rowKey, title, subtitle, expanded, onToggle, children }: {
  readonly rowKey: string;
  readonly title: string;
  readonly subtitle: string;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly children: React.ReactNode;
}) {
  return <div className="kb-agent-row" data-agent-key={rowKey}>
    <button type="button" className="kb-agent-header" aria-expanded={expanded} onClick={onToggle}>
      <span className="kb-agent-chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
      <span className="kb-agent-title">{title}</span>
      <span className="kb-agent-summary">{subtitle}</span>
    </button>
    {expanded && <div className="kb-agent-fields">{children}</div>}
  </div>;
}

/**
 * The board's agents as one collapsible list. The main agent is pinned first; every
 * row is closed until opened. A closed row already names the model and the preset, so
 * the list can be judged without opening anything. Each agent's model is the host's
 * native selector, the same control the board default model has always used.
 */
export function BoardAgentsList({ controller, seat }: {
  readonly controller: BoardAgentsController;
  readonly seat?: NativeSeat;
}) {
  const pending = controller.pending;
  const problemsOf = (id: string) => controller.problems.filter(problem => problem.id === id).map(problem => problem.message).join(' ');
  const presetOptions = [{ value: '', label: 'Host default preset' },
    ...controller.roster.options.map(option => ({ value: option.id, label: displayPreset(option, controller.translate).name }))];
  const mainModelMode = controller.mainModelMode;
  const mainModelText = controller.draft.mainModel === undefined ? 'Host default model' : routeText(controller.draft.mainModel);
  const chooseMainMode = (mode: string): void => controller.chooseMainModelMode(mode === 'specific' ? 'specific' : 'host');

  return <fieldset className="kb-fieldset" aria-label="Board agents">
    <p className="kb-hint">A stage that names an agent runs its instruction in that agent’s conversation; the main agent runs every stage that names none. The identifier follows the name until the first save, then stays fixed because stages reference it.</p>

    <AgentRow rowKey={MAIN_AGENT_ID} title={controller.draft.mainName.trim() === '' ? 'Unnamed agent' : controller.draft.mainName} subtitle={mainModelText + ' · ' + presetLabel(controller, controller.draft.mainPreset)} expanded={controller.expanded.has('main')} onToggle={() => controller.toggle('main')}>
      <label className="kb-field">Name
        <input className="kb-input" aria-label="Main agent name" value={controller.draft.mainName} disabled={pending} onChange={event => controller.changeMainName(event.target.value)} />
      </label>
      <div className="kb-field">Identifier<p className="kb-hint" role="status">main — fixed</p></div>
      <div className="kb-field">Model
        <SegmentedControl label="Main agent model mode" value={mainModelMode} options={[{ value: 'host', label: 'Host default' }, { value: 'specific', label: 'Specific model' }]} onChange={chooseMainMode} />
        {mainModelMode === 'specific' && <NativeModelField seat={seat} value={controller.draft.mainModel} catalog={controller.catalog.catalog} catalogError={controller.catalog.error} catalogLoading={controller.catalog.loading} onChange={value => controller.changeMainModel(value)} onRetry={controller.catalog.reload} disabled={pending} subject="board" />}
      </div>
      <label className="kb-field">Preset
        <select className="kb-input" aria-label="Main agent preset" value={controller.draft.mainPreset} disabled={pending} onChange={event => controller.changeMainPreset(event.target.value)}>
          {presetOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          {storedPresetOption(controller, controller.draft.mainPreset)}
        </select>
      </label>
      {presetProblem(controller, controller.draft.mainPreset) && <p className="kb-hint" role="status">The stored preset is not in the host roster; it is kept as authored.</p>}
      {problemsOf(MAIN_AGENT_ID) !== '' && <p className="kb-hint" role="alert">{problemsOf(MAIN_AGENT_ID)}</p>}
    </AgentRow>

    {controller.draft.others.map((agent, index: number) => {
      const usage = controller.stageUsage.get(agent.id.trim()) ?? [];
      const removable = usage.length === 0;
      const key = 'agent-' + index;
      const title = agent.name.trim() === '' ? 'New agent' : agent.name;
      const specific = controller.specificAgents.has(index);
      const modelText = specific ? routeText(agent.model) || 'No model chosen' : 'Main agent’s model';
      const rowId = agent.id.trim() === '' ? 'agent-' + index : agent.id.trim();
      return <AgentRow key={key} rowKey={String(index)} title={title} subtitle={modelText + ' · ' + presetLabel(controller, agent.preset)} expanded={controller.expanded.has(index)} onToggle={() => controller.toggle(index)}>
        <label className="kb-field">Name
          <input className="kb-input" aria-label={'Agent ' + (index + 1) + ' name'} value={agent.name} disabled={pending} onChange={event => controller.changeAgent(index, { name: event.target.value })} />
        </label>
        <label className="kb-field">Identifier
          <input className="kb-input" aria-label={'Agent ' + (index + 1) + ' id'} value={agent.id} readOnly={agent.stored} disabled={pending} onChange={event => controller.changeAgent(index, { id: event.target.value })} />
          {agent.stored && <p className="kb-hint">Fixed once saved: stages reference this identifier.</p>}
        </label>
        <div className="kb-field">Model
          <SegmentedControl label={'Agent ' + (index + 1) + ' model mode'} value={specific ? 'specific' : 'inherit'} options={[{ value: 'inherit', label: 'Main agent’s model' }, { value: 'specific', label: 'Specific model' }]} onChange={mode => controller.chooseAgentModelMode(index, mode === 'specific' ? 'specific' : 'inherit')} />
          {specific && <NativeModelField seat={seat} value={agent.model} catalog={controller.catalog.catalog} catalogError={controller.catalog.error} catalogLoading={controller.catalog.loading} onChange={value => controller.changeAgent(index, { model: value })} onRetry={controller.catalog.reload} disabled={pending} subject="agent" />}
        </div>
        <label className="kb-field">Preset
          <select className="kb-input" aria-label={'Agent ' + (index + 1) + ' preset'} value={agent.preset} disabled={pending} onChange={event => controller.changeAgent(index, { preset: event.target.value })}>
            {presetOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            {storedPresetOption(controller, agent.preset)}
          </select>
        </label>
        {presetProblem(controller, agent.preset) && <p className="kb-hint" role="status">The stored preset is not in the host roster; it is kept as authored.</p>}
        {problemsOf(rowId) !== '' && <p className="kb-hint" role="alert">{problemsOf(rowId)}</p>}
        <div className="kb-agent-footer">
          <button type="button" className="kb-button" disabled={pending || !removable} title={removable ? 'Remove this agent' : 'A stage names this agent'} onClick={() => controller.removeAgent(index)}>Remove</button>
          {!removable && <p className="kb-hint" role="status">Used by {usage.join(', ')}. Clear the stage before removing this agent.</p>}
        </div>
      </AgentRow>;
    })}

    <button type="button" className="kb-button" disabled={pending} onClick={() => controller.addAgent()}>Add agent</button>
    {controller.roster.status === 'error' && <p className="kb-hint" role="status">The preset roster is unavailable. The stored presets are kept.</p>}
    {controller.catalog.error !== null && <p className="kb-hint" role="status">The model catalog is unavailable. The stored models are kept.</p>}
  </fieldset>;
}
